"""Pyannote diarization engine adapter.

Implements IDiarizationEngine for local speaker diarization using
pyannote.audio with optional GPU acceleration.
"""

import logging
import os
from pathlib import Path
from typing import Any

from core.interfaces import (
    DiarizationOptions,
    DiarizationResult,
    DiarizationSegment,
    IDiarizationEngine,
)

logger = logging.getLogger(__name__)


class PyannoteDiarizationEngine(IDiarizationEngine):
    """Pyannote-based speaker diarization engine for local processing.

    Uses lazy loading to avoid import errors when dependencies are not installed.
    Supports GPU acceleration via CUDA.
    """

    def __init__(
        self,
        device: str = "cpu",
        hf_token: str | None = None,
    ):
        """Initialize the Pyannote diarization engine.

        Args:
            device: Device to run inference on (cpu, cuda, mps)
            hf_token: HuggingFace token for pyannote models
        """
        self._device = device
        self._hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

        # Lazy-loaded components
        self._pipeline = None
        self._whisperx = None

    def _ensure_loaded(self) -> None:
        """Ensure Pyannote diarization pipeline is loaded."""
        if self._pipeline is not None:
            return

        try:
            import whisperx
            from pyannote.audio import Pipeline
        except ImportError as e:
            raise ImportError(
                "Pyannote/WhisperX is not installed. Install with: pip install pyannote.audio whisperx"
            ) from e

        self._whisperx = whisperx

        logger.info("Loading pyannote diarization pipeline (device=%s)", self._device)

        self._pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=self._hf_token,
        )

        # Move to device
        import torch
        if self._device == "cuda" and torch.cuda.is_available():
            self._pipeline.to(torch.device("cuda"))
        elif self._device == "mps" and torch.backends.mps.is_available():
            # Note: pyannote may not fully support MPS
            logger.warning("MPS support for pyannote is experimental")

        logger.info("Pyannote diarization pipeline loaded successfully")

    async def diarize(
        self,
        audio_path: str,
        options: DiarizationOptions | None = None,
    ) -> DiarizationResult:
        """Perform speaker diarization on an audio file."""
        options = options or DiarizationOptions()
        path = Path(audio_path)

        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        self._ensure_loaded()

        logger.info("Running diarization on: %s", audio_path)

        # Configure pipeline with options
        pipeline_params = {}
        if options.min_speakers is not None:
            pipeline_params["min_speakers"] = options.min_speakers
        if options.max_speakers is not None:
            pipeline_params["max_speakers"] = options.max_speakers

        # Run diarization
        diarization = self._pipeline(str(path), **pipeline_params)

        # Convert to domain objects
        segments = []
        speaker_labels = set()

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            # Filter segments below minimum duration
            duration = turn.end - turn.start
            if duration < options.min_segment_duration:
                continue

            segments.append(
                DiarizationSegment(
                    start=turn.start,
                    end=turn.end,
                    speaker=speaker,
                )
            )
            speaker_labels.add(speaker)

        logger.info(
            "Diarization complete: %d segments, %d speakers",
            len(segments),
            len(speaker_labels),
        )

        return DiarizationResult(
            segments=segments,
            num_speakers=len(speaker_labels),
            speaker_labels=sorted(speaker_labels),
        )

    async def diarize_with_transcription(
        self,
        audio_path: str,
        transcription_segments: list[dict],
        options: DiarizationOptions | None = None,
    ) -> list[dict]:
        """Align diarization with existing transcription segments."""
        options = options or DiarizationOptions()
        path = Path(audio_path)

        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        self._ensure_loaded()

        logger.info("Running diarization with transcription alignment on: %s", audio_path)

        # Configure pipeline with options
        pipeline_params = {}
        if options.min_speakers is not None:
            pipeline_params["min_speakers"] = options.min_speakers
        if options.max_speakers is not None:
            pipeline_params["max_speakers"] = options.max_speakers

        # Run diarization
        diarization = self._pipeline(str(path), **pipeline_params)

        # Convert diarization output to format expected by whisperx.assign_word_speakers
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
        result = self._whisperx.assign_word_speakers(
            diarize_segments,
            {"segments": transcription_segments},
        )

        return result.get("segments", [])

    async def is_available(self) -> bool:
        """Check if the diarization engine is available."""
        try:
            from pyannote.audio import Pipeline
            import whisperx
            return True
        except ImportError:
            return False

    async def get_engine_info(self) -> dict[str, str | int | float | bool]:
        """Get information about the diarization engine."""
        available = await self.is_available()
        info: dict[str, str | int | float | bool] = {
            "name": "Pyannote",
            "model": "pyannote/speaker-diarization-3.1",
            "available": available,
            "device": self._device,
            "pipeline_loaded": self._pipeline is not None,
            "hf_token_set": self._hf_token is not None,
        }

        if available:
            try:
                import torch
                info["cuda_available"] = torch.cuda.is_available()
                info["mps_available"] = torch.backends.mps.is_available()
            except Exception:
                pass

        return info
