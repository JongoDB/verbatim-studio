"""Health check endpoints."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    """Basic health check."""
    return {"status": "healthy"}


@router.get("/health/ready")
async def readiness_check() -> dict:
    """Readiness check including dependencies."""
    # TODO: Check database, ML services
    return {
        "status": "ready",
        "services": {
            "database": "healthy",
            "whisper": "not_configured",
            "llama": "not_configured",
        },
    }
