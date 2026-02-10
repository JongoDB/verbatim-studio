"""FastAPI application entry point."""

import os
import sys

def _setup_ffmpeg_path():
    """Add bundled ffmpeg to PATH when running in Electron.

    This must be done early, before any transcription libraries try to use ffmpeg.
    """
    if os.environ.get("VERBATIM_ELECTRON") != "1":
        return

    from pathlib import Path

    # In Electron, we're running from resources/python/bin/python3
    # FFmpeg is at resources/ffmpeg/ffmpeg
    python_exe = Path(sys.executable)

    # Go up from python/bin/python3 to resources, then into ffmpeg
    # resources/python/bin/python3 -> resources/python/bin -> resources/python -> resources -> resources/ffmpeg
    resources_path = python_exe.parent.parent.parent
    ffmpeg_dir = resources_path / "ffmpeg"

    if ffmpeg_dir.exists():
        # Prepend ffmpeg directory to PATH
        current_path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{ffmpeg_dir}{os.pathsep}{current_path}"
        print(f"[Startup] Added bundled ffmpeg to PATH: {ffmpeg_dir}")
    else:
        print(f"[Startup] Warning: Bundled ffmpeg not found at {ffmpeg_dir}")

# Set up ffmpeg path early, before any imports that might need it
_setup_ffmpeg_path()

# Fix PyTorch 2.6+ weights_only=True default breaking older model checkpoints
# This must be done before any model loading occurs
try:
    import torch.serialization
    import torch.torch_version
    import omegaconf
    from omegaconf import DictConfig, ListConfig
    from omegaconf.base import ContainerMetadata, Metadata
    from omegaconf.nodes import ValueNode
    from pyannote.audio.core.task import Specifications, Problem, Resolution
    # Allow classes used by pyannote/whisperx model checkpoints
    torch.serialization.add_safe_globals([
        ListConfig,
        DictConfig,
        ContainerMetadata,
        Metadata,
        ValueNode,
        # Include base module classes
        omegaconf.listconfig.ListConfig,
        omegaconf.dictconfig.DictConfig,
        # PyTorch internal class stored in some checkpoints
        torch.torch_version.TorchVersion,
        # pyannote model checkpoint classes
        Specifications,
        Problem,
        Resolution,
    ])
except ImportError:
    pass  # torch or omegaconf not installed yet

import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.formparsers import MultiPartParser

from api.routes import ai, archive, config, health, jobs, live, project_analytics, project_types, projects, recording_templates, recordings, search, speakers, stats, system, tags, transcripts
from api.routes.comments import comments_router, segment_comments_router
from api.routes.documents import router as documents_router
from api.routes.notes import router as notes_router
from api.routes.browse import router as browse_router
from api.routes.highlights import segment_highlights_router, transcript_highlights_router
from api.routes.storage_locations import router as storage_locations_router
from api.routes.oauth import router as oauth_router
from api.routes.ocr import router as ocr_router
from api.routes.conversations import router as conversations_router
from api.routes.sync import router as sync_router
from api.routes.whisper import router as whisper_router
from api.routes.diarization import router as diarization_router
from core.config import settings
from persistence import init_db
from services.file_watcher import FileWatcherService
from services.jobs import job_queue

# Global file watcher instance
file_watcher: FileWatcherService | None = None


def _get_version() -> str:
    """Read version from pyproject.toml or git tags at startup."""
    # First try pyproject.toml (works in packaged Electron app)
    try:
        import tomllib
        pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
        if pyproject_path.exists():
            with open(pyproject_path, "rb") as f:
                data = tomllib.load(f)
                version = data.get("project", {}).get("version")
                if version:
                    return f"v{version}"
    except Exception:
        pass

    # Fall back to git describe (works in development)
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


APP_VERSION = _get_version()

# Allow uploads up to 10 GB (Starlette default is 1 GB)
MultiPartParser.max_file_size = 10 * 1024 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global file_watcher

    # Startup
    settings.ensure_directories()
    await init_db()

    # Start file watcher for external file detection
    file_watcher = FileWatcherService(settings.MEDIA_DIR)
    file_watcher.start()

    yield

    # Shutdown
    if file_watcher:
        file_watcher.stop()
    job_queue.shutdown(wait=True)


app = FastAPI(
    title="Verbatim Studio API",
    description="Privacy-first transcription backend",
    version=APP_VERSION,
    lifespan=lifespan,
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Range", "Content-Type"],
)

# Routes
app.include_router(health.router)
app.include_router(recordings.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(transcripts.router, prefix="/api")
app.include_router(speakers.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(project_analytics.router, prefix="/api")
app.include_router(project_types.router, prefix="/api")
app.include_router(recording_templates.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(archive.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(live.router, prefix="/api")
app.include_router(segment_comments_router, prefix="/api")
app.include_router(comments_router, prefix="/api")
app.include_router(segment_highlights_router, prefix="/api")
app.include_router(transcript_highlights_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(browse_router, prefix="/api")
app.include_router(storage_locations_router, prefix="/api")
app.include_router(ocr_router, prefix="/api")
app.include_router(oauth_router)  # Has its own /api prefix
app.include_router(conversations_router, prefix="/api")
app.include_router(sync_router, prefix="/api")  # WebSocket sync endpoint
app.include_router(whisper_router, prefix="/api")
app.include_router(diarization_router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Verbatim Studio API",
        "version": APP_VERSION,
        "mode": settings.MODE,
    }


@app.get("/api/info")
async def api_info():
    """API info endpoint (accessible through Vite proxy)."""
    return {
        "name": "Verbatim Studio API",
        "version": APP_VERSION,
        "mode": settings.MODE,
    }
