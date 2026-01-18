"""Transcription engine adapter implementations.

Basic tier: WhisperX adapter (local GPU/CPU)
Enterprise tier: External API adapters (future)
"""

from .whisperx import WhisperXTranscriptionEngine

__all__ = ["WhisperXTranscriptionEngine"]
