"""OCR model catalog for document processing.

Defines available OCR models that can be downloaded from HuggingFace.
Models are stored in the Verbatim Studio models directory alongside LLM models.
"""

from pathlib import Path

from core.config import settings

# Chandra OCR model repository
CHANDRA_REPO = "datalab-to/chandra"

OCR_MODEL_CATALOG: dict[str, dict] = {
    "chandra": {
        "repo": CHANDRA_REPO,
        "size_bytes": 19_500_000_000,  # ~18.2 GiB (9B params, BF16 + tokenizer/config)
        "label": "Chandra VLM (9B)",
        "description": "Vision-language model for high-quality document OCR. Handles complex tables, handwriting, and scanned documents.",
        "default": True,
    },
}


def get_ocr_models_dir() -> Path:
    """Get the OCR models directory within Verbatim storage."""
    return settings.MODELS_DIR / "ocr"


def get_model_path(model_id: str) -> Path | None:
    """Get the storage path for an OCR model."""
    entry = OCR_MODEL_CATALOG.get(model_id)
    if not entry:
        return None
    return get_ocr_models_dir() / model_id


def is_model_downloading(model_id: str) -> bool:
    """Check if a model download is in progress."""
    path = get_model_path(model_id)
    if not path:
        return False
    marker = path / ".downloading"
    return marker.exists()


def is_model_downloaded(model_id: str) -> bool:
    """Check if an OCR model is fully downloaded (not in progress)."""
    path = get_model_path(model_id)
    if not path or not path.exists():
        return False

    # If download is in progress, not yet complete
    if is_model_downloading(model_id):
        return False

    # Check for key model files (safetensors or pytorch files)
    model_files = list(path.glob("*.safetensors")) + list(path.glob("*.bin"))
    return len(model_files) > 0


def get_model_size_on_disk(model_id: str) -> int | None:
    """Get the size of a downloaded model in bytes."""
    path = get_model_path(model_id)
    if not path or not path.exists():
        return None

    total_size = 0
    for file in path.rglob("*"):
        if file.is_file():
            total_size += file.stat().st_size

    return total_size if total_size > 0 else None
