"""External WhisperX transcription engine adapter.

Implements ITranscriptionEngine for remote transcription via HTTP API.
Allows connecting to a self-hosted WhisperX server for GPU offloading.
"""

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx

from core.interfaces import (
    ITranscriptionEngine,
    TranscriptionOptions,
    TranscriptionProgress,
    TranscriptionResult,
    TranscriptionSegment,
    TranscriptionWord,
)

logger = logging.getLogger(__name__)


class ExternalWhisperXEngine(ITranscriptionEngine):
    """External WhisperX transcription engine via HTTP API.

    Connects to a self-hosted WhisperX server that exposes:
    - POST /transcribe - Upload audio and get transcription
    - GET /status - Check service status
    - GET /models - List available models
    - GET /languages - List supported languages
    """

    def __init__(
        self,
        base_url: str,
        timeout: float = 600.0,  # 10 minutes for long transcriptions
        api_key: str | None = None,
    ):
        """Initialize the external WhisperX engine.

        Args:
            base_url: Base URL of the WhisperX service (e.g., http://localhost:9000)
            timeout: Request timeout in seconds
            api_key: Optional API key for authentication
        """
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._api_key = api_key
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            headers = {}
            if self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=headers,
                timeout=self._timeout,
            )
        return self._client

    async def transcribe(
        self,
        audio_path: str,
        options: TranscriptionOptions | None = None,
    ) -> TranscriptionResult:
        """Transcribe an audio file via external service."""
        options = options or TranscriptionOptions()
        path = Path(audio_path)

        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        client = await self._get_client()

        # Prepare multipart form data
        with open(path, "rb") as f:
            files = {"file": (path.name, f, "audio/mpeg")}
            data = {
                "model": options.model_size,
                "batch_size": str(options.batch_size),
                "word_timestamps": str(options.word_timestamps).lower(),
            }
            if options.language:
                data["language"] = options.language

            logger.info("Sending audio to external WhisperX: %s", self._base_url)

            response = await client.post("/transcribe", files=files, data=data)

        if response.status_code != 200:
            error_detail = response.text
            raise RuntimeError(
                f"External WhisperX transcription failed: {response.status_code} - {error_detail}"
            )

        result = response.json()
        segments = self._convert_segments(result.get("segments", []))

        return TranscriptionResult(
            segments=segments,
            language=result.get("language", options.language or "en"),
            language_probability=result.get("language_probability"),
            model_used=result.get("model", options.model_size),
        )

    async def transcribe_stream(
        self,
        audio_path: str,
        options: TranscriptionOptions | None = None,
    ) -> AsyncIterator[TranscriptionProgress | TranscriptionResult]:
        """Transcribe with streaming progress updates.

        Note: External service may not support true streaming.
        We simulate progress updates while waiting for the response.
        """
        options = options or TranscriptionOptions()
        path = Path(audio_path)

        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        yield TranscriptionProgress(
            stage="loading",
            progress=0.1,
            message="Uploading audio to external service...",
        )

        client = await self._get_client()

        yield TranscriptionProgress(
            stage="transcribing",
            progress=0.2,
            message="Transcribing via external WhisperX...",
        )

        # Prepare and send request
        with open(path, "rb") as f:
            files = {"file": (path.name, f, "audio/mpeg")}
            data = {
                "model": options.model_size,
                "batch_size": str(options.batch_size),
                "word_timestamps": str(options.word_timestamps).lower(),
            }
            if options.language:
                data["language"] = options.language

            response = await client.post("/transcribe", files=files, data=data)

        yield TranscriptionProgress(
            stage="complete",
            progress=0.9,
            message="Processing results...",
        )

        if response.status_code != 200:
            error_detail = response.text
            raise RuntimeError(
                f"External WhisperX transcription failed: {response.status_code} - {error_detail}"
            )

        result = response.json()
        segments = self._convert_segments(result.get("segments", []))

        yield TranscriptionProgress(
            stage="complete",
            progress=1.0,
            message=f"Transcription complete: {len(segments)} segments",
        )

        yield TranscriptionResult(
            segments=segments,
            language=result.get("language", options.language or "en"),
            language_probability=result.get("language_probability"),
            model_used=result.get("model", options.model_size),
        )

    def _convert_segments(self, raw_segments: list[dict[str, Any]]) -> list[TranscriptionSegment]:
        """Convert external service segments to domain objects."""
        segments = []
        for seg in raw_segments:
            words = []
            for word_data in seg.get("words", []):
                words.append(
                    TranscriptionWord(
                        word=word_data.get("word", ""),
                        start=word_data.get("start", 0.0),
                        end=word_data.get("end", 0.0),
                        confidence=word_data.get("score") or word_data.get("confidence"),
                    )
                )

            segments.append(
                TranscriptionSegment(
                    start=seg.get("start", 0.0),
                    end=seg.get("end", 0.0),
                    text=seg.get("text", "").strip(),
                    speaker=seg.get("speaker"),
                    words=words,
                    confidence=seg.get("score") or seg.get("confidence"),
                )
            )

        return segments

    async def get_available_models(self) -> list[str]:
        """Get list of available model sizes from external service."""
        try:
            client = await self._get_client()
            response = await client.get("/models")
            if response.status_code == 200:
                data = response.json()
                return data.get("models", ["tiny", "base", "small", "medium", "large-v2", "large-v3"])
        except Exception as e:
            logger.warning("Failed to get models from external service: %s", e)
        # Return default models if service doesn't support this endpoint
        return ["tiny", "base", "small", "medium", "large-v2", "large-v3"]

    async def get_supported_languages(self) -> list[str]:
        """Get list of supported language codes from external service."""
        try:
            client = await self._get_client()
            response = await client.get("/languages")
            if response.status_code == 200:
                data = response.json()
                return data.get("languages", [])
        except Exception as e:
            logger.warning("Failed to get languages from external service: %s", e)
        # Return common languages if service doesn't support this endpoint
        return [
            "en", "es", "fr", "de", "it", "pt", "nl", "ru", "zh", "ja", "ko",
            "ar", "hi", "pl", "tr", "vi", "th", "cs", "ro", "hu", "el", "sv",
        ]

    async def detect_language(self, audio_path: str) -> tuple[str, float]:
        """Detect the language of an audio file via external service."""
        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        client = await self._get_client()

        with open(path, "rb") as f:
            files = {"file": (path.name, f, "audio/mpeg")}
            response = await client.post("/detect-language", files=files)

        if response.status_code == 200:
            result = response.json()
            return result.get("language", "en"), result.get("probability", 0.0)

        # If endpoint not supported, run full transcription and extract language
        logger.warning("detect-language endpoint not available, using transcribe")
        result = await self.transcribe(audio_path)
        return result.language, result.language_probability or 0.0

    async def is_available(self) -> bool:
        """Check if the external transcription service is available."""
        try:
            client = await self._get_client()
            response = await client.get("/status", timeout=5.0)
            return response.status_code == 200
        except Exception as e:
            logger.warning("External WhisperX service not available: %s", e)
            return False

    async def get_engine_info(self) -> dict[str, str | int | float | bool]:
        """Get information about the external transcription service."""
        available = await self.is_available()
        info: dict[str, str | int | float | bool] = {
            "name": "External WhisperX",
            "available": available,
            "base_url": self._base_url,
            "timeout": self._timeout,
            "has_api_key": self._api_key is not None,
        }

        if available:
            try:
                client = await self._get_client()
                response = await client.get("/status")
                if response.status_code == 200:
                    status = response.json()
                    info.update(status)
            except Exception:
                pass

        return info

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
