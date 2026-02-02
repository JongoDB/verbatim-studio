"""System information endpoints."""

import asyncio
import json
import logging
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.config import settings

logger = logging.getLogger(__name__)
from persistence.database import async_session
from sqlalchemy import text


def _get_git_version() -> str:
    """Read version from git tags."""
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--always"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return "dev"

router = APIRouter(prefix="/system", tags=["system"])


class StoragePaths(BaseModel):
    """Storage paths info."""

    data_dir: str
    media_dir: str
    models_dir: str
    database_path: str


class DiskUsage(BaseModel):
    """Disk usage info."""

    total_bytes: int
    used_bytes: int
    free_bytes: int
    percent_used: float


class ModelBreakdown(BaseModel):
    """Breakdown of AI models by type."""

    llm_count: int
    llm_bytes: int
    asr_count: int
    asr_bytes: int
    diarization_count: int
    diarization_bytes: int
    ocr_count: int
    ocr_bytes: int


class StorageBreakdown(BaseModel):
    """Breakdown of Verbatim storage usage."""

    media_bytes: int
    media_count: int
    database_bytes: int
    models: ModelBreakdown
    total_bytes: int


class ContentCounts(BaseModel):
    """Content counts from database."""

    recordings: int
    transcripts: int
    segments: int


class SystemInfo(BaseModel):
    """Complete system information."""

    # App info
    app_version: str
    python_version: str
    platform: str
    platform_version: str

    # Storage
    paths: StoragePaths
    disk_usage: DiskUsage
    storage_breakdown: StorageBreakdown
    content_counts: ContentCounts

    # Limits
    max_upload_bytes: int


def get_dir_size(path: Path) -> tuple[int, int]:
    """Get total size and file count of a directory."""
    total_size = 0
    file_count = 0
    if path.exists() and path.is_dir():
        for entry in path.rglob("*"):
            if entry.is_file():
                try:
                    total_size += entry.stat().st_size
                    file_count += 1
                except (OSError, PermissionError):
                    pass
    return total_size, file_count


def get_file_size(path: Path) -> int:
    """Get size of a single file."""
    if path.exists() and path.is_file():
        try:
            return path.stat().st_size
        except (OSError, PermissionError):
            pass
    return 0


def count_llm_models(models_dir: Path) -> tuple[int, int]:
    """Count LLM models (.gguf files) in the models directory."""
    count, size = 0, 0
    if models_dir.exists() and models_dir.is_dir():
        for f in models_dir.glob("*.gguf"):
            try:
                count += 1
                size += f.stat().st_size
            except (OSError, PermissionError):
                pass
    return count, size


def count_huggingface_models(pattern: str) -> tuple[int, int]:
    """Count models in HuggingFace cache matching a pattern.

    Args:
        pattern: Glob pattern to match model directories (e.g., '*whisper*')

    Returns:
        Tuple of (model_count, total_bytes)
    """
    hf_cache = Path.home() / ".cache" / "huggingface" / "hub"
    count, size = 0, 0
    if not hf_cache.exists():
        return count, size

    for d in hf_cache.glob(f"models--{pattern}"):
        if d.is_dir():
            count += 1
            for f in d.rglob("*"):
                if f.is_file():
                    try:
                        size += f.stat().st_size
                    except (OSError, PermissionError):
                        pass
    return count, size


def count_pyannote_models() -> tuple[int, int]:
    """Count pyannote diarization models in torch cache.

    Pyannote stores models in ~/.cache/torch/pyannote/ rather than HuggingFace cache.

    Returns:
        Tuple of (model_count, total_bytes)
    """
    pyannote_cache = Path.home() / ".cache" / "torch" / "pyannote"
    count, size = 0, 0
    if not pyannote_cache.exists():
        return count, size

    for d in pyannote_cache.glob("models--pyannote--*"):
        if d.is_dir():
            count += 1
            for f in d.rglob("*"):
                if f.is_file():
                    try:
                        size += f.stat().st_size
                    except (OSError, PermissionError):
                        pass
    return count, size


