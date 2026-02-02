"""OCR model management endpoints."""

import asyncio
import concurrent.futures
import json
import logging
import shutil
import subprocess
import sys
from pathlib import Path

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

# Required Python packages for OCR
OCR_PYTHON_DEPS = [
    "transformers>=4.45.0",
    "qwen-vl-utils>=0.0.8",
    "accelerate>=0.26.0",
    "torch>=2.0.0",  # Required by transformers for model inference
]


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
    deps_installed: bool


# Track in-progress downloads - stores the Future object
_download_futures: dict[str, concurrent.futures.Future] = {}
_download_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
# Track download phase (deps_install, downloading)
_download_phase: dict[str, str] = {}


def _check_ocr_deps_installed() -> bool:
    """Check if required OCR Python dependencies are installed."""
    try:
        import transformers
        from qwen_vl_utils import process_vision_info
        import accelerate
        return True
    except ImportError:
        return False


def _install_ocr_deps_sync() -> tuple[bool, str]:
    """Install OCR Python dependencies synchronously.

    Returns: (success, message)
    """
    logger.info("Installing OCR Python dependencies: %s", OCR_PYTHON_DEPS)

    try:
        python_exe = sys.executable
        pip_cmd = [python_exe, "-m", "pip", "install", "--upgrade"] + OCR_PYTHON_DEPS

        result = subprocess.run(
            pip_cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout for large packages
        )

        if result.returncode == 0:
            logger.info("OCR Python dependencies installed successfully")
            return True, "Dependencies installed"
        else:
            logger.error("pip install failed: %s", result.stderr)
            return False, f"pip install failed: {result.stderr[:500]}"

    except subprocess.TimeoutExpired:
        logger.error("OCR dependency installation timed out")
        return False, "Installation timed out"
    except Exception as e:
        logger.exception("Failed to install OCR dependencies")
        return False, str(e)


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
    # Check if qwen2-vl-ocr model is available
    model_downloaded = is_model_downloaded("qwen2-vl-ocr")
    deps_installed = _check_ocr_deps_installed()

    if model_downloaded and deps_installed:
        path = get_model_path("qwen2-vl-ocr")
        return OCRStatusResponse(
            available=True,
            model_id="qwen2-vl-ocr",
            model_path=str(path) if path else None,
            deps_installed=True,
        )

    return OCRStatusResponse(
        available=False,
        model_id="qwen2-vl-ocr" if model_downloaded else None,
        model_path=str(get_model_path("qwen2-vl-ocr")) if model_downloaded else None,
        deps_installed=deps_installed,
    )


