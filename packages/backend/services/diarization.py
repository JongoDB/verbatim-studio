"""Diarization service using WhisperX's DiarizationPipeline (pyannote-based)."""

import logging
import os
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Type for progress callback
ProgressCallback = Callable[[float], Coroutine[Any, Any, None]]


class DiarizationService:
    """Service for speaker diarization using WhisperX's DiarizationPipeline.

    Uses lazy loading to avoid import errors when dependencies are not installed.
    """

    def __init__(
        self,
        device: str = "cpu",
        hf_token: str | None = None,
    ):
        """Initialize the diarization service.

        Args:
            device: Device to run inference on (cpu, cuda, mps).
            hf_token: HuggingFace token for pyannote models.
        """
        self.device = device
        self.hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
        self._pipeline = None
        self._whisperx = None

    def _ensure_loaded(self) -> None:
        """Ensure WhisperX diarization pipeline is loaded.

        Raises:
            ImportError: If dependencies are not installed.
        """
        if self._pipeline is not None:
            return

        try:
            import whisperx
            from whisperx.diarize import DiarizationPipeline
        except ImportError as e:
            raise ImportError(
                "WhisperX/pyannote is not installed. Install with: pip install 'verbatim-backend[ml]'"
            ) from e

        self._whisperx = whisperx

        logger.info("Loading WhisperX diarization pipeline (device=%s)", self.device)

        self._pipeline = DiarizationPipeline(
            use_auth_token=self.hf_token,
            device=self.device,
        )

        logger.info("WhisperX diarization pipeline loaded successfully")

    async def diarize(
        self,
        audio_path: str | Path,
        segments: list[dict[str, Any]],
        progress_callback: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        """Run diarization on audio and assign speakers to segments.

        Args:
            audio_path: Path to the audio file.
            segments: List of transcript segments with start, end, text, and words.
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

        # Run diarization via WhisperX's pipeline (returns pandas DataFrame)
        logger.info("Running diarization on: %s", audio_path)
        diarize_df = self._pipeline(str(audio_path))

        if progress_callback:
            await progress_callback(70)

        logger.info("Diarization found %d speaker turns", len(diarize_df))

        # Assign speakers to transcript segments using whisperx
        logger.info("Assigning speakers to transcript segments...")
        result = self._whisperx.assign_word_speakers(diarize_df, {"segments": segments})

        if progress_callback:
            await progress_callback(90)

        # Extract unique speakers
        speakers = set()
        for segment in result.get("segments", []):
            speaker = segment.get("speaker")
            if speaker:
                speakers.add(speaker)

        logger.info("Diarization complete: %d unique speakers found", len(speakers))

        if progress_callback:
            await progress_callback(100)

        return {
            "segments": result.get("segments", []),
            "speakers": sorted(speakers),
        }


# Default diarization service instance (configured from app settings)
def _create_diarization_service() -> DiarizationService:
    from core.config import settings
    return DiarizationService(
        device=settings.WHISPERX_DEVICE,
        hf_token=settings.HF_TOKEN,
    )

diarization_service = _create_diarization_service()
