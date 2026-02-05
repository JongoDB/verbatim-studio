"""Diarization model management API routes.

Provides endpoints for listing and downloading pyannote models
required for speaker diarization. These models are gated and
require HuggingFace authentication.
"""

import json
import logging
import shutil
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.pyannote_catalog import (
    PYANNOTE_MODELS,
    get_model_cache_path,
    get_pyannote_model,
    is_model_downloaded,
    get_model_size_on_disk,
    are_all_models_downloaded,
)
from core.transcription_settings import get_transcription_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diarization", tags=["diarization"])


class DiarizationModelResponse(BaseModel):
    """Response model for diarization model info."""

    id: str
    label: str
    description: str
    repo: str
    size_bytes: int
    required: bool
    downloaded: bool
    size_on_disk: int | None = None


class DiarizationModelsResponse(BaseModel):
    """Response model for list of diarization models."""

    models: list[DiarizationModelResponse]
    all_downloaded: bool
    hf_token_set: bool


@router.get("/models", response_model=DiarizationModelsResponse)
async def list_diarization_models() -> DiarizationModelsResponse:
    """List all diarization models with their status.

    Returns model information including download status.
    Note: Models can only be downloaded if HF token is configured.
    """
    # Check if HF token is set
    current_settings = await get_transcription_settings()
    hf_token_set = bool(current_settings.get("hf_token"))

    models = []
    for model in PYANNOTE_MODELS:
        downloaded = is_model_downloaded(model["id"])
        models.append(
            DiarizationModelResponse(
                id=model["id"],
                label=model["label"],
                description=model["description"],
                repo=model["repo"],
                size_bytes=model["size_bytes"],
                required=model["required"],
                downloaded=downloaded,
                size_on_disk=get_model_size_on_disk(model["id"]) if downloaded else None,
            )
        )

    return DiarizationModelsResponse(
        models=models,
        all_downloaded=are_all_models_downloaded(),
        hf_token_set=hf_token_set,
    )


@router.post("/models/{model_id}/download")
async def download_diarization_model(model_id: str) -> StreamingResponse:
    """Download a diarization model from HuggingFace.

    Requires HuggingFace token to be configured (pyannote models are gated).
    Streams progress events via SSE (Server-Sent Events).
    """
    model = get_pyannote_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    if is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is already downloaded")

    # Check HF token is set
    current_settings = await get_transcription_settings()
    hf_token = current_settings.get("hf_token")
    if not hf_token:
        raise HTTPException(
            status_code=400,
            detail="HuggingFace token required. Pyannote models are gated and require authentication. "
                   "Please add your HuggingFace token in Settings → Transcription."
        )

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
                model_info = api.model_info(model["repo"], token=hf_token)
                total_bytes = sum(
                    sibling.size for sibling in model_info.siblings
                    if sibling.size is not None
                )
            except Exception as e:
                # Check for 401 unauthorized
                if "401" in str(e) or "unauthorized" in str(e).lower():
                    yield f"data: {json.dumps({'status': 'error', 'error': 'Access denied. Please ensure you have accepted the license agreement for this model on HuggingFace.'})}\n\n"
                    return
                total_bytes = model["size_bytes"]

            yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'message': 'Starting download...', 'total_bytes': total_bytes})}\n\n"

            # Download the model
            import asyncio

            downloaded_bytes = 0
            last_reported_percent = 0

            def progress_callback(downloaded: int, total: int):
                nonlocal downloaded_bytes, last_reported_percent
                downloaded_bytes = downloaded
                # Only report every 5% to avoid flooding
                if total > 0:
                    percent = int((downloaded / total) * 100)
                    if percent >= last_reported_percent + 5:
                        last_reported_percent = percent

            def do_download():
                return snapshot_download(
                    repo_id=model["repo"],
                    repo_type="model",
                    token=hf_token,
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
            logger.exception("Error downloading diarization model %s", model_id)
            error_msg = str(e)
            # Provide helpful error message for common issues
            if "401" in error_msg or "unauthorized" in error_msg.lower():
                error_msg = "Access denied. Please ensure you have accepted the license agreement for this model on HuggingFace (https://huggingface.co/" + model["repo"] + ")."
            elif "403" in error_msg or "forbidden" in error_msg.lower():
                error_msg = "Access forbidden. Please ensure you have accepted the license agreement for this model on HuggingFace."
            yield f"data: {json.dumps({'status': 'error', 'error': error_msg})}\n\n"

    return StreamingResponse(
        generate_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/models/{model_id}")
async def delete_diarization_model(model_id: str) -> dict[str, Any]:
    """Delete a downloaded diarization model."""
    model = get_pyannote_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    if not is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is not downloaded")

    # Get cache path and delete
    cache_path = get_model_cache_path(model["repo"])

    try:
        if cache_path.exists():
            shutil.rmtree(cache_path)
            logger.info("Deleted diarization model: %s at %s", model_id, cache_path)
    except Exception as e:
        logger.exception("Error deleting diarization model %s", model_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {e}")

    return {
        "success": True,
        "message": f"Model '{model['label']}' has been deleted",
        "model_id": model_id,
    }
