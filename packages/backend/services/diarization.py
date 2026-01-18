"""Diarization service using Pyannote via WhisperX."""

import logging
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Type for progress callback
ProgressCallback = Callable[[float], Coroutine[Any, Any, None]]


class DiarizationService:
    """Service for speaker diarization using Pyannote via WhisperX.

    Uses lazy loading to avoid import errors when dependencies are not installed.
    """

    def __init__(
        self,
        device: str = "cpu",
        hf_token: str | None = None,
    ):
        """Initialize the diarization service.

        Args:
            device: Device to run inference on (cpu, cuda).
            hf_token: HuggingFace token for pyannote models (optional if pre-downloaded).
        """
        self.device = device
        self.hf_token = hf_token
        self._diarize_model = None
        self._whisperx = None

    def _ensure_loaded(self) -> None:
        """Ensure Pyannote/WhisperX diarization is loaded.

        Raises:
            ImportError: If dependencies are not installed.
        """
        if self._diarize_model is not None:
            return

        try:
            import whisperx
        except ImportError as e:
            raise ImportError(
                "WhisperX is not installed. Install with: pip install 'verbatim-backend[ml]'"
            ) from e

        self._whisperx = whisperx

        logger.info("Loading diarization pipeline (device=%s)", self.device)

        # Load diarization pipeline
        self._diarize_model = whisperx.DiarizationPipeline(
            use_auth_token=self.hf_token,
            device=self.device,
        )

        logger.info("Diarization pipeline loaded successfully")

    async def diarize(
        self,
        audio_path: str | Path,
        segments: list[dict[str, Any]],
        progress_callback: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        """Run diarization on audio and assign speakers to segments.

        Args:
            audio_path: Path to the audio file.
            segments: List of transcript segments with start, end, text.
            progress_callback: Optional async callback for progress updates.

        Returns:
            Dictionary with:
                - segments: List of segments with speaker labels added
                - speakers: List of unique speaker labels found

        Raises:
            ImportError: If dependencies are not installed.
            FileNotFoundError: If audio file doesn't exist.
        """
        audio_path = Path(audio_path)

        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        if progress_callback:
            await progress_callback(5)

        # Load model (lazy)
        self._ensure_loaded()

        if progress_callback:
            await progress_callback(10)

        # Load audio
        logger.info("Loading audio for diarization: %s", audio_path)
        audio = self._whisperx.load_audio(str(audio_path))

        if progress_callback:
            await progress_callback(20)

        # Run diarization
        logger.info("Running diarization...")
        diarize_segments = self._diarize_model(audio)

        if progress_callback:
            await progress_callback(70)

        # Assign speakers to transcript segments
        logger.info("Assigning speakers to segments...")
        result = self._whisperx.assign_word_speakers(diarize_segments, {"segments": segments})

        if progress_callback:
            await progress_callback(90)

        # Extract unique speakers
        speakers = set()
        for segment in result.get("segments", []):
            speaker = segment.get("speaker")
            if speaker:
                speakers.add(speaker)

        logger.info("Diarization complete: %d speakers found", len(speakers))

        if progress_callback:
            await progress_callback(100)

        return {
            "segments": result.get("segments", []),
            "speakers": sorted(speakers),
        }


# Default diarization service instance
diarization_service = DiarizationService()
