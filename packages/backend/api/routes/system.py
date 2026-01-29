"""System information endpoints."""

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from core.config import settings
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


class StorageBreakdown(BaseModel):
    """Breakdown of Verbatim storage usage."""

    media_bytes: int
    media_count: int
    database_bytes: int
    models_bytes: int
    models_count: int
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
    models_bytes, models_count = get_dir_size(settings.MODELS_DIR)
    database_bytes = get_file_size(db_path)

    storage_breakdown = StorageBreakdown(
        media_bytes=media_bytes,
        media_count=media_count,
        database_bytes=database_bytes,
        models_bytes=models_bytes,
        models_count=models_count,
        total_bytes=media_bytes + database_bytes + models_bytes,
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
