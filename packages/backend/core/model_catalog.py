"""Curated model catalog for local LLM inference.

Defines available GGUF models that can be downloaded from HuggingFace.
"""

MODEL_CATALOG: dict[str, dict] = {
    "granite-3.3-2b": {
        "repo": "bartowski/ibm-granite_granite-3.3-2b-instruct-GGUF",
        "filename": "ibm-granite_granite-3.3-2b-instruct-Q4_K_M.gguf",
        "size_bytes": 1_664_540_672,
        "label": "Granite 3.3 2B",
        "description": "IBM's compact instruct model. Good for summarization and analysis.",
        "default": True,
    },
}
