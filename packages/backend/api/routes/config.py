"""Configuration and status endpoints."""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config", tags=["config"])


class WhisperXStatus(BaseModel):
    """WhisperX configuration status."""

    mode: str  # "local" or "external"
    external_url: str | None
    model: str
    device: str
    compute_type: str


class AIStatus(BaseModel):
    """AI configuration status."""

    model_path: str | None
    context_size: int
    gpu_layers: int


class ConfigStatus(BaseModel):
    """Overall configuration status."""

    mode: str  # "basic" or "enterprise"
    whisperx: WhisperXStatus
    ai: AIStatus


@router.get("/status", response_model=ConfigStatus)
async def get_config_status() -> ConfigStatus:
    """Get current configuration status.

    Returns information about the current configuration including
    WhisperX mode (local vs external) and AI settings.
    """
    whisperx_mode = "external" if settings.WHISPERX_EXTERNAL_URL else "local"

    return ConfigStatus(
        mode=settings.MODE,
        whisperx=WhisperXStatus(
            mode=whisperx_mode,
            external_url=settings.WHISPERX_EXTERNAL_URL,
            model=settings.WHISPERX_MODEL,
            device=settings.WHISPERX_DEVICE,
            compute_type=settings.WHISPERX_COMPUTE_TYPE,
        ),
        ai=AIStatus(
            model_path=settings.AI_MODEL_PATH,
            context_size=settings.AI_N_CTX,
            gpu_layers=settings.AI_N_GPU_LAYERS,
        ),
    )
