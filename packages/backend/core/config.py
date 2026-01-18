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
    DATA_DIR: Path = Path.home() / "Library" / "Application Support" / "Verbatim Studio"
    MEDIA_DIR: Path | None = None
    MODELS_DIR: Path | None = None

    # Auth (disabled in basic mode)
    AUTH_ENABLED: bool = False

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

    model_config = {"env_prefix": "VERBATIM_"}


settings = Settings()
