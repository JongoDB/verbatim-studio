"""OCR model management endpoints."""

import asyncio
import json
import logging
import shutil

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.config import settings
from core.ocr_catalog import (
    OCR_MODEL_CATALOG,
    get_model_path,
    get_ocr_models_dir,
    is_model_downloaded,
    is_model_downloading,
    get_model_size_on_disk,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ocr", tags=["ocr"])


class OCRModelInfo(BaseModel):
    """Info about an OCR model."""

    id: str
    label: str
    description: str
    repo: str
    size_bytes: int
    is_default: bool
    downloaded: bool
    downloading: bool
    size_on_disk: int | None


class OCRModelListResponse(BaseModel):
    """Response listing all OCR models."""

    models: list[OCRModelInfo]


class OCRStatusResponse(BaseModel):
    """OCR service status."""

    available: bool
    model_id: str | None
    model_path: str | None


# Track in-progress downloads
_download_tasks: dict[str, asyncio.Task] = {}


@router.get("/models", response_model=OCRModelListResponse)
async def list_ocr_models() -> OCRModelListResponse:
    """Return the OCR model catalog with download status."""
    items: list[OCRModelInfo] = []

    for model_id, entry in OCR_MODEL_CATALOG.items():
        downloading = is_model_downloading(model_id)
        downloaded = is_model_downloaded(model_id)
        # Show current size even while downloading
        size_on_disk = get_model_size_on_disk(model_id) if (downloaded or downloading) else None

        items.append(
            OCRModelInfo(
                id=model_id,
                label=entry["label"],
                description=entry["description"],
                repo=entry["repo"],
                size_bytes=entry["size_bytes"],
                is_default=entry.get("default", False),
                downloaded=downloaded,
                downloading=downloading,
                size_on_disk=size_on_disk,
            )
        )

    return OCRModelListResponse(models=items)


@router.get("/status", response_model=OCRStatusResponse)
async def get_ocr_status() -> OCRStatusResponse:
    """Get OCR service status."""
    # Check if chandra model is available
    chandra_downloaded = is_model_downloaded("chandra")

    if chandra_downloaded:
        path = get_model_path("chandra")
        return OCRStatusResponse(
            available=True,
            model_id="chandra",
            model_path=str(path) if path else None,
        )

    return OCRStatusResponse(
        available=False,
        model_id=None,
        model_path=None,
    )


@router.post("/models/{model_id}/download")
async def download_ocr_model(model_id: str) -> StreamingResponse:
    """Download an OCR model from HuggingFace to Verbatim storage."""
    entry = OCR_MODEL_CATALOG.get(model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not in catalog")

    if is_model_downloaded(model_id):
        raise HTTPException(status_code=409, detail="Model already downloaded")

    if is_model_downloading(model_id):
        raise HTTPException(status_code=409, detail="Download already in progress")

    async def _stream_progress():
        try:
            from huggingface_hub import snapshot_download
        except ImportError:
            yield f"data: {json.dumps({'status': 'error', 'error': 'huggingface-hub is not installed'})}\n\n"
            return

        # Ensure directories exist
        settings.ensure_directories()
        ocr_dir = get_ocr_models_dir()
        ocr_dir.mkdir(parents=True, exist_ok=True)

        # Get destination path
        dest_path = get_model_path(model_id)
        dest_path.mkdir(parents=True, exist_ok=True)

        # Create download marker
        marker_file = dest_path / ".downloading"
        marker_file.touch()

        yield f"data: {json.dumps({'status': 'starting', 'model_id': model_id})}\n\n"

        try:
            loop = asyncio.get_event_loop()
            total_bytes = entry["size_bytes"]

            # Start download in background thread
            import concurrent.futures
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

            def do_download():
                return snapshot_download(
                    repo_id=entry["repo"],
                    repo_type="model",
                    local_dir=str(dest_path),
                    local_dir_use_symlinks=False,
                )

            future = executor.submit(do_download)

            # Poll for progress while download runs
            last_size = 0
            while not future.done():
                await asyncio.sleep(2)  # Check every 2 seconds
                current_size = get_model_size_on_disk(model_id) or 0
                if current_size != last_size:
                    last_size = current_size
                    percent = min(99, int((current_size / total_bytes) * 100)) if total_bytes > 0 else 0
                    yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'downloaded_bytes': current_size, 'total_bytes': total_bytes, 'percent': percent})}\n\n"

            # Get result (raises exception if download failed)
            path = future.result()
            executor.shutdown(wait=False)

            # Remove download marker
            marker_file.unlink(missing_ok=True)

            final_size = get_model_size_on_disk(model_id) or 0
            yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'path': str(path), 'size_bytes': final_size})}\n\n"

        except Exception as exc:
            logger.exception("OCR model download failed")
            # Remove marker on error
            marker_file.unlink(missing_ok=True)
            yield f"data: {json.dumps({'status': 'error', 'error': str(exc)})}\n\n"

    return StreamingResponse(_stream_progress(), media_type="text/event-stream")


@router.delete("/models/{model_id}")
async def delete_ocr_model(model_id: str):
    """Delete a downloaded OCR model."""
    entry = OCR_MODEL_CATALOG.get(model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not in catalog")

    if not is_model_downloaded(model_id):
        raise HTTPException(status_code=404, detail="Model not downloaded")

    path = get_model_path(model_id)
    if path and path.exists():
        try:
            shutil.rmtree(path)
            logger.info("Deleted OCR model at %s", path)
        except Exception as e:
            logger.error("Failed to delete OCR model: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to delete: {e}")

    return {"status": "deleted", "model_id": model_id}
