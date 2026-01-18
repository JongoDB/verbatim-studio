"""Transcription service using WhisperX."""

import logging
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Type for progress callback
ProgressCallback = Callable[[float], Coroutine[Any, Any, None]]


class TranscriptionService:
    """Service for transcribing audio using WhisperX.

    Uses lazy loading to avoid import errors when WhisperX is not installed.
    """

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
        self._whisperx = None

    def _ensure_loaded(self) -> None:
        """Ensure WhisperX is loaded and model is ready.

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

        logger.info("WhisperX model loaded successfully")

    async def transcribe(
        self,
        audio_path: str | Path,
        language: str | None = None,
        progress_callback: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        """Transcribe an audio file.

        Args:
            audio_path: Path to the audio file.
            language: Optional language code (e.g., 'en', 'es'). If None, auto-detect.
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
        result = self._model.transcribe(audio, batch_size=16, language=language)

        detected_language = result.get("language", language or "en")
        logger.info("Transcription complete. Detected language: %s", detected_language)

        if progress_callback:
            await progress_callback(60)

        # Align timestamps for word-level timing
        logger.info("Aligning timestamps...")

        # Load alignment model for the detected language
        if self._align_model is None or self._align_metadata is None:
            self._align_model, self._align_metadata = self._whisperx.load_align_model(
                language_code=detected_language,
                device=self.device,
            )

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

        # Format segments
        segments = []
        for segment in aligned_result.get("segments", []):
            segments.append(
                {
                    "start": segment.get("start", 0.0),
                    "end": segment.get("end", 0.0),
                    "text": segment.get("text", "").strip(),
                    "confidence": segment.get("score"),  # May be None
                }
            )

        logger.info("Transcription complete: %d segments", len(segments))

        if progress_callback:
            await progress_callback(100)

        return {
            "language": detected_language,
            "segments": segments,
        }


# Default transcription service instance
transcription_service = TranscriptionService()
