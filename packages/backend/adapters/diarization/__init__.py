"""Diarization engine adapter implementations.

Basic tier: Pyannote adapter (local GPU/CPU)
Enterprise tier: External API adapters (future)
"""

from .pyannote import PyannoteDiarizationEngine

__all__ = ["PyannoteDiarizationEngine"]
