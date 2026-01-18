"""Diarization service using Pyannote."""

import logging
import os
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Type for progress callback
ProgressCallback = Callable[[float], Coroutine[Any, Any, None]]


class DiarizationService:
    """Service for speaker diarization using Pyannote.

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
            hf_token: HuggingFace token for pyannote models (optional if pre-downloaded).
        """
        self.device = device
        self.hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
        self._pipeline = None
        self._whisperx = None

    def _ensure_loaded(self) -> None:
        """Ensure Pyannote diarization pipeline is loaded.

        Raises:
            ImportError: If dependencies are not installed.
        """
        if self._pipeline is not None:
            return

        try:
            import whisperx
            from pyannote.audio import Pipeline
        except ImportError as e:
            raise ImportError(
                "Pyannote/WhisperX is not installed. Install with: pip install 'verbatim-backend[ml]'"
            ) from e

        self._whisperx = whisperx

        logger.info("Loading pyannote diarization pipeline (device=%s)", self.device)

        # Load diarization pipeline from pyannote
        self._pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=self.hf_token,
        )

        # Move to device
        import torch
        if self.device == "cuda" and torch.cuda.is_available():
            self._pipeline.to(torch.device("cuda"))
        elif self.device == "mps" and torch.backends.mps.is_available():
            # Note: pyannote may not fully support MPS yet
            pass

        logger.info("Pyannote diarization pipeline loaded successfully")

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

        # Run diarization directly on audio file
        logger.info("Running diarization on: %s", audio_path)
        diarization = self._pipeline(str(audio_path))

        if progress_callback:
            await progress_callback(70)

        # Convert diarization output to format expected by whisperx.assign_word_speakers
        # pyannote returns an Annotation object, we need to convert to dict format
        diarize_segments = {"segments": []}
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            diarize_segments["segments"].append({
                "start": turn.start,
                "end": turn.end,
                "speaker": speaker,
            })

        logger.info("Diarization found %d speaker turns", len(diarize_segments["segments"]))

        # Assign speakers to transcript segments using whisperx
        logger.info("Assigning speakers to transcript segments...")
        result = self._whisperx.assign_word_speakers(diarize_segments, {"segments": segments})

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


# Default diarization service instance
diarization_service = DiarizationService()
