"""Whisper model catalog for transcription.

Defines available whisper models that can be downloaded and used for transcription.
Supports MLX-format models (macOS) and CTranslate2-format models (Windows/Linux).
"""

import sys
from pathlib import Path
from typing import TypedDict


class WhisperModel(TypedDict):
    """Whisper model definition."""

    id: str
    label: str
    description: str
    repo: str
    size_bytes: int
    is_default: bool
    bundled: bool


# Available MLX Whisper models from HuggingFace
WHISPER_MODELS: list[WhisperModel] = [
    {
        "id": "whisper-tiny",
        "label": "Whisper Tiny",
        "description": "Fastest, lowest accuracy. Good for quick drafts.",
        "repo": "mlx-community/whisper-tiny-mlx",
        "size_bytes": 74_418_540,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-base",
        "label": "Whisper Base",
        "description": "Good balance of speed and accuracy. Bundled with app.",
        "repo": "mlx-community/whisper-base-mlx",
        "size_bytes": 143_724_204,
        "is_default": True,
        "bundled": True,
    },
    {
        "id": "whisper-small",
        "label": "Whisper Small",
        "description": "Better accuracy, slower processing.",
        "repo": "mlx-community/whisper-small-mlx",
        "size_bytes": 481_307_592,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-medium",
        "label": "Whisper Medium",
        "description": "High accuracy for difficult audio.",
        "repo": "mlx-community/whisper-medium-mlx",
        "size_bytes": 1_524_924_912,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-large-v3",
        "label": "Whisper Large v3",
        "description": "Best accuracy. Requires 8GB+ RAM.",
        "repo": "mlx-community/whisper-large-v3-mlx",
        "size_bytes": 3_247_898_936,
        "is_default": False,
        "bundled": False,
    },
]

# Available CTranslate2 Whisper models (faster-whisper) for Windows/Linux
WHISPER_MODELS_CT2: list[WhisperModel] = [
    {
        "id": "whisper-tiny",
        "label": "Whisper Tiny",
        "description": "Fastest, lowest accuracy. Good for quick drafts.",
        "repo": "Systran/faster-whisper-tiny",
        "size_bytes": 74_000_000,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-base",
        "label": "Whisper Base",
        "description": "Good balance of speed and accuracy. Bundled with app.",
        "repo": "Systran/faster-whisper-base",
        "size_bytes": 145_000_000,
        "is_default": True,
        "bundled": True,
    },
    {
        "id": "whisper-small",
        "label": "Whisper Small",
        "description": "Better accuracy, slower processing.",
        "repo": "Systran/faster-whisper-small",
        "size_bytes": 484_000_000,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-medium",
        "label": "Whisper Medium",
        "description": "High accuracy for difficult audio.",
        "repo": "Systran/faster-whisper-medium",
        "size_bytes": 1_530_000_000,
        "is_default": False,
        "bundled": False,
    },
    {
        "id": "whisper-large-v3",
        "label": "Whisper Large v3",
        "description": "Best accuracy. Requires 8GB+ RAM.",
        "repo": "Systran/faster-whisper-large-v3",
        "size_bytes": 3_100_000_000,
        "is_default": False,
        "bundled": False,
    },
]


def get_platform_models() -> list[WhisperModel]:
    """Get the model list appropriate for this platform."""
    if sys.platform == "darwin":
        return WHISPER_MODELS
    return WHISPER_MODELS_CT2


def get_whisper_model(model_id: str) -> WhisperModel | None:
    """Get a whisper model by ID."""
    for model in get_platform_models():
        if model["id"] == model_id:
            return model
    return None


def get_default_whisper_model() -> WhisperModel:
    """Get the default whisper model."""
    models = get_platform_models()
    for model in models:
        if model["is_default"]:
            return model
    return models[1]  # whisper-base as fallback


def get_hf_cache_dir() -> Path:
    """Get the HuggingFace cache directory."""
    return Path.home() / ".cache" / "huggingface" / "hub"


def get_model_cache_path(repo: str) -> Path:
    """Get the cache path for a model repo.

    HuggingFace stores models in directories like:
    ~/.cache/huggingface/hub/models--mlx-community--whisper-base-mlx/
    """
    # Convert repo to cache directory name (replace / with --)
    cache_name = f"models--{repo.replace('/', '--')}"
    return get_hf_cache_dir() / cache_name


def is_model_downloaded(model_id: str) -> bool:
    """Check if a whisper model is downloaded.

    Looks for weights.npz (MLX) or model.bin (CTranslate2) in the HuggingFace cache.
    """
    model = get_whisper_model(model_id)
    if not model:
        return False

    cache_path = get_model_cache_path(model["repo"])

    if not cache_path.exists():
        return False

    # Look for model weights in snapshots directory
    snapshots_dir = cache_path / "snapshots"
    if not snapshots_dir.exists():
        return False

    # Check any snapshot for weights.npz (MLX) or model.bin (CTranslate2)
    for snapshot in snapshots_dir.iterdir():
        if snapshot.is_dir():
            if (snapshot / "weights.npz").exists() or (snapshot / "model.bin").exists():
                return True

    return False


def get_model_size_on_disk(model_id: str) -> int | None:
    """Get the size of a downloaded model on disk."""
    model = get_whisper_model(model_id)
    if not model:
        return None

    cache_path = get_model_cache_path(model["repo"])

    if not cache_path.exists():
        return None

    total_size = 0
    for file_path in cache_path.rglob("*"):
        if file_path.is_file():
            total_size += file_path.stat().st_size

    return total_size if total_size > 0 else None


def model_id_to_mlx_repo(model_id: str) -> str | None:
    """Convert a model ID to its MLX HuggingFace repo path."""
    for model in WHISPER_MODELS:
        if model["id"] == model_id:
            return model["repo"]
    return None


def mlx_size_to_model_id(size: str) -> str:
    """Convert MLX whisper size string to model ID.

    E.g., "base" -> "whisper-base"
    """
    return f"whisper-{size}"
