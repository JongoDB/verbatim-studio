"""AI service adapter implementations.

Basic tier: LlamaCppAIService (local llama.cpp)
Enterprise tier: OllamaAIService, OpenAIService, etc. (future)
"""

from .llama_cpp import LlamaCppAIService

__all__ = ["LlamaCppAIService"]