def count_ocr_models(models_dir: Path) -> tuple[int, int]:
    """Count OCR/VLM models in the models/ocr directory.

    OCR models are stored as subdirectories under models/ocr/.

    Returns:
        Tuple of (model_count, total_bytes)
    """
    ocr_dir = models_dir / "ocr"
    count, size = 0, 0
    if not ocr_dir.exists():
        return count, size

    for d in ocr_dir.iterdir():
        if d.is_dir():
            count += 1
            for f in d.rglob("*"):
                if f.is_file():
                    try:
                        size += f.stat().st_size
                    except (OSError, PermissionError):
                        pass
    return count, size


@router.get("/info", response_model=SystemInfo)
async def get_system_info() -> SystemInfo:
    """Get system information including storage usage and content counts."""
    # Get database path from URL
    db_url = settings.DATABASE_URL
    if db_url.startswith("sqlite"):
        # Extract path from sqlite URL (sqlite+aiosqlite:///./verbatim.db)
        db_path_str = db_url.split("///")[-1]
        db_path = Path(db_path_str).resolve()
    else:
        db_path = Path("verbatim.db")

    # Storage paths
    paths = StoragePaths(
        data_dir=str(settings.DATA_DIR),
        media_dir=str(settings.MEDIA_DIR),
        models_dir=str(settings.MODELS_DIR),
        database_path=str(db_path),
    )

    # Disk usage (based on data directory's filesystem)
    try:
        disk = shutil.disk_usage(settings.DATA_DIR)
        disk_usage = DiskUsage(
            total_bytes=disk.total,
            used_bytes=disk.used,
            free_bytes=disk.free,
            percent_used=round((disk.used / disk.total) * 100, 1) if disk.total > 0 else 0,
        )
    except (OSError, PermissionError):
        disk_usage = DiskUsage(
            total_bytes=0,
            used_bytes=0,
            free_bytes=0,
            percent_used=0,
        )

    # Storage breakdown
    media_bytes, media_count = get_dir_size(settings.MEDIA_DIR)
    database_bytes = get_file_size(db_path)

    # Count models by type
    llm_count, llm_bytes = count_llm_models(settings.MODELS_DIR)
    asr_count, asr_bytes = count_huggingface_models("*whisper*")
    diarization_count, diarization_bytes = count_pyannote_models()
    ocr_count, ocr_bytes = count_ocr_models(settings.MODELS_DIR)

    models = ModelBreakdown(
        llm_count=llm_count,
        llm_bytes=llm_bytes,
        asr_count=asr_count,
        asr_bytes=asr_bytes,
        diarization_count=diarization_count,
        diarization_bytes=diarization_bytes,
        ocr_count=ocr_count,
        ocr_bytes=ocr_bytes,
    )

    total_models_bytes = llm_bytes + asr_bytes + diarization_bytes + ocr_bytes

    storage_breakdown = StorageBreakdown(
        media_bytes=media_bytes,
        media_count=media_count,
        database_bytes=database_bytes,
        models=models,
        total_bytes=media_bytes + database_bytes + total_models_bytes,
    )

    # Content counts from database
    async with async_session() as session:
        # Count recordings
        result = await session.execute(text("SELECT COUNT(*) FROM recordings"))
        recordings_count = result.scalar() or 0

        # Count transcripts
        result = await session.execute(text("SELECT COUNT(*) FROM transcripts"))
        transcripts_count = result.scalar() or 0

        # Count segments
        result = await session.execute(text("SELECT COUNT(*) FROM segments"))
        segments_count = result.scalar() or 0

    content_counts = ContentCounts(
        recordings=recordings_count,
        transcripts=transcripts_count,
        segments=segments_count,
    )

    # Platform info
    platform_info = platform.platform()
    platform_system = platform.system()

    return SystemInfo(
        app_version=_get_git_version(),
        python_version=sys.version.split()[0],
        platform=platform_system,
        platform_version=platform_info,
        paths=paths,
        disk_usage=disk_usage,
        storage_breakdown=storage_breakdown,
        content_counts=content_counts,
        max_upload_bytes=10 * 1024 * 1024 * 1024,  # 10 GB
    )


# ============ ML Dependencies Management ============


class MLStatus(BaseModel):
    """ML dependencies status."""

    whisperx_installed: bool
    mlx_whisper_installed: bool
    torch_installed: bool
    pyannote_installed: bool
    is_apple_silicon: bool
    recommended_engine: str | None
    install_in_progress: bool = False


