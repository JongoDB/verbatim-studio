"""Pyannote model catalog for speaker diarization.

Defines the pyannote models required for speaker diarization.
All pyannote models are gated and require HuggingFace authentication.
"""

from pathlib import Path
from typing import TypedDict


class PyannoteModel(TypedDict):
    """Pyannote model definition."""

    id: str
    label: str
    description: str
    repo: str
    size_bytes: int
    required: bool  # Whether this model is required for diarization


# Pyannote models required for speaker diarization
# All models are gated and require HF token with accepted license agreement
PYANNOTE_MODELS: list[PyannoteModel] = [
    {
        "id": "pyannote-diarization",
        "label": "Speaker Diarization 3.1",
        "description": "Identifies different speakers in audio. Automatically downloads required component models.",
        "repo": "pyannote/speaker-diarization-3.1",
        "size_bytes": 100_000_000,  # ~100 MB (pipeline + components)
        "required": True,
    },
]


def get_pyannote_model(model_id: str) -> PyannoteModel | None:
    """Get a pyannote model by ID."""
    for model in PYANNOTE_MODELS:
        if model["id"] == model_id:
            return model
    return None


def get_torch_cache_dir() -> Path:
    """Get the torch/pyannote cache directory."""
    return Path.home() / ".cache" / "torch" / "pyannote"


def get_hf_cache_dir() -> Path:
    """Get the HuggingFace cache directory."""
    return Path.home() / ".cache" / "huggingface" / "hub"


def get_model_cache_path(repo: str) -> Path:
    """Get the HuggingFace cache path for a model repo.

    HuggingFace stores models in directories like:
    ~/.cache/huggingface/hub/models--pyannote--segmentation-3.0/
    """
    cache_name = f"models--{repo.replace('/', '--')}"
    return get_hf_cache_dir() / cache_name


def is_model_downloaded(model_id: str) -> bool:
    """Check if a pyannote model is downloaded.

    Looks for the model in the HuggingFace cache.
    """
    model = get_pyannote_model(model_id)
    if not model:
        return False

    cache_path = get_model_cache_path(model["repo"])

    if not cache_path.exists():
        return False

    # Check for snapshots directory with content
    snapshots_dir = cache_path / "snapshots"
    if not snapshots_dir.exists():
        return False

    # Check any snapshot for model files
    for snapshot in snapshots_dir.iterdir():
        if snapshot.is_dir():
            # Pyannote models have various files, check for pytorch_model.bin or model.safetensors
            for file in ["pytorch_model.bin", "model.safetensors", "config.yaml"]:
                if (snapshot / file).exists():
                    return True

    return False


def get_model_size_on_disk(model_id: str) -> int | None:
    """Get the size of a downloaded model on disk."""
    model = get_pyannote_model(model_id)
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


def are_all_models_downloaded() -> bool:
    """Check if all required pyannote models are downloaded."""
    for model in PYANNOTE_MODELS:
        if model["required"] and not is_model_downloaded(model["id"]):
            return False
    return True


def get_missing_models() -> list[PyannoteModel]:
    """Get list of required models that are not yet downloaded."""
    return [m for m in PYANNOTE_MODELS if m["required"] and not is_model_downloaded(m["id"])]
