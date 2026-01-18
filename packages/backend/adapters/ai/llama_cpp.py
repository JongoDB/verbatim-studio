"""Llama.cpp AI service adapter.

Implements IAIService for local LLM inference using llama-cpp-python.
This is a stub implementation for the basic tier.
"""

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from core.interfaces import (
    AnalysisResult,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatStreamChunk,
    IAIService,
    SummarizationResult,
)

logger = logging.getLogger(__name__)


class LlamaCppAIService(IAIService):
    """Llama.cpp-based AI service for local LLM inference.

    Uses lazy loading to avoid import errors when llama-cpp-python is not installed.
    Supports various GGUF models for summarization and analysis.
    """

    def __init__(
        self,
        model_path: str | None = None,
        n_ctx: int = 4096,
        n_gpu_layers: int = 0,
    ):
        """Initialize the Llama.cpp AI service.

        Args:
            model_path: Path to the GGUF model file
            n_ctx: Context window size
            n_gpu_layers: Number of layers to offload to GPU (0 = CPU only)
        """
        self._model_path = model_path
        self._n_ctx = n_ctx
        self._n_gpu_layers = n_gpu_layers

        # Lazy-loaded model
        self._llm = None
        self._available: bool | None = None

    def _ensure_loaded(self) -> None:
        """Ensure llama.cpp is loaded and model is ready."""
        if self._llm is not None:
            return

        if not self._model_path:
            raise ValueError("No model path configured. Set model_path in configuration.")

        path = Path(self._model_path)
        if not path.exists():
            raise FileNotFoundError(f"Model file not found: {self._model_path}")

        try:
            from llama_cpp import Llama
        except ImportError as e:
            raise ImportError(
                "llama-cpp-python is not installed. Install with: pip install llama-cpp-python"
            ) from e

        logger.info(
            "Loading llama.cpp model: %s (n_ctx=%d, n_gpu_layers=%d)",
            self._model_path,
            self._n_ctx,
            self._n_gpu_layers,
        )

        self._llm = Llama(
            model_path=self._model_path,
            n_ctx=self._n_ctx,
            n_gpu_layers=self._n_gpu_layers,
            verbose=False,
        )

        logger.info("Llama.cpp model loaded successfully")

    def _format_messages(self, messages: list[ChatMessage]) -> str:
        """Format chat messages into a prompt string."""
        formatted = ""
        for msg in messages:
            if msg.role == "system":
                formatted += f"<|system|>\n{msg.content}\n"
            elif msg.role == "user":
                formatted += f"<|user|>\n{msg.content}\n"
            elif msg.role == "assistant":
                formatted += f"<|assistant|>\n{msg.content}\n"
        formatted += "<|assistant|>\n"
        return formatted

    async def chat(
        self,
        messages: list[ChatMessage],
        options: ChatOptions | None = None,
    ) -> ChatResponse:
        """Send a chat completion request."""
        options = options or ChatOptions()
        self._ensure_loaded()

        prompt = self._format_messages(messages)

        result = self._llm(
            prompt,
            max_tokens=options.max_tokens or 512,
            temperature=options.temperature,
            top_p=options.top_p,
            stop=options.stop or ["<|user|>", "<|system|>"],
        )

        content = result["choices"][0]["text"]
        usage = result.get("usage", {})

        return ChatResponse(
            content=content.strip(),
            model=Path(self._model_path).stem if self._model_path else "unknown",
            usage={
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
            },
            finish_reason=result["choices"][0].get("finish_reason"),
        )

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        options: ChatOptions | None = None,
    ) -> AsyncIterator[ChatStreamChunk]:
        """Send a streaming chat completion request."""
        options = options or ChatOptions()
        self._ensure_loaded()

        prompt = self._format_messages(messages)

        for chunk in self._llm(
            prompt,
            max_tokens=options.max_tokens or 512,
            temperature=options.temperature,
            top_p=options.top_p,
            stop=options.stop or ["<|user|>", "<|system|>"],
            stream=True,
        ):
            content = chunk["choices"][0].get("text", "")
            finish_reason = chunk["choices"][0].get("finish_reason")

            yield ChatStreamChunk(
                content=content,
                finish_reason=finish_reason,
            )

    async def summarize_transcript(
        self,
        transcript_text: str,
        options: ChatOptions | None = None,
    ) -> SummarizationResult:
        """Generate a summary of a transcript."""
        options = options or ChatOptions()

        system_prompt = """You are a transcript summarization assistant.
Analyze the following transcript and provide:
1. A concise summary (2-3 paragraphs)
2. Key points discussed
3. Any action items mentioned
4. Main topics covered

Format your response as:
SUMMARY:
[Your summary here]

KEY POINTS:
- [Point 1]
- [Point 2]
...

ACTION ITEMS:
- [Action 1]
- [Action 2]
...

TOPICS:
- [Topic 1]
- [Topic 2]
..."""

        messages = [
            ChatMessage(role="system", content=system_prompt),
            ChatMessage(role="user", content=f"Please summarize this transcript:\n\n{transcript_text}"),
        ]

        response = await self.chat(messages, options)

        # Parse the response
        content = response.content
        summary = ""
        key_points = []
        action_items = []
        topics = []

        current_section = None
        for line in content.split("\n"):
            line = line.strip()
            if line.upper().startswith("SUMMARY:"):
                current_section = "summary"
                summary = line[8:].strip()
            elif line.upper().startswith("KEY POINTS:"):
                current_section = "key_points"
            elif line.upper().startswith("ACTION ITEMS:"):
                current_section = "action_items"
            elif line.upper().startswith("TOPICS:"):
                current_section = "topics"
            elif line.startswith("- "):
                item = line[2:].strip()
                if current_section == "key_points":
                    key_points.append(item)
                elif current_section == "action_items":
                    action_items.append(item)
                elif current_section == "topics":
                    topics.append(item)
            elif current_section == "summary" and line:
                summary += " " + line

        return SummarizationResult(
            summary=summary.strip(),
            key_points=key_points if key_points else None,
            action_items=action_items if action_items else None,
            topics=topics if topics else None,
        )

    async def analyze_transcript(
        self,
        transcript_text: str,
        analysis_type: str,
        options: ChatOptions | None = None,
    ) -> AnalysisResult:
        """Perform analysis on a transcript."""
        options = options or ChatOptions()

        prompts = {
            "sentiment": "Analyze the sentiment of this transcript. Identify overall tone, emotional shifts, and key emotional moments.",
            "topics": "Extract the main topics and themes discussed in this transcript. List them in order of prominence.",
            "entities": "Extract all named entities (people, organizations, places, dates, products) from this transcript.",
            "questions": "List all questions asked in this transcript, who asked them, and whether they were answered.",
            "action_items": "Extract all action items, tasks, and commitments mentioned in this transcript.",
        }

        prompt = prompts.get(analysis_type, f"Perform {analysis_type} analysis on this transcript.")

        messages = [
            ChatMessage(role="system", content=f"You are a transcript analyst. {prompt}"),
            ChatMessage(role="user", content=f"Analyze this transcript:\n\n{transcript_text}"),
        ]

        response = await self.chat(messages, options)

        return AnalysisResult(
            analysis_type=analysis_type,
            content={"raw_analysis": response.content},
        )

    async def get_available_models(self) -> list[dict[str, str]]:
        """Get list of available models."""
        models = []
        if self._model_path:
            path = Path(self._model_path)
            models.append({
                "id": path.stem,
                "name": path.name,
            })
        return models

    async def is_available(self) -> bool:
        """Check if the AI service is available."""
        if self._available is not None:
            return self._available

        try:
            from llama_cpp import Llama
            self._available = True
        except ImportError:
            self._available = False

        return self._available

    async def get_service_info(self) -> dict[str, str | int | float | bool]:
        """Get information about the AI service."""
        available = await self.is_available()
        info: dict[str, str | int | float | bool] = {
            "name": "llama.cpp",
            "available": available,
            "model_loaded": self._llm is not None,
            "n_ctx": self._n_ctx,
            "n_gpu_layers": self._n_gpu_layers,
        }

        if self._model_path:
            info["model_path"] = self._model_path
            info["model_exists"] = Path(self._model_path).exists()

        return info
