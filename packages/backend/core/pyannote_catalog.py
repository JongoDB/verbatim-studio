"""Pyannote model catalog for speaker diarization.

Defines the pyannote models required for speaker diarization.
The diarization pipeline (speaker-diarization-3.1) is a config-only repo
that orchestrates two neural network sub-models:
  - pyannote/segmentation-3.0 (5.9 MB, gated)
  - pyannote/wespeaker-voxceleb-resnet34-LM (26.6 MB, public)

All gated models require a HuggingFace token with accepted license agreements.
Downloads are managed explicitly — no auto-downloads at runtime.
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


class DiarizationComponent(TypedDict):
    """A single HuggingFace repo that the diarization pipeline depends on."""

    repo: str
    expected_file: str  # File to check for to confirm download


# The three HuggingFace repos that make up the diarization pipeline.
# All three must be downloaded for diarization to work.
DIARIZATION_COMPONENTS: list[DiarizationComponent] = [
    {
        "repo": "pyannote/speaker-diarization-3.1",
        "expected_file": "config.yaml",
    },
    {
        "repo": "pyannote/segmentation-3.0",
        "expected_file": "pytorch_model.bin",
    },
    {
        "repo": "pyannote/wespeaker-voxceleb-resnet34-LM",
        "expected_file": "pytorch_model.bin",
    },
]

# Single catalog entry shown in the Settings UI.
# Downloading this entry downloads all three components above.
PYANNOTE_MODELS: list[PyannoteModel] = [
    {
        "id": "pyannote-diarization",
        "label": "Speaker Diarization 3.1",
        "description": "Identifies different speakers in audio (~33 MB total).",
        "repo": "pyannote/speaker-diarization-3.1",
        "size_bytes": 33_000_000,
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
    """Get the torch/pyannote cache directory (where pyannote looks at runtime)."""
    import os
    return Path(os.environ.get("PYANNOTE_CACHE", Path.home() / ".cache" / "torch" / "pyannote"))


def get_hf_cache_dir() -> Path:
    """Get the HuggingFace hub cache directory."""
    return Path.home() / ".cache" / "huggingface" / "hub"


def _repo_cache_name(repo: str) -> str:
    """Convert a HF repo ID to cache directory name."""
    return f"models--{repo.replace('/', '--')}"


def _is_repo_cached(repo: str, expected_file: str) -> bool:
    """Check if a single HF repo is present in the torch/pyannote cache."""
    cache_dir = get_torch_cache_dir() / _repo_cache_name(repo)
    if not cache_dir.exists():
        return False

    # Check snapshots directory (standard HF hub cache structure)
    snapshots_dir = cache_dir / "snapshots"
    if snapshots_dir.exists():
        for snapshot in snapshots_dir.iterdir():
            if snapshot.is_dir() and (snapshot / expected_file).exists():
                return True

    # Fallback: check blobs directory for files with substantial size
    # (handles cases where pyannote auto-downloaded before this fix)
    blobs_dir = cache_dir / "blobs"
    if blobs_dir.exists():
        for blob in blobs_dir.iterdir():
            if blob.is_file() and blob.stat().st_size > 1000:
                return True

    return False


def is_model_downloaded(model_id: str) -> bool:
    """Check if all diarization components are downloaded.

    Checks the torch/pyannote cache directory, which is where
    pyannote.audio looks for models at runtime.
    """
    if model_id != "pyannote-diarization":
        model = get_pyannote_model(model_id)
        return model is not None and False

    return all(
        _is_repo_cached(c["repo"], c["expected_file"])
        for c in DIARIZATION_COMPONENTS
    )


def get_model_size_on_disk(model_id: str) -> int | None:
    """Get the total size of all diarization components on disk."""
    if model_id != "pyannote-diarization":
        return None

    torch_cache = get_torch_cache_dir()
    total_size = 0

    for component in DIARIZATION_COMPONENTS:
        cache_path = torch_cache / _repo_cache_name(component["repo"])
        if cache_path.exists():
            for file_path in cache_path.rglob("*"):
                if file_path.is_file():
                    total_size += file_path.stat().st_size

    return total_size if total_size > 0 else None


def are_all_models_downloaded() -> bool:
    """Check if all required pyannote models are downloaded."""
    return is_model_downloaded("pyannote-diarization")


def get_missing_models() -> list[PyannoteModel]:
    """Get list of required models that are not yet downloaded."""
    return [m for m in PYANNOTE_MODELS if m["required"] and not is_model_downloaded(m["id"])]


def get_missing_components() -> list[str]:
    """Get list of component repos that are not yet downloaded."""
    return [
        c["repo"] for c in DIARIZATION_COMPONENTS
        if not _is_repo_cached(c["repo"], c["expected_file"])
    ]
