"""Transcription service using WhisperX."""

import logging
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

# Fix PyTorch 2.6+ compatibility BEFORE any imports
# pyannote models require weights_only=False due to omegaconf serialization
import torch

_original_torch_load = torch.load


def _patched_torch_load(*args, weights_only=False, **kwargs):
    """Patched torch.load that defaults weights_only=False for pyannote compatibility."""
    return _original_torch_load(*args, weights_only=weights_only, **kwargs)


torch.load = _patched_torch_load

# Also patch lightning_fabric's _load function which wraps torch.load
try:
    from lightning_fabric.utilities import cloud_io

    _original_pl_load = cloud_io._load

    def _patched_pl_load(path_or_url, map_location=None, **kwargs):
        # Force weights_only=False for pyannote compatibility
        kwargs["weights_only"] = False
        return _original_torch_load(path_or_url, map_location=map_location, **kwargs)

    cloud_io._load = _patched_pl_load
except ImportError:
    pass

logger = logging.getLogger(__name__)

# Type for progress callback
ProgressCallback = Callable[[float], Coroutine[Any, Any, None]]


class TranscriptionService:
    """Service for transcribing audio using WhisperX.

    Uses lazy loading to avoid import errors when WhisperX is not installed.
    Caches loaded models to avoid expensive reloads when settings haven't changed.
    """

    # Class-level model cache keyed by (model_name, device, compute_type)
    _model_cache: dict[tuple[str, str, str], Any] = {}

    def __init__(
        self,
        model_name: str = "base",
        device: str = "cpu",
        compute_type: str = "int8",
    ):
        """Initialize the transcription service.

        Args:
            model_name: WhisperX model size (tiny, base, small, medium, large).
            device: Device to run inference on (cpu, cuda).
            compute_type: Compute type for inference (int8, float16, float32).
        """
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self._model = None
        self._align_model = None
        self._align_metadata = None
        self._align_language: str | None = None
        self._whisperx = None

    def _ensure_loaded(self) -> None:
        """Ensure WhisperX is loaded and model is ready.

        Uses class-level cache to reuse models across service instances.

        Raises:
            ImportError: If WhisperX is not installed.
        """
        if self._model is not None:
            return

        try:
            import whisperx
        except ImportError as e:
            raise ImportError(
                "WhisperX is not installed. Install with: pip install 'verbatim-backend[ml]'"
            ) from e

        self._whisperx = whisperx

        cache_key = (self.model_name, self.device, self.compute_type)
        if cache_key in TranscriptionService._model_cache:
            logger.info(
                "Reusing cached WhisperX model: %s (device=%s, compute_type=%s)",
                self.model_name,
                self.device,
                self.compute_type,
            )
            self._model = TranscriptionService._model_cache[cache_key]
        else:
            logger.info(
                "Loading WhisperX model: %s (device=%s, compute_type=%s)",
                self.model_name,
                self.device,
                self.compute_type,
            )
            self._model = whisperx.load_model(
                self.model_name,
                self.device,
                compute_type=self.compute_type,
            )
            TranscriptionService._model_cache[cache_key] = self._model
            logger.info("WhisperX model loaded and cached successfully")

    async def transcribe(
        self,
        audio_path: str | Path,
        language: str | None = None,
        batch_size: int = 16,
        progress_callback: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        """Transcribe an audio file.

        Args:
            audio_path: Path to the audio file.
            language: Optional language code (e.g., 'en', 'es'). If None, auto-detect.
            batch_size: Batch size for transcription inference.
            progress_callback: Optional async callback for progress updates.

        Returns:
            Dictionary with 'language' and 'segments' keys.
            Each segment has: start, end, text, and optionally confidence.

        Raises:
            ImportError: If WhisperX is not installed.
            FileNotFoundError: If audio file doesn't exist.
            Exception: If transcription fails.
        """
        audio_path = Path(audio_path)

        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # Report initial progress
        if progress_callback:
            await progress_callback(5)

        # Load model (lazy)
        self._ensure_loaded()

        if progress_callback:
            await progress_callback(10)

        logger.info("Loading audio: %s", audio_path)
        audio = self._whisperx.load_audio(str(audio_path))

        if progress_callback:
            await progress_callback(20)

        # Transcribe
        logger.info("Starting transcription...")
        result = self._model.transcribe(audio, batch_size=batch_size, language=language)

        detected_language = result.get("language", language or "en")
        logger.info("Transcription complete. Detected language: %s", detected_language)

        if progress_callback:
            await progress_callback(60)

        # Align timestamps for word-level timing
        logger.info("Aligning timestamps...")

        # Load alignment model for the detected language (reload if language changed)
        if (
            self._align_model is None
            or self._align_metadata is None
            or self._align_language != detected_language
        ):
            self._align_model, self._align_metadata = self._whisperx.load_align_model(
                language_code=detected_language,
                device=self.device,
            )
            self._align_language = detected_language

        aligned_result = self._whisperx.align(
            result["segments"],
            self._align_model,
            self._align_metadata,
            audio,
            self.device,
            return_char_alignments=False,
        )

        if progress_callback:
            await progress_callback(90)

        # Format segments (include words for diarization speaker alignment)
        segments = []
        for segment in aligned_result.get("segments", []):
            seg_data = {
                "start": segment.get("start", 0.0),
                "end": segment.get("end", 0.0),
                "text": segment.get("text", "").strip(),
                "confidence": segment.get("score"),  # May be None
            }
            if "words" in segment:
                seg_data["words"] = segment["words"]
            segments.append(seg_data)

        logger.info("Transcription complete: %d segments", len(segments))

        if progress_callback:
            await progress_callback(100)

        return {
            "language": detected_language,
            "segments": segments,
        }


# Default transcription service instance
transcription_service = TranscriptionService()
