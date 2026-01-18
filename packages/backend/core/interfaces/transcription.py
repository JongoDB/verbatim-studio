"""Transcription engine interface definitions.

This module defines the contract for transcription operations,
allowing different implementations (WhisperX local, cloud APIs, etc.)
to be swapped transparently.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class TranscriptionWord:
    """Individual word with timing information."""

    word: str
    start: float
    end: float
    confidence: float | None = None


@dataclass
class TranscriptionSegment:
    """A segment of transcribed text with timing."""

    start: float
    end: float
    text: str
    speaker: str | None = None
    words: list[TranscriptionWord] = field(default_factory=list)
    confidence: float | None = None


@dataclass
class TranscriptionResult:
    """Complete transcription result."""

    segments: list[TranscriptionSegment]
    language: str
    language_probability: float | None = None
    duration: float | None = None
    model_used: str | None = None


@dataclass
class TranscriptionOptions:
    """Options for transcription processing."""

    language: str | None = None  # None = auto-detect
    model_size: str = "base"  # tiny, base, small, medium, large-v2, large-v3
    task: str = "transcribe"  # transcribe or translate
    compute_type: str = "float16"  # float16, float32, int8
    batch_size: int = 16
    chunk_size: int = 30  # seconds
    word_timestamps: bool = True
    vad_filter: bool = True  # Voice Activity Detection
    initial_prompt: str | None = None  # Context prompt for better accuracy


@dataclass
class TranscriptionProgress:
    """Progress update during transcription."""

    stage: str  # loading, transcribing, aligning, complete
    progress: float  # 0.0 to 1.0
    message: str | None = None


class ITranscriptionEngine(ABC):
    """Interface for transcription operations.

    Implementations can wrap:
    - WhisperX (local GPU/CPU)
    - OpenAI Whisper API
    - Google Speech-to-Text
    - Azure Speech Services
    - etc.
    """

    @abstractmethod
    async def transcribe(
        self,
        audio_path: str,
        options: TranscriptionOptions | None = None,
    ) -> TranscriptionResult:
        """Transcribe an audio file.

        Args:
            audio_path: Path to the audio file
            options: Transcription options

        Returns:
            TranscriptionResult with segments and metadata
        """
        ...

    @abstractmethod
    async def transcribe_stream(
        self,
        audio_path: str,
        options: TranscriptionOptions | None = None,
    ) -> AsyncIterator[TranscriptionProgress | TranscriptionResult]:
        """Transcribe with streaming progress updates.

        Yields TranscriptionProgress updates during processing,
        then yields the final TranscriptionResult.

        Args:
            audio_path: Path to the audio file
            options: Transcription options

        Yields:
            Progress updates followed by final result
        """
        ...

    @abstractmethod
    async def get_available_models(self) -> list[str]:
        """Get list of available model sizes.

        Returns:
            List of model identifiers (e.g., ['tiny', 'base', 'small'])
        """
        ...

    @abstractmethod
    async def get_supported_languages(self) -> list[str]:
        """Get list of supported language codes.

        Returns:
            List of ISO 639-1 language codes
        """
        ...

    @abstractmethod
    async def detect_language(self, audio_path: str) -> tuple[str, float]:
        """Detect the language of an audio file.

        Args:
            audio_path: Path to the audio file

        Returns:
            Tuple of (language_code, confidence)
        """
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the transcription engine is available and ready.

        Returns:
            True if engine is ready to process requests
        """
        ...

    @abstractmethod
    async def get_engine_info(self) -> dict[str, str | int | float | bool]:
        """Get information about the transcription engine.

        Returns:
            Dict with engine details (name, version, device, etc.)
        """
        ...
