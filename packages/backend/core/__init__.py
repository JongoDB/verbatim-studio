"""Core configuration, interfaces, and adapter factory.

This module provides the foundation for the adapter pattern architecture:
- Settings: Application configuration
- Interfaces: Contracts for swappable implementations
- Factory: Creates the correct adapters based on tier configuration
"""

from .config import Settings, settings
from .factory import (
    AdapterConfig,
    AdapterFactory,
    create_factory_from_settings,
    create_transcription_engine_from_settings,
    get_factory,
)

__all__ = [
    # Configuration
    "Settings",
    "settings",
    # Factory
    "AdapterConfig",
    "AdapterFactory",
    "create_factory_from_settings",
    "create_transcription_engine_from_settings",
    "get_factory",
]
