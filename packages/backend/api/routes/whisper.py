"""Whisper model management API routes.

Provides endpoints for listing, downloading, activating, and deleting
MLX Whisper models for transcription.
"""

import asyncio
import json
import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
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

# Thread pool for background downloads
_download_executor = ThreadPoolExecutor(max_workers=2)
_download_futures: dict[str, Any] = {}  # model_id -> Future

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


def _is_model_downloading(model_id: str) -> bool:
    """Check if a model download is in progress."""
    return model_id in _download_futures and not _download_futures[model_id].done()


def _do_download_sync(model_id: str, repo: str) -> str:
    """Synchronous download function to run in thread pool."""
    from huggingface_hub import snapshot_download

    try:
        local_dir = snapshot_download(
            repo_id=repo,
            repo_type="model",
        )
        return local_dir
    finally:
        # Clean up futures dict
        _download_futures.pop(model_id, None)


@router.post("/models/{model_id}/download")
async def download_whisper_model(model_id: str) -> StreamingResponse:
    """Download a whisper model from HuggingFace.

    Streams progress events via SSE (Server-Sent Events) with byte-level progress.
    """
    model = get_whisper_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    if is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is already downloaded")

    if _is_model_downloading(model_id):
        raise HTTPException(status_code=409, detail=f"Model '{model_id}' download already in progress")

    # Check if huggingface_hub is available
    try:
        from huggingface_hub import HfApi
    except ImportError:
        raise HTTPException(status_code=500, detail="huggingface-hub is not installed")

    # Get total size for progress calculation
    total_bytes = model["size_bytes"]
    try:
        api = HfApi()
        model_info = api.model_info(model["repo"])
        total_bytes = sum(
            sibling.size for sibling in model_info.siblings
            if sibling.size is not None
        ) or model["size_bytes"]
    except (ImportError, OSError, ValueError):
        pass  # Use catalog size as fallback

    # Start download in background thread
    future = _download_executor.submit(_do_download_sync, model_id, model["repo"])
    _download_futures[model_id] = future

    async def stream_progress():
        """Stream progress updates while download runs in background."""
        yield f"data: {json.dumps({'status': 'starting', 'model_id': model_id})}\n\n"
        yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'message': 'Downloading model...', 'total_bytes': total_bytes, 'downloaded_bytes': 0, 'percent': 0})}\n\n"

        last_size = 0
        while model_id in _download_futures and not _download_futures[model_id].done():
            await asyncio.sleep(2)  # Poll every 2 seconds

            current_size = get_model_size_on_disk(model_id) or 0
            if current_size != last_size:
                last_size = current_size
                percent = min(99, int((current_size / total_bytes) * 100)) if total_bytes > 0 else 0
                yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'downloaded_bytes': current_size, 'total_bytes': total_bytes, 'percent': percent})}\n\n"

        # Check final result
        if model_id in _download_futures:
            fut = _download_futures.get(model_id)
            if fut and fut.done():
                try:
                    local_dir = fut.result()
                    final_size = get_model_size_on_disk(model_id) or 0
                    yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'path': str(local_dir), 'size_bytes': final_size})}\n\n"
                except Exception as exc:
                    logger.exception("Error downloading whisper model %s", model_id)
                    yield f"data: {json.dumps({'status': 'error', 'error': str(exc)})}\n\n"
        else:
            # Future was cleaned up - check if download succeeded
            if is_model_downloaded(model_id):
                final_size = get_model_size_on_disk(model_id) or 0
                yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'size_bytes': final_size})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'error', 'error': 'Download failed'})}\n\n"

    return StreamingResponse(
        stream_progress(),
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
