"""Diarization engine interface definitions.

This module defines the contract for speaker diarization operations,
allowing different implementations (pyannote local, cloud APIs, etc.)
to be swapped transparently.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class DiarizationSegment:
    """A segment with speaker identification."""

    start: float
    end: float
    speaker: str  # e.g., "SPEAKER_00", "SPEAKER_01"
    confidence: float | None = None


@dataclass
class DiarizationResult:
    """Complete diarization result."""

    segments: list[DiarizationSegment]
    num_speakers: int
    speaker_labels: list[str]  # Unique speaker identifiers found


@dataclass
class DiarizationOptions:
    """Options for diarization processing."""

    min_speakers: int | None = None  # Minimum expected speakers
    max_speakers: int | None = None  # Maximum expected speakers
    min_segment_duration: float = 0.5  # Minimum segment length in seconds
    clustering_threshold: float | None = None  # Speaker clustering threshold


@dataclass
class DiarizationProgress:
    """Progress update during diarization."""

    stage: str  # loading, embedding, clustering, complete
    progress: float  # 0.0 to 1.0
    message: str | None = None


class IDiarizationEngine(ABC):
    """Interface for speaker diarization operations.

    Implementations can wrap:
    - pyannote.audio (local)
    - AWS Transcribe (speaker diarization)
    - Google Speech-to-Text (speaker diarization)
    - etc.
    """

    @abstractmethod
    async def diarize(
        self,
        audio_path: str,
        options: DiarizationOptions | None = None,
    ) -> DiarizationResult:
        """Perform speaker diarization on an audio file.

        Args:
            audio_path: Path to the audio file
            options: Diarization options

        Returns:
            DiarizationResult with speaker segments
        """
        ...

    @abstractmethod
    async def diarize_with_transcription(
        self,
        audio_path: str,
        transcription_segments: list[dict],
        options: DiarizationOptions | None = None,
    ) -> list[dict]:
        """Align diarization with existing transcription segments.

        Takes transcription segments and assigns speakers to each.

        Args:
            audio_path: Path to the audio file
            transcription_segments: List of segments with start/end/text
            options: Diarization options

        Returns:
            Transcription segments with speaker labels added
        """
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the diarization engine is available and ready.

        Returns:
            True if engine is ready to process requests
        """
        ...

    @abstractmethod
    async def get_engine_info(self) -> dict[str, str | int | float | bool]:
        """Get information about the diarization engine.

        Returns:
            Dict with engine details (name, version, device, etc.)
        """
        ...
