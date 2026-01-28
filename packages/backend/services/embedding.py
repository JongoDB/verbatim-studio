"""Embedding service for semantic search."""

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Service for generating text embeddings using sentence-transformers.

    Uses nomic-embed-text-v1.5 for high-quality embeddings.
    Lazy loads the model on first use.
    """

    def __init__(self, model_name: str = "nomic-ai/nomic-embed-text-v1.5"):
        """Initialize the embedding service.

        Args:
            model_name: HuggingFace model name for embeddings.
        """
        self._model_name = model_name
        self._model: Any = None

    def _ensure_loaded(self) -> None:
        """Ensure the embedding model is loaded."""
        if self._model is not None:
            return

        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise ImportError(
                "sentence-transformers is not installed. "
                "Install with: pip install sentence-transformers"
            ) from e

        logger.info("Loading embedding model: %s", self._model_name)
        self._model = SentenceTransformer(self._model_name, trust_remote_code=True)
        logger.info("Embedding model loaded successfully")

    def is_available(self) -> bool:
        """Check if sentence-transformers is installed."""
        try:
            import sentence_transformers
            return True
        except ImportError:
            return False

    async def embed_query(self, query: str) -> list[float]:
        """Embed a search query.

        Uses 'search_query:' prefix for optimal retrieval performance.

        Args:
            query: The search query text.

        Returns:
            768-dimensional embedding vector.
        """
        self._ensure_loaded()
        prefixed = f"search_query: {query}"
        embedding = await asyncio.to_thread(self._model.encode, prefixed)
        return embedding.tolist()

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple document texts in batch.

        Uses 'search_document:' prefix for optimal retrieval performance.

        Args:
            texts: List of document texts to embed.

        Returns:
            List of 768-dimensional embedding vectors.
        """
        self._ensure_loaded()
        prefixed = [f"search_document: {t}" for t in texts]
        embeddings = await asyncio.to_thread(self._model.encode, prefixed)
        return embeddings.tolist()


# Singleton instance
embedding_service = EmbeddingService()
