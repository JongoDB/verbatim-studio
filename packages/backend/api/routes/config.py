"""Configuration and status endpoints."""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import settings
from core.transcription_settings import (
    PRESETS,
    VALID_BATCH_SIZES,
    VALID_COMPUTE_TYPES,
    VALID_DEVICES,
    VALID_MODELS,
    detect_available_devices,
    get_transcription_settings,
    save_transcription_settings,
)

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


# --- Transcription Settings ---


class PresetInfo(BaseModel):
    """Preset configuration card info."""

    model: str
    compute_type: str
    batch_size: int


class TranscriptionSettingsResponse(BaseModel):
    """Effective transcription settings + capabilities."""

    # Effective values
    model: str
    device: str
    compute_type: str
    batch_size: int
    diarize: bool
    hf_token_set: bool
    hf_token_masked: str | None

    # External mode info
    mode: str  # "local" or "external"
    external_url: str | None

    # Available options for UI dropdowns
    available_models: list[str]
    available_devices: list[str]
    available_compute_types: list[str]
    available_batch_sizes: list[int]

    # Presets
    presets: dict[str, PresetInfo]


class TranscriptionSettingsUpdate(BaseModel):
    """Partial update for transcription settings."""

    model: str | None = None
    device: str | None = None
    compute_type: str | None = None
    batch_size: int | None = None
    diarize: bool | None = None
    hf_token: str | None = None


def _mask_token(token: str | None) -> str | None:
    if not token:
        return None
    if len(token) <= 4:
        return "****"
    return "****" + token[-4:]


def _build_response(effective: dict[str, Any]) -> TranscriptionSettingsResponse:
    hf_token = effective.get("hf_token")
    return TranscriptionSettingsResponse(
        model=effective["model"],
        device=effective["device"],
        compute_type=effective["compute_type"],
        batch_size=effective["batch_size"],
        diarize=effective["diarize"],
        hf_token_set=bool(hf_token),
        hf_token_masked=_mask_token(hf_token),
        mode="external" if settings.WHISPERX_EXTERNAL_URL else "local",
        external_url=settings.WHISPERX_EXTERNAL_URL,
        available_models=VALID_MODELS,
        available_devices=detect_available_devices(),
        available_compute_types=VALID_COMPUTE_TYPES,
        available_batch_sizes=VALID_BATCH_SIZES,
        presets={k: PresetInfo(**v) for k, v in PRESETS.items()},
    )


@router.get("/transcription", response_model=TranscriptionSettingsResponse)
async def get_transcription_config() -> TranscriptionSettingsResponse:
    """Get effective transcription settings and available options."""
    effective = await get_transcription_settings()
    return _build_response(effective)


@router.put("/transcription", response_model=TranscriptionSettingsResponse)
async def update_transcription_config(
    body: TranscriptionSettingsUpdate,
) -> TranscriptionSettingsResponse:
    """Update transcription settings. Only provided fields are changed."""
    updates: dict[str, Any] = {}

    if body.model is not None:
        if body.model not in VALID_MODELS:
            raise HTTPException(400, f"Invalid model: {body.model}. Must be one of: {VALID_MODELS}")
        updates["model"] = body.model

    if body.device is not None:
        if body.device not in VALID_DEVICES:
            raise HTTPException(400, f"Invalid device: {body.device}. Must be one of: {VALID_DEVICES}")
        updates["device"] = body.device

    if body.compute_type is not None:
        if body.compute_type not in VALID_COMPUTE_TYPES:
            raise HTTPException(400, f"Invalid compute_type: {body.compute_type}. Must be one of: {VALID_COMPUTE_TYPES}")
        updates["compute_type"] = body.compute_type

    if body.batch_size is not None:
        if body.batch_size not in VALID_BATCH_SIZES:
            raise HTTPException(400, f"Invalid batch_size: {body.batch_size}. Must be one of: {VALID_BATCH_SIZES}")
        updates["batch_size"] = body.batch_size

    if body.diarize is not None:
        updates["diarize"] = body.diarize

    if body.hf_token is not None:
        updates["hf_token"] = body.hf_token

    if not updates:
        raise HTTPException(400, "No valid fields provided")

    await save_transcription_settings(updates)
    effective = await get_transcription_settings()
    return _build_response(effective)