def _do_download_sync(model_id: str, repo: str, dest_path: Path, marker_file: Path):
    """Synchronous download function that runs in a thread.

    Handles its own cleanup regardless of SSE connection state.
    Also installs required Python dependencies if not present.
    """
    try:
        # First, ensure OCR Python dependencies are installed
        if not _check_ocr_deps_installed():
            _download_phase[model_id] = "deps_install"
            logger.info("OCR Python dependencies not found, installing...")
            success, msg = _install_ocr_deps_sync()
            if not success:
                raise RuntimeError(f"Failed to install OCR dependencies: {msg}")
            logger.info("OCR Python dependencies installed successfully")

        _download_phase[model_id] = "downloading"
        from huggingface_hub import snapshot_download

        logger.info("Starting OCR model download: %s -> %s", repo, dest_path)

        # Only download files needed for inference (exclude demos, docs, examples)
        # Note: resume_download=True is the default, allowing interrupted downloads to resume
        result = snapshot_download(
            repo_id=repo,
            repo_type="model",
            local_dir=str(dest_path),
            allow_patterns=[
                "*.safetensors",
                "*.json",
                "*.txt",
                "tokenizer*",
                "vocab*",
                "merges*",
            ],
            ignore_patterns=[
                "Demo/*",
                "Sample*/*",
                "*.ipynb",
                "*.md",
                "*.py",
                "examples/*",
                "font/*",
                "*.png",
                "*.jpg",
                "*.TTF",
                "*.ttf",
                "Qwen2vl*/*",
            ],
        )
        logger.info("OCR model download complete: %s -> %s", model_id, result)

        # Verify the model.safetensors file exists
        safetensors_path = dest_path / "model.safetensors"
        if not safetensors_path.exists():
            raise RuntimeError(f"Download completed but model.safetensors not found at {safetensors_path}")
        logger.info("Verified model.safetensors exists: %s (%.2f GB)",
                    safetensors_path, safetensors_path.stat().st_size / 1e9)
    except Exception as exc:
        logger.exception("OCR model download failed: %s - %s", model_id, exc)
        # Clean up partial download on failure
        if dest_path.exists():
            cache_dir = dest_path / ".cache"
            if cache_dir.exists():
                shutil.rmtree(cache_dir)
                logger.info("Cleaned up cache directory after failed download")
        raise
    finally:
        # Always clean up marker when done (success or failure)
        marker_file.unlink(missing_ok=True)
        # Remove from tracking dicts
        _download_futures.pop(model_id, None)
        _download_phase.pop(model_id, None)


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

    # Check if huggingface_hub is available
    try:
        from huggingface_hub import snapshot_download  # noqa: F401
    except ImportError:
        raise HTTPException(status_code=500, detail="huggingface-hub is not installed")

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

    # Start download in background thread - it manages its own cleanup
    future = _download_executor.submit(
        _do_download_sync, model_id, entry["repo"], dest_path, marker_file
    )
    _download_futures[model_id] = future

    total_bytes = entry["size_bytes"]

    async def _stream_progress():
        """Stream progress updates. Download continues even if this disconnects."""
        yield f"data: {json.dumps({'status': 'starting', 'model_id': model_id})}\n\n"

        last_size = 0
        last_phase = None
        while model_id in _download_futures and not _download_futures[model_id].done():
            await asyncio.sleep(2)  # Check every 2 seconds

            # Check current phase
            current_phase = _download_phase.get(model_id, "starting")
            if current_phase != last_phase:
                last_phase = current_phase
                if current_phase == "deps_install":
                    yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'phase': 'deps_install', 'message': 'Installing OCR dependencies (transformers, qwen-vl-utils)...'})}\n\n"
                elif current_phase == "downloading":
                    yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'phase': 'downloading', 'message': 'Downloading OCR model...'})}\n\n"

            current_size = get_model_size_on_disk(model_id) or 0
            if current_size != last_size:
                last_size = current_size
                percent = min(99, int((current_size / total_bytes) * 100)) if total_bytes > 0 else 0
                yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'phase': 'downloading', 'downloaded_bytes': current_size, 'total_bytes': total_bytes, 'percent': percent})}\n\n"

        # Check if download succeeded or failed
        if model_id in _download_futures:
            future = _download_futures.get(model_id)
            if future and future.done():
                try:
                    future.result()  # Raises exception if download failed
                    final_size = get_model_size_on_disk(model_id) or 0
                    yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'size_bytes': final_size})}\n\n"
                except Exception as exc:
                    yield f"data: {json.dumps({'status': 'error', 'error': str(exc)})}\n\n"
        else:
            # Download completed and was cleaned up
            if is_model_downloaded(model_id):
                final_size = get_model_size_on_disk(model_id) or 0
                yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'size_bytes': final_size})}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'error', 'error': 'Download failed'})}\n\n"

    return StreamingResponse(_stream_progress(), media_type="text/event-stream")


@router.post("/install-deps")
async def install_ocr_dependencies():
    """Install OCR Python dependencies separately.

    Useful if the model was downloaded but dependencies weren't installed,
    or if dependencies were uninstalled.
    """
    if _check_ocr_deps_installed():
        return {"status": "already_installed", "message": "OCR dependencies are already installed"}

    async def _stream_install():
        yield f"data: {json.dumps({'status': 'starting', 'message': 'Installing OCR dependencies...'})}\n\n"

        # Run installation in thread pool to not block
        loop = asyncio.get_event_loop()
        success, msg = await loop.run_in_executor(None, _install_ocr_deps_sync)

        if success:
            yield f"data: {json.dumps({'status': 'complete', 'message': 'OCR dependencies installed successfully'})}\n\n"
        else:
            yield f"data: {json.dumps({'status': 'error', 'error': msg})}\n\n"

    return StreamingResponse(_stream_install(), media_type="text/event-stream")


@router.post("/models/{model_id}/cancel")
async def cancel_ocr_download(model_id: str):
    """Cancel an in-progress or stale OCR model download.

    This removes the .downloading marker and cleans up partial files.
    Useful when a download was interrupted (app closed, network error).
    """
    entry = OCR_MODEL_CATALOG.get(model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not in catalog")

    path = get_model_path(model_id)
    if not path:
        raise HTTPException(status_code=404, detail="Model path not found")

    marker = path / ".downloading"
    was_downloading = marker.exists()

    # Cancel any active download future
    if model_id in _download_futures:
        future = _download_futures.pop(model_id)
        if not future.done():
            future.cancel()
        if model_id in _download_phase:
            del _download_phase[model_id]

    # Remove the marker file
    if marker.exists():
        marker.unlink()

    # Clean up the partial download directory if it exists and is incomplete
    if path.exists() and not is_model_downloaded(model_id):
        try:
            shutil.rmtree(path)
            logger.info("Cleaned up partial OCR model download at %s", path)
        except Exception as e:
            logger.warning("Failed to clean up partial download: %s", e)

    return {
        "status": "cancelled",
        "model_id": model_id,
        "was_downloading": was_downloading,
    }


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
