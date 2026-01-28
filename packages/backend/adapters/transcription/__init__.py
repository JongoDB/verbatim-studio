"""Transcription engine adapter implementations.

Basic tier: WhisperX adapter (local GPU/CPU), MLX Whisper (Apple Silicon)
Enterprise tier: External API adapters (future)
"""

from .whisperx import WhisperXTranscriptionEngine

# MLX Whisper import is conditional - only available on Apple Silicon
try:
    from .mlx_whisper import MlxWhisperTranscriptionEngine
except ImportError:
    MlxWhisperTranscriptionEngine = None  # type: ignore

__all__ = ["WhisperXTranscriptionEngine", "MlxWhisperTranscriptionEngine"]
