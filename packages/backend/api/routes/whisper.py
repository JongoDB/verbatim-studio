"""Whisper model management API routes.

Provides endpoints for listing, downloading, activating, and deleting
MLX Whisper models for transcription.
"""

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.whisper_catalog import (
    WHISPER_MODELS,
    get_model_cache_path,
    get_whisper_model,
    is_model_downloaded,
    get_model_size_on_disk,
)
from core.transcription_settings import (
    get_transcription_settings,
    save_transcription_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/whisper", tags=["whisper"])


class WhisperModelResponse(BaseModel):
    """Response model for whisper model info."""

    id: str
    label: str
    description: str
    repo: str
    size_bytes: int
    is_default: bool
    bundled: bool
    downloaded: bool
    active: bool
    size_on_disk: int | None = None


class WhisperModelsResponse(BaseModel):
    """Response model for list of whisper models."""

    models: list[WhisperModelResponse]
    active_model: str | None


@router.get("/models", response_model=WhisperModelsResponse)
async def list_whisper_models() -> WhisperModelsResponse:
    """List all available whisper models with their status."""
    # Get current active model from transcription settings
    current_settings = await get_transcription_settings()
    # The setting stores just the size (e.g., "base"), convert to model ID
    active_size = current_settings.get("model", "base")
    active_model_id = f"whisper-{active_size}"

    models = []
    for model in WHISPER_MODELS:
        downloaded = is_model_downloaded(model["id"])
        models.append(
            WhisperModelResponse(
                id=model["id"],
                label=model["label"],
                description=model["description"],
                repo=model["repo"],
                size_bytes=model["size_bytes"],
                is_default=model["is_default"],
                bundled=model["bundled"],
                downloaded=downloaded,
                active=model["id"] == active_model_id and downloaded,
                size_on_disk=get_model_size_on_disk(model["id"]) if downloaded else None,
            )
        )

    return WhisperModelsResponse(
        models=models,
        active_model=active_model_id if is_model_downloaded(active_model_id) else None,
    )


@router.post("/models/{model_id}/download")
async def download_whisper_model(model_id: str) -> StreamingResponse:
    """Download a whisper model from HuggingFace.

    Streams progress events via SSE (Server-Sent Events).
    """
    model = get_whisper_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    if is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is already downloaded")

    async def generate_events():
        """Generate SSE events for download progress."""
        try:
            yield f"data: {json.dumps({'status': 'starting', 'model_id': model_id})}\n\n"

            # Import huggingface_hub for downloading
            try:
                from huggingface_hub import snapshot_download, HfApi
            except ImportError:
                yield f"data: {json.dumps({'status': 'error', 'error': 'huggingface-hub is not installed'})}\n\n"
                return

            yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'message': 'Connecting to HuggingFace...'})}\n\n"

            # Get model info for size
            api = HfApi()
            try:
                model_info = api.model_info(model["repo"])
                total_bytes = sum(
                    sibling.size for sibling in model_info.siblings
                    if sibling.size is not None
                )
            except Exception:
                total_bytes = model["size_bytes"]

            yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'message': 'Starting download...', 'total_bytes': total_bytes})}\n\n"

            # Download the model
            # snapshot_download handles caching automatically
            import asyncio

            def do_download():
                return snapshot_download(
                    repo_id=model["repo"],
                    repo_type="model",
                    # Allow all files for MLX models
                )

            # Run in thread to not block
            loop = asyncio.get_event_loop()
            local_dir = await loop.run_in_executor(None, do_download)

            # Verify download
            if is_model_downloaded(model_id):
                final_size = get_model_size_on_disk(model_id) or 0
                yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'path': str(local_dir), 'size_bytes': final_size})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'error', 'error': 'Download completed but model files not found'})}\n\n"

        except Exception as e:
            logger.exception("Error downloading whisper model %s", model_id)
            yield f"data: {json.dumps({'status': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/models/{model_id}/activate")
async def activate_whisper_model(model_id: str) -> dict[str, Any]:
    """Set a whisper model as the active transcription model."""
    model = get_whisper_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    if not is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is not downloaded")

    # Extract size from model_id (e.g., "whisper-base" -> "base")
    size = model_id.replace("whisper-", "")

    # Update transcription settings
    await save_transcription_settings({"model": size})

    logger.info("Activated whisper model: %s", model_id)

    return {
        "success": True,
        "message": f"Model '{model['label']}' is now active",
        "model_id": model_id,
    }


@router.delete("/models/{model_id}")
async def delete_whisper_model(model_id: str) -> dict[str, Any]:
    """Delete a downloaded whisper model."""
    model = get_whisper_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    if not is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is not downloaded")

    # Don't allow deleting the bundled model if it's the only one
    if model["bundled"]:
        # Check if there are other downloaded models
        other_downloaded = False
        for m in WHISPER_MODELS:
            if m["id"] != model_id and is_model_downloaded(m["id"]):
                other_downloaded = True
                break

        if not other_downloaded:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the bundled model when no other models are downloaded",
            )

    # Get cache path and delete
    cache_path = get_model_cache_path(model["repo"])

    try:
        if cache_path.exists():
            shutil.rmtree(cache_path)
            logger.info("Deleted whisper model: %s at %s", model_id, cache_path)
    except Exception as e:
        logger.exception("Error deleting whisper model %s", model_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {e}")

    # If this was the active model, switch to the default
    current_settings = await get_transcription_settings()
    active_size = current_settings.get("model", "base")
    if f"whisper-{active_size}" == model_id:
        # Find another downloaded model to activate
        for m in WHISPER_MODELS:
            if m["id"] != model_id and is_model_downloaded(m["id"]):
                new_size = m["id"].replace("whisper-", "")
                await save_transcription_settings({"model": new_size})
                logger.info("Switched active model to: %s", m["id"])
                break

    return {
        "success": True,
        "message": f"Model '{model['label']}' has been deleted",
        "model_id": model_id,
    }
