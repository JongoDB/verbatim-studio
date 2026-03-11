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
        "max_context": 131072,
        "tier": "standard",
        "ram_gb": 5,
    },
    "mistral-small-3.2-24b": {
        "repo": "bartowski/mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF",
        "filename": "mistralai_Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf",
        "size_bytes": 14_300_000_000,
        "label": "Mistral Small 3.2 24B",
        "description": "Mistral's 24B instruct model. Higher quality reasoning and multilingual support.",
        "default": False,
        "max_context": 131072,
        "tier": "pro",
        "ram_gb": 14,
    },
    "llama-3.3-70b": {
        "repo": "bartowski/Llama-3.3-70B-Instruct-GGUF",
        "filename": "Llama-3.3-70B-Instruct-Q4_K_M.gguf",
        "size_bytes": 42_500_000_000,
        "label": "Llama 3.3 70B Instruct",
        "description": "Meta's flagship 70B model. Best quality for complex analysis. Requires 40+ GB RAM/VRAM.",
        "default": False,
        "max_context": 131072,
        "tier": "max",
        "ram_gb": 40,
    },
}
