"""Adapter factory for dependency injection.

Provides the correct adapter implementations based on the configured tier.
Basic tier uses embedded services (SQLite, WhisperX local, llama.cpp).
Enterprise tier uses external services (PostgreSQL, Ollama, Redis queue).
"""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .config import Settings

if TYPE_CHECKING:
    from core.interfaces import (
        IAIService,
        IAuthProvider,
        IDatabaseAdapter,
        IDiarizationEngine,
        ITranscriptionEngine,
    )

logger = logging.getLogger(__name__)


@dataclass
class AdapterConfig:
    """Configuration for adapter selection."""

    # Database
    database_url: str

    # Transcription engine selection
    transcription_engine: str = "auto"  # auto, whisperx, mlx-whisper
    transcription_model: str = "base"
    transcription_device: str = "auto"  # auto, cpu, cuda, mps
    transcription_compute_type: str = "auto"  # auto, int8, float16, float32

    # External WhisperX
    whisperx_external_url: str | None = None
    whisperx_api_key: str | None = None

    # Diarization
    diarization_device: str = "auto"  # auto, cpu, cuda, mps
    hf_token: str | None = None

    # AI
    ai_model_path: str | None = None
    ai_n_ctx: int = 4096
    ai_n_gpu_layers: int | None = None  # None = auto-detect


class AdapterFactory:
    """Factory for creating adapter instances based on tier configuration.

    Usage:
        from core.config import settings
        from core.factory import AdapterFactory, AdapterConfig

        config = AdapterConfig(database_url=settings.DATABASE_URL)
        factory = AdapterFactory(settings.MODE, config)

        db = await factory.create_database_adapter()
        transcription = factory.create_transcription_engine()
        auth = factory.create_auth_provider()
    """

    def __init__(self, tier: str, config: AdapterConfig):
        """Initialize the adapter factory.

        Args:
            tier: The deployment tier ("basic" or "enterprise")
            config: Adapter configuration
        """
        self._tier = tier
        self._config = config

    @property
    def tier(self) -> str:
        """Get the current tier."""
        return self._tier

    @property
    def is_basic(self) -> bool:
        """Check if running in basic tier."""
        return self._tier == "basic"

    @property
    def is_enterprise(self) -> bool:
        """Check if running in enterprise tier."""
        return self._tier == "enterprise"

    async def create_database_adapter(self) -> "IDatabaseAdapter":
        """Create and initialize a database adapter.

        Basic tier: SQLite adapter
        Enterprise tier: PostgreSQL adapter (not yet implemented)

        Returns:
            Initialized database adapter
        """
        if self.is_basic:
            from adapters.database.sqlite import SQLiteDatabaseAdapter

            logger.info("Creating SQLite database adapter for basic tier")
            adapter = SQLiteDatabaseAdapter(self._config.database_url)
            await adapter.initialize()
            return adapter
        else:
            # Enterprise tier - PostgreSQL (future)
            raise NotImplementedError(
                "PostgreSQL adapter for enterprise tier is not yet implemented. "
                "Use basic tier with SQLite for now."
            )

    def create_transcription_engine(self) -> "ITranscriptionEngine":
        """Create a transcription engine.

        Engine selection priority:
        1. If WHISPERX_EXTERNAL_URL is configured, uses external service.
        2. If engine is "auto", auto-detect based on hardware.
        3. Otherwise use the specified engine.

        Returns:
            Transcription engine instance
        """
        # Use external WhisperX if URL is configured
        if self._config.whisperx_external_url:
            from adapters.transcription.external_whisperx import ExternalWhisperXEngine

            logger.info(
                "Creating external WhisperX engine (url=%s)",
                self._config.whisperx_external_url,
            )

            return ExternalWhisperXEngine(
                base_url=self._config.whisperx_external_url,
                api_key=self._config.whisperx_api_key,
            )

        # Resolve engine selection
        engine = self._config.transcription_engine
        if engine == "auto":
            from core.transcription_settings import detect_optimal_engine
            engine = detect_optimal_engine()
            logger.info("Auto-detected transcription engine: %s", engine)

        # Create engine based on selection
        if engine == "mlx-whisper":
            from adapters.transcription.mlx_whisper import MlxWhisperTranscriptionEngine

            logger.info(
                "Creating MLX Whisper transcription engine (model=%s)",
                self._config.transcription_model,
            )

            return MlxWhisperTranscriptionEngine(
                model_size=self._config.transcription_model,
            )

        # Default: WhisperX
        from adapters.transcription.whisperx import WhisperXTranscriptionEngine

        # Resolve auto-detect for device and compute type
        device = self._config.transcription_device
        if device == "auto":
            from core.transcription_settings import detect_whisperx_device
            device = detect_whisperx_device()
            logger.info("Auto-detected WhisperX device: %s", device)

        compute_type = self._config.transcription_compute_type
        if compute_type == "auto":
            from core.transcription_settings import detect_compute_type
            compute_type = detect_compute_type(device)
            logger.info("Auto-detected compute type: %s", compute_type)

        logger.info(
            "Creating local WhisperX transcription engine (model=%s, device=%s, compute_type=%s)",
            self._config.transcription_model,
            device,
            compute_type,
        )

        return WhisperXTranscriptionEngine(
            model_size=self._config.transcription_model,
            device=device,
            compute_type=compute_type,
        )

    def create_diarization_engine(self) -> "IDiarizationEngine":
        """Create a diarization engine.

        Basic tier: Pyannote (local)
        Enterprise tier: External service or Pyannote (configurable)

        Returns:
            Diarization engine instance
        """
        from adapters.diarization.pyannote import PyannoteDiarizationEngine

        device = self._config.diarization_device
        if device == "auto":
            from core.transcription_settings import detect_diarization_device
            device = detect_diarization_device()
            logger.info("Auto-detected diarization device: %s", device)

        logger.info(
            "Creating Pyannote diarization engine (device=%s)",
            device,
        )

        return PyannoteDiarizationEngine(
            device=device,
            hf_token=self._config.hf_token,
        )

    def create_ai_service(self) -> "IAIService":
        """Create an AI service.

        Basic tier: llama.cpp (local)
        Enterprise tier: Ollama, OpenAI, etc. (future)

        Returns:
            AI service instance
        """
        if self.is_basic:
            from adapters.ai.llama_cpp import LlamaCppAIService

            gpu_layers = self._config.ai_n_gpu_layers
            if gpu_layers is None:
                from core.transcription_settings import detect_llm_gpu_layers
                gpu_layers = detect_llm_gpu_layers()
                logger.info("Auto-detected LLM GPU layers: %d", gpu_layers)

            logger.info("Creating llama.cpp AI service for basic tier")

            return LlamaCppAIService(
                model_path=self._config.ai_model_path,
                n_ctx=self._config.ai_n_ctx,
                n_gpu_layers=gpu_layers,
            )
        else:
            # Enterprise tier - Ollama (future)
            raise NotImplementedError(
                "Enterprise AI services are not yet implemented. "
                "Use basic tier with llama.cpp for now."
            )

    def create_auth_provider(self) -> "IAuthProvider":
        """Create an authentication provider.

        Basic tier: NoAuthProvider (no login required)
        Enterprise tier: LocalAuthProvider or OIDCAuthProvider (future)

        Returns:
            Auth provider instance
        """
        if self.is_basic:
            from adapters.auth.no_auth import NoAuthProvider

            logger.info("Creating NoAuthProvider for basic tier (no authentication)")

            return NoAuthProvider()
        else:
            # Enterprise tier - RBAC auth (future)
            raise NotImplementedError(
                "Enterprise authentication is not yet implemented. "
                "Use basic tier without authentication for now."
            )


