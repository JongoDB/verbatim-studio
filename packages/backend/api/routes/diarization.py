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
    DIARIZATION_COMPONENTS,
    PYANNOTE_MODELS,
    get_hf_cache_dir,
    get_missing_components,
    get_pyannote_model,
    get_torch_cache_dir,
    is_model_downloaded,
    get_model_size_on_disk,
    are_all_models_downloaded,
    _repo_cache_name,
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
    """Download all diarization pipeline components from HuggingFace.

    Downloads three repos: the pipeline config, the segmentation model,
    and the speaker embedding model. All are saved to the torch/pyannote
    cache so pyannote finds them at runtime without auto-downloading.

    Requires HuggingFace token (pyannote models are gated).
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
                from huggingface_hub import snapshot_download
            except ImportError:
                yield f"data: {json.dumps({'status': 'error', 'error': 'huggingface-hub is not installed'})}\n\n"
                return

            # Download to the torch/pyannote cache so pyannote finds them at runtime
            cache_dir = str(get_torch_cache_dir())
            missing = get_missing_components()
            total = len(DIARIZATION_COMPONENTS)

            import asyncio
            loop = asyncio.get_event_loop()

            for i, component in enumerate(DIARIZATION_COMPONENTS):
                repo = component["repo"]
                repo_short = repo.split("/")[-1]

                if repo not in missing:
                    yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'message': f'{repo_short} already cached ({i + 1}/{total})'})}\n\n"
                    continue

                yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'message': f'Downloading {repo_short} ({i + 1}/{total})...'})}\n\n"

                try:
                    def do_download(r=repo):
                        return snapshot_download(
                            repo_id=r,
                            repo_type="model",
                            token=hf_token,
                            cache_dir=cache_dir,
                        )

                    await loop.run_in_executor(None, do_download)
                except Exception as e:
                    error_msg = str(e)
                    if "401" in error_msg or "unauthorized" in error_msg.lower():
                        error_msg = (
                            f"Access denied for {repo}. Please accept the license agreement at "
                            f"https://huggingface.co/{repo}"
                        )
                    elif "403" in error_msg or "forbidden" in error_msg.lower():
                        error_msg = (
                            f"Access forbidden for {repo}. Please accept the license agreement at "
                            f"https://huggingface.co/{repo}"
                        )
                    yield f"data: {json.dumps({'status': 'error', 'error': error_msg})}\n\n"
                    return

            # Verify all components downloaded
            if is_model_downloaded(model_id):
                final_size = get_model_size_on_disk(model_id) or 0
                yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'size_bytes': final_size})}\n\n"
            else:
                still_missing = get_missing_components()
                yield f"data: {json.dumps({'status': 'error', 'error': f'Download completed but some components not found: {still_missing}'})}\n\n"

        except Exception as e:
            logger.exception("Error downloading diarization model %s", model_id)
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


@router.delete("/models/{model_id}")
async def delete_diarization_model(model_id: str) -> dict[str, Any]:
    """Delete all downloaded diarization model components."""
    model = get_pyannote_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    if not is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail=f"Model '{model_id}' is not downloaded")

    torch_cache = get_torch_cache_dir()
    hf_cache = get_hf_cache_dir()
    deleted = []

    try:
        for component in DIARIZATION_COMPONENTS:
            cache_name = _repo_cache_name(component["repo"])

            # Delete from torch/pyannote cache (primary)
            torch_path = torch_cache / cache_name
            if torch_path.exists():
                shutil.rmtree(torch_path)
                deleted.append(f"torch:{component['repo']}")

            # Also clean up HF hub cache (in case of old auto-downloads)
            hf_path = hf_cache / cache_name
            if hf_path.exists():
                shutil.rmtree(hf_path)
                deleted.append(f"hf:{component['repo']}")

        logger.info("Deleted diarization components: %s", deleted)
    except Exception as e:
        logger.exception("Error deleting diarization model %s", model_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {e}")

    return {
        "success": True,
        "message": f"Model '{model['label']}' and all components have been deleted",
        "model_id": model_id,
    }
