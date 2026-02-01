"""OCR model catalog for document processing.

Defines available OCR models that can be downloaded from HuggingFace.
Unlike LLM models (GGUF files), OCR models use HuggingFace's snapshot_download
and are stored in the HuggingFace cache directory.
"""

from pathlib import Path

# Chandra OCR model repository
CHANDRA_REPO = "datalab-to/chandra"

OCR_MODEL_CATALOG: dict[str, dict] = {
    "chandra": {
        "repo": CHANDRA_REPO,
        "size_bytes": 17_200_000_000,  # ~17GB (9B params, BF16)
        "label": "Chandra VLM (9B)",
        "description": "Vision-language model for high-quality document OCR. Handles complex tables, handwriting, and scanned documents.",
        "default": True,
    },
}


def get_hf_cache_dir() -> Path:
    """Get the HuggingFace cache directory."""
    import os
    # HuggingFace uses XDG_CACHE_HOME or ~/.cache
    cache_home = os.environ.get("HF_HOME") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    if cache_home:
        return Path(cache_home)

    xdg_cache = os.environ.get("XDG_CACHE_HOME")
    if xdg_cache:
        return Path(xdg_cache) / "huggingface" / "hub"

    return Path.home() / ".cache" / "huggingface" / "hub"


def get_model_cache_path(model_id: str) -> Path | None:
    """Get the cache path for an OCR model.

    HuggingFace stores models in: ~/.cache/huggingface/hub/models--{org}--{repo}
    """
    entry = OCR_MODEL_CATALOG.get(model_id)
    if not entry:
        return None

    # Convert repo format (org/name) to cache format (models--org--name)
    repo = entry["repo"]
    cache_name = "models--" + repo.replace("/", "--")
    return get_hf_cache_dir() / cache_name


def is_model_downloaded(model_id: str) -> bool:
    """Check if an OCR model is downloaded."""
    path = get_model_cache_path(model_id)
    if not path:
        return False

    # Check if the model directory exists and has snapshots
    snapshots_dir = path / "snapshots"
    if not snapshots_dir.exists():
        return False

    # Check if there's at least one snapshot with model files
    for snapshot in snapshots_dir.iterdir():
        if snapshot.is_dir() and any(snapshot.iterdir()):
            return True

    return False


def get_model_size_on_disk(model_id: str) -> int | None:
    """Get the size of a downloaded model in bytes."""
    path = get_model_cache_path(model_id)
    if not path or not path.exists():
        return None

    total_size = 0
    for file in path.rglob("*"):
        if file.is_file():
            total_size += file.stat().st_size

    return total_size if total_size > 0 else None