def create_factory_from_settings(settings: Settings) -> AdapterFactory:
    """Create an AdapterFactory from application settings.

    Args:
        settings: Application settings

    Returns:
        Configured AdapterFactory
    """
    config = AdapterConfig(
        database_url=settings.DATABASE_URL,
        # WhisperX settings
        transcription_model=settings.WHISPERX_MODEL,
        transcription_device=settings.WHISPERX_DEVICE,
        transcription_compute_type=settings.WHISPERX_COMPUTE_TYPE,
        whisperx_external_url=settings.WHISPERX_EXTERNAL_URL,
        whisperx_api_key=settings.WHISPERX_API_KEY,
        # Diarization settings
        diarization_device=settings.DIARIZATION_DEVICE,
        hf_token=settings.HF_TOKEN,
        # AI settings
        ai_model_path=settings.AI_MODEL_PATH,
        ai_n_ctx=settings.AI_N_CTX,
        ai_n_gpu_layers=settings.AI_N_GPU_LAYERS,
    )

    return AdapterFactory(settings.MODE, config)


# Convenience function for creating adapters from global settings
def get_factory() -> AdapterFactory:
    """Get the adapter factory using global settings."""
    from .config import settings
    return create_factory_from_settings(settings)


def create_transcription_engine_from_settings(settings_dict: dict) -> "ITranscriptionEngine":
    """Create a transcription engine from runtime settings.

    This is useful for creating an engine based on DB-persisted settings
    rather than environment variables.

    Args:
        settings_dict: Settings dict with engine, model, device, compute_type.

    Returns:
        Configured transcription engine.
    """
    engine = settings_dict.get("engine", "auto")

    if engine == "auto":
        from core.transcription_settings import detect_optimal_engine
        engine = detect_optimal_engine()
        logger.info("Auto-detected transcription engine: %s", engine)

    if engine == "mlx-whisper":
        from adapters.transcription.mlx_whisper import MlxWhisperTranscriptionEngine

        logger.info(
            "Creating MLX Whisper transcription engine (model=%s)",
            settings_dict.get("model", "base"),
        )

        return MlxWhisperTranscriptionEngine(
            model_size=settings_dict.get("model", "base"),
        )

    # Default: WhisperX
    from adapters.transcription.whisperx import WhisperXTranscriptionEngine

    device = settings_dict.get("device", "auto")
    if device == "auto":
        from core.transcription_settings import detect_whisperx_device
        device = detect_whisperx_device()
        logger.info("Auto-detected WhisperX device: %s", device)

    compute_type = settings_dict.get("compute_type", "auto")
    if compute_type == "auto":
        from core.transcription_settings import detect_compute_type
        compute_type = detect_compute_type(device)
        logger.info("Auto-detected compute type: %s", compute_type)

    logger.info(
        "Creating WhisperX transcription engine (model=%s, device=%s, compute_type=%s)",
        settings_dict.get("model", "base"),
        device,
        compute_type,
    )

    return WhisperXTranscriptionEngine(
        model_size=settings_dict.get("model", "base"),
        device=device,
        compute_type=compute_type,
    )
