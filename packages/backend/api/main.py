"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import ai, archive, config, health, jobs, projects, recordings, search, speakers, stats, tags, transcripts
from core.config import settings
from persistence import init_db
from services.jobs import job_queue


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
    version="0.1.0",
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
app.include_router(ai.router, prefix="/api")
app.include_router(archive.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(tags.router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Verbatim Studio API",
        "version": "0.1.0",
        "mode": settings.MODE,
    }
