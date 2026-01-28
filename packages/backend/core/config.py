"""Application configuration."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # Deployment mode
    MODE: Literal["basic", "enterprise"] = "basic"

    # API settings
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./verbatim.db"

    # Data paths
    # macOS-specific path (cross-platform support in future phases)
    DATA_DIR: Path = Path.home() / "Library" / "Application Support" / "Verbatim Studio"
    MEDIA_DIR: Path | None = None
    MODELS_DIR: Path | None = None

    # Auth (disabled in basic mode)
    AUTH_ENABLED: bool = False

    # AI settings (llama.cpp)
    AI_MODEL_PATH: str | None = None  # Path to GGUF model file
    AI_N_CTX: int = 8192  # Context window size
    AI_N_GPU_LAYERS: int | None = None  # GPU layers to offload (None = auto-detect, 0 = CPU, -1 = all)

    # WhisperX settings
    WHISPERX_EXTERNAL_URL: str | None = None  # URL for external WhisperX service (None = local)
    WHISPERX_API_KEY: str | None = None  # Optional API key for external service
    WHISPERX_MODEL: str = "base"  # Model size: tiny, base, small, medium, large-v2, large-v3
    WHISPERX_DEVICE: str = "auto"  # Device: auto, cpu, cuda, mps
    WHISPERX_COMPUTE_TYPE: str = "auto"  # Compute type: auto, int8, float16, float32

    # Diarization settings
    DIARIZATION_DEVICE: str = "auto"  # Device: auto, cpu, cuda, mps

    # HuggingFace token for pyannote speaker diarization
    HF_TOKEN: str | None = None

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Set derived paths
        if self.MEDIA_DIR is None:
            self.MEDIA_DIR = self.DATA_DIR / "media"
        if self.MODELS_DIR is None:
            self.MODELS_DIR = self.DATA_DIR / "models"

    def ensure_directories(self) -> None:
        """Create required directories."""
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        self.MODELS_DIR.mkdir(parents=True, exist_ok=True)

    model_config = {"env_prefix": "VERBATIM_", "env_file": ".env"}


settings = Settings()
