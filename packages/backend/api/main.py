"""FastAPI application entry point."""

import subprocess
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.formparsers import MultiPartParser

from api.routes import ai, archive, config, health, jobs, live, project_analytics, project_types, projects, recording_templates, recordings, search, speakers, stats, system, tags, transcripts
from api.routes.comments import comments_router, segment_comments_router
from api.routes.documents import router as documents_router
from api.routes.notes import router as notes_router
from api.routes.highlights import segment_highlights_router, transcript_highlights_router
from core.config import settings
from persistence import init_db
from services.jobs import job_queue


def _get_git_version() -> str:
    """Read version from git tags at startup."""
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


APP_VERSION = _get_git_version()

# Allow uploads up to 10 GB (Starlette default is 1 GB)
MultiPartParser.max_file_size = 10 * 1024 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    settings.ensure_directories()
    await init_db()
    yield
    # Shutdown
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


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Verbatim Studio API",
        "version": APP_VERSION,
        "mode": settings.MODE,
    }
