"""MLX Whisper transcription engine adapter.

Implements ITranscriptionEngine for local transcription on Apple Silicon
using MLX Whisper with MPS GPU acceleration.

Speaker diarization is handled separately by DiarizationService (pyannote via whisperx).
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from core.interfaces import (
    ITranscriptionEngine,
    TranscriptionOptions,
    TranscriptionProgress,
    TranscriptionResult,
    TranscriptionSegment,
    TranscriptionWord,
)

logger = logging.getLogger(__name__)

# MLX Community model repos on HuggingFace
MODEL_REPOS = {
    "tiny": "mlx-community/whisper-tiny-mlx",
    "base": "mlx-community/whisper-base-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large-v2": "mlx-community/whisper-large-v2-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
}

# Same language support as Whisper
SUPPORTED_LANGUAGES = [
    "en", "es", "fr", "de", "it", "pt", "nl", "ru", "zh", "ja", "ko",
    "ar", "hi", "pl", "tr", "vi", "th", "cs", "ro", "hu", "el", "sv",
    "da", "fi", "no", "sk", "uk", "he", "id", "ms", "ca", "hr", "bg",
]


class MlxWhisperTranscriptionEngine(ITranscriptionEngine):
    """MLX Whisper-based transcription engine for Apple Silicon.

    Uses lazy loading to avoid import errors when mlx-whisper is not installed.
    Runs on MPS (Metal Performance Shaders) for GPU acceleration.

    Important: This engine does NOT support speaker diarization.
    """

    def __init__(self, model_size: str = "base"):
        """Initialize the MLX Whisper transcription engine.

        Args:
            model_size: Whisper model size (tiny, base, small, medium, large-v2, large-v3)
        """
        self._model_size = model_size
        self._model_repo = MODEL_REPOS.get(model_size, MODEL_REPOS["base"])

    async def transcribe(
        self,
        audio_path: str,
        options: TranscriptionOptions | None = None,
    ) -> TranscriptionResult:
        """Transcribe an audio file using MLX Whisper."""
        options = options or TranscriptionOptions()
        path = Path(audio_path)

        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            import mlx_whisper
        except ImportError as e:
            raise ImportError(
                "mlx-whisper is not installed. Install with: pip install mlx-whisper"
            ) from e

        logger.info(
            "Transcribing with MLX Whisper: %s (model=%s)",
            audio_path,
            self._model_repo,
        )

        # Run transcription in thread to avoid blocking event loop
        try:
            result = await asyncio.to_thread(
                mlx_whisper.transcribe,
                str(path),
                path_or_hf_repo=self._model_repo,
                word_timestamps=options.word_timestamps,
                language=options.language,
            )
        except Exception as e:
            error_msg = str(e)
            # Check for HuggingFace Hub "snapshot folder" error - means model not downloaded
            if "snapshot folder" in error_msg.lower() or "locate the files on the hub" in error_msg.lower():
                raise RuntimeError(
                    f"Transcription model '{self._model_size}' is not downloaded. "
                    f"Please download it from Settings → Transcription Models, or check your internet connection."
                ) from e
            raise

        detected_language = result.get("language", options.language or "en")
        logger.info("Transcription complete. Language: %s", detected_language)

        # Convert to domain objects
        segments = self._convert_segments(result.get("segments", []))

        return TranscriptionResult(
            segments=segments,
            language=detected_language,
            language_probability=None,  # mlx-whisper doesn't provide this
            model_used=f"mlx-whisper/{self._model_size}",
        )

    async def transcribe_stream(
        self,
        audio_path: str,
        options: TranscriptionOptions | None = None,
    ) -> AsyncIterator[TranscriptionProgress | TranscriptionResult]:
        """Transcribe with streaming progress updates.

        Note: MLX Whisper doesn't support true streaming, so we simulate
        progress stages: loading -> transcribing -> complete.
        """
        options = options or TranscriptionOptions()
        path = Path(audio_path)

        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        yield TranscriptionProgress(
            stage="loading",
            progress=0.1,
            message="Loading MLX Whisper model...",
        )

        try:
            import mlx_whisper
        except ImportError as e:
            raise ImportError(
                "mlx-whisper is not installed. Install with: pip install mlx-whisper"
            ) from e

        yield TranscriptionProgress(
            stage="transcribing",
            progress=0.2,
            message="Transcribing audio with MLX...",
        )

        # Run transcription in thread to avoid blocking
        result = await asyncio.to_thread(
            mlx_whisper.transcribe,
            str(path),
            path_or_hf_repo=self._model_repo,
            word_timestamps=options.word_timestamps,
            language=options.language,
        )

        detected_language = result.get("language", options.language or "en")

        yield TranscriptionProgress(
            stage="transcribing",
            progress=0.8,
            message=f"Detected language: {detected_language}",
        )

        yield TranscriptionProgress(
            stage="complete",
            progress=0.95,
            message="Processing segments...",
        )

        # Convert to domain objects
        segments = self._convert_segments(result.get("segments", []))

        yield TranscriptionProgress(
            stage="complete",
            progress=1.0,
            message=f"Transcription complete: {len(segments)} segments",
        )

        yield TranscriptionResult(
            segments=segments,
            language=detected_language,
            language_probability=None,
            model_used=f"mlx-whisper/{self._model_size}",
        )

    def _convert_segments(
        self, raw_segments: list[dict[str, Any]]
    ) -> list[TranscriptionSegment]:
        """Convert mlx-whisper segments to domain objects."""
        segments = []
        for seg in raw_segments:
            words = []
            for word_data in seg.get("words", []):
                words.append(
                    TranscriptionWord(
                        word=word_data.get("word", ""),
                        start=word_data.get("start", 0.0),
                        end=word_data.get("end", 0.0),
                        confidence=word_data.get("probability"),
                    )
                )

            segments.append(
                TranscriptionSegment(
                    start=seg.get("start", 0.0),
                    end=seg.get("end", 0.0),
                    text=seg.get("text", "").strip(),
                    speaker=None,  # Speaker assigned later by DiarizationService
                    words=words,
                    confidence=None,
                )
            )

        return segments

    async def get_available_models(self) -> list[str]:
        """Get list of available model sizes."""
        return list(MODEL_REPOS.keys())

    async def get_supported_languages(self) -> list[str]:
        """Get list of supported language codes."""
        return SUPPORTED_LANGUAGES

    async def detect_language(self, audio_path: str) -> tuple[str, float]:
        """Detect the language of an audio file."""
        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            import mlx_whisper
        except ImportError as e:
            raise ImportError(
                "mlx-whisper is not installed. Install with: pip install mlx-whisper"
            ) from e

        # Run transcription to detect language
        result = await asyncio.to_thread(
            mlx_whisper.transcribe,
            str(path),
            path_or_hf_repo=self._model_repo,
            word_timestamps=False,  # Faster without word timestamps
        )

        language = result.get("language", "en")
        # mlx-whisper doesn't provide probability, return 1.0 as placeholder
        return language, 1.0

    async def is_available(self) -> bool:
        """Check if MLX Whisper is available."""
        try:
            import mlx_whisper
            return True
        except ImportError:
            return False

    async def get_engine_info(self) -> dict[str, str | int | float | bool]:
        """Get information about the transcription engine."""
        available = await self.is_available()
        return {
            "name": "MLX Whisper",
            "available": available,
            "model_size": self._model_size,
            "model_repo": self._model_repo,
            "device": "mps",
            "model_loaded": True,  # MLX loads on demand
            # Diarization is handled separately by DiarizationService (pyannote via whisperx)
            # MLX Whisper just needs to produce segments - diarization works independently
            "supports_diarization": True,
        }

    def cleanup(self) -> None:
        """Clean up resources after transcription.

        MLX Whisper loads models on-demand per transcription call,
        so there's no persistent model to unload. This method clears
        any GPU cache and runs garbage collection for consistency.
        """
        import gc

        gc.collect()

        # Clear MPS cache
        try:
            import torch
            if torch.backends.mps.is_available():
                torch.mps.empty_cache()
                logger.debug("Cleared MPS cache")
        except Exception:
            pass  # torch may not be available
