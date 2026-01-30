"""Curated model catalog for local LLM inference.

Defines available GGUF models that can be downloaded from HuggingFace.
"""

MODEL_CATALOG: dict[str, dict] = {
    "granite-3.3-8b": {
        "repo": "bartowski/ibm-granite_granite-3.3-8b-instruct-GGUF",
        "filename": "ibm-granite_granite-3.3-8b-instruct-Q4_K_M.gguf",
        "size_bytes": 4_920_000_000,
        "label": "Granite 3.3 8B",
        "description": "IBM's instruct model. Recommended for chat and analysis.",
        "default": True,
    },
    "granite-3.3-2b": {
        "repo": "bartowski/ibm-granite_granite-3.3-2b-instruct-GGUF",
        "filename": "ibm-granite_granite-3.3-2b-instruct-Q4_K_M.gguf",
        "size_bytes": 1_664_540_672,
        "label": "Granite 3.3 2B (Lite)",
        "description": "Compact model for low-RAM systems. Good for basic tasks.",
        "default": False,
    },
}
