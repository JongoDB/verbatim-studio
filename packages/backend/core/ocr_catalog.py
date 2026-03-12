"""OCR model catalog for document processing.

Defines available OCR models that can be downloaded from HuggingFace.
Models are stored in the Verbatim Studio models directory alongside LLM models.
"""

import json
import logging
from pathlib import Path

from core.config import settings

logger = logging.getLogger(__name__)

# Qwen2-VL OCR model repository (fine-tuned for OCR)
QWEN2_VL_OCR_REPO = "prithivMLmods/Qwen2-VL-OCR-2B-Instruct"

OCR_MODEL_CATALOG: dict[str, dict] = {
    "qwen2-vl-ocr": {
        "repo": QWEN2_VL_OCR_REPO,
        "size_bytes": 4_750_000_000,  # ~4.42 GB (2B params, BF16 + tokenizer)
        "label": "Qwen2-VL OCR (2B)",
        "description": "Lightweight vision-language model fine-tuned for OCR. Fast inference on CPU/GPU/MPS with good accuracy.",
        "default": False,
        "tier": "legacy",
        "ram_gb": 5,
        "requires_hf_token": False,
        "license_url": None,
        "legacy_note": "Granite Vision 3.3 is now the recommended default.",
        "architecture": "qwen2-vl",
    },
    "granite-vision-3.3-2b": {
        "repo": "ibm-granite/granite-vision-3.3-2b",
        "size_bytes": 5_960_000_000,  # ~5.96 GB
        "label": "Granite Vision 3.3 2B",
        "description": "IBM's latest vision model. Improved accuracy over Qwen2-VL with similar speed.",
        "default": True,
        "tier": "standard",
        "ram_gb": 8,
        "requires_hf_token": False,
        "license_url": None,
        "legacy_note": None,
        "architecture": "granite-vision",
    },
    "llama-3.2-vision-11b": {
        "repo": "meta-llama/Llama-3.2-11B-Vision-Instruct",
        "size_bytes": 21_000_000_000,  # ~21 GB
        "label": "Llama 3.2 Vision 11B",
        "description": "Meta's 11B vision model. Higher quality OCR for complex documents. Uses ~40-80 GB RAM during inference. Requires HuggingFace token.",
        "default": False,
        "tier": "pro",
        "ram_gb": 48,
        "requires_hf_token": True,
        "license_url": "https://huggingface.co/meta-llama/Llama-3.2-11B-Vision-Instruct",
        "legacy_note": None,
        "architecture": "llama-vision",
    },
    "llama-3.2-vision-90b": {
        "repo": "meta-llama/Llama-3.2-90B-Vision-Instruct",
        "size_bytes": 176_000_000_000,  # ~176 GB
        "label": "Llama 3.2 Vision 90B",
        "description": "Meta's flagship 90B vision model. Requires 180+ GB RAM/VRAM (full precision only). Not usable on most consumer hardware. Requires HuggingFace token.",
        "default": False,
        "tier": "max",
        "ram_gb": 200,
        "requires_hf_token": True,
        "license_url": "https://huggingface.co/meta-llama/Llama-3.2-90B-Vision-Instruct",
        "legacy_note": None,
        "architecture": "llama-vision",
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

    # Check for model weights AND processor files required by AutoProcessor
    has_weights = list(path.glob("*.safetensors")) or list(path.glob("*.bin"))
    has_processor = (path / "preprocessor_config.json").exists()
    return bool(has_weights) and has_processor


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


# ── Active OCR model tracking ────────────────────────────────────────

def _active_ocr_model_path() -> Path:
    """Path to the JSON file tracking which OCR model is active."""
    return get_ocr_models_dir() / "active_ocr_model.json"


def _read_active_ocr_model() -> str | None:
    """Read the currently active OCR model ID from disk.

    Handles fresh installs vs existing installs:
    - If file exists, respect its content (explicit user choice)
    - If file doesn't exist AND granite-vision is downloaded, return granite-vision (fresh install default)
    - If file doesn't exist AND only qwen2-vl-ocr is downloaded, return qwen2-vl-ocr (existing install)
    """
    p = _active_ocr_model_path()
    if p.exists():
        try:
            data = json.loads(p.read_text())
            return data.get("model_id")
        except (json.JSONDecodeError, OSError):
            pass

    # No explicit choice -- pick the best downloaded model
    if is_model_downloaded("granite-vision-3.3-2b"):
        return "granite-vision-3.3-2b"
    if is_model_downloaded("qwen2-vl-ocr"):
        return "qwen2-vl-ocr"

    # Check other models in tier order
    for model_id in ("llama-3.2-vision-11b", "llama-3.2-vision-90b"):
        if is_model_downloaded(model_id):
            return model_id

    return None


def _write_active_ocr_model(model_id: str) -> None:
    """Persist the active OCR model ID."""
    settings.ensure_directories()
    ocr_dir = get_ocr_models_dir()
    ocr_dir.mkdir(parents=True, exist_ok=True)
    _active_ocr_model_path().write_text(json.dumps({"model_id": model_id}))
    logger.info("Active OCR model set to: %s", model_id)