def _is_apple_silicon() -> bool:
    """Check if running on Apple Silicon Mac."""
    return sys.platform == "darwin" and platform.machine() == "arm64"


def _check_package_installed(package: str) -> bool:
    """Check if a Python package is installed."""
    try:
        __import__(package.replace("-", "_"))
        return True
    except ImportError:
        return False


# Track installation status
_ml_install_in_progress = False


@router.get("/ml-status", response_model=MLStatus)
async def get_ml_status() -> MLStatus:
    """Get ML dependencies installation status."""
    whisperx = _check_package_installed("whisperx")
    mlx_whisper = _check_package_installed("mlx_whisper")
    torch = _check_package_installed("torch")
    pyannote = _check_package_installed("pyannote.audio")
    is_apple = _is_apple_silicon()

    # Determine recommended engine
    recommended = None
    if is_apple and mlx_whisper:
        recommended = "mlx-whisper"
    elif whisperx:
        recommended = "whisperx"

    return MLStatus(
        whisperx_installed=whisperx,
        mlx_whisper_installed=mlx_whisper,
        torch_installed=torch,
        pyannote_installed=pyannote,
        is_apple_silicon=is_apple,
        recommended_engine=recommended,
        install_in_progress=_ml_install_in_progress,
    )


@router.post("/install-ml")
async def install_ml_dependencies():
    """Install ML dependencies for local transcription.

    Returns a streaming response with installation progress.
    For Apple Silicon, installs mlx-whisper (lightweight).
    For other systems, installs whisperx + torch.

    Note: Uses asyncio.create_subprocess_exec with hardcoded package names
    (no shell injection risk - packages are not user input).
    """
    global _ml_install_in_progress

    if _ml_install_in_progress:
        return StreamingResponse(
            iter([f"data: {json.dumps({'status': 'error', 'message': 'Installation already in progress'})}\n\n"]),
            media_type="text/event-stream",
        )

    async def install_stream() -> AsyncIterator[str]:
        global _ml_install_in_progress
        _ml_install_in_progress = True

        try:
            # Determine what to install based on platform
            is_apple = _is_apple_silicon()

            if is_apple:
                # For Apple Silicon, install mlx-whisper (much smaller and faster)
                packages = ["mlx-whisper>=0.4.0"]
                yield f"data: {json.dumps({'status': 'progress', 'message': 'Installing MLX Whisper for Apple Silicon...'})}\n\n"
            else:
                # For other systems, install whisperx + torch
                packages = [
                    "torch>=2.0.0",
                    "torchaudio>=2.0.0",
                    "whisperx>=3.1.0",
                    "pyannote.audio>=3.1.0",
                ]
                yield f"data: {json.dumps({'status': 'progress', 'message': 'Installing WhisperX and dependencies...'})}\n\n"

            # Find pip executable - use sys.executable to ensure we use the right Python
            python_exe = sys.executable
            # Build command as list (no shell, safe from injection)
            pip_cmd = [python_exe, "-m", "pip", "install", "--upgrade"] + packages

            logger.info("Running pip install: %s", " ".join(pip_cmd))
            packages_str = " ".join(packages)
            yield f"data: {json.dumps({'status': 'progress', 'message': f'Running: pip install {packages_str}'})}\n\n"

            # Run pip install using create_subprocess_exec (not shell)
            process = await asyncio.create_subprocess_exec(
                *pip_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            # Stream output
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                line_text = line.decode().strip()
                if line_text:
                    logger.info("pip: %s", line_text)
                    # Send progress updates for key lines
                    if "Downloading" in line_text or "Installing" in line_text or "Successfully" in line_text:
                        yield f"data: {json.dumps({'status': 'progress', 'message': line_text[:200]})}\n\n"

            await process.wait()

            if process.returncode == 0:
                logger.info("ML dependencies installed successfully")
                yield f"data: {json.dumps({'status': 'complete', 'message': 'Installation complete! Restart the app to use local transcription.'})}\n\n"
            else:
                logger.error("pip install failed with code %d", process.returncode)
                yield f"data: {json.dumps({'status': 'error', 'message': f'Installation failed with exit code {process.returncode}'})}\n\n"

        except Exception as e:
            logger.exception("ML installation failed")
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"
        finally:
            _ml_install_in_progress = False

    return StreamingResponse(install_stream(), media_type="text/event-stream")
