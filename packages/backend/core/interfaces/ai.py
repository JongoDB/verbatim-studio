"""AI service interface definitions.

This module defines the contract for AI/LLM operations,
allowing different implementations (llama.cpp local, Ollama, OpenAI, etc.)
to be swapped transparently.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class ChatMessage:
    """A message in a chat conversation."""

    role: str  # system, user, assistant
    content: str


@dataclass
class ChatOptions:
    """Options for chat completion."""

    model: str | None = None  # Specific model to use
    temperature: float = 0.7
    max_tokens: int | None = None
    top_p: float = 1.0
    stop: list[str] | None = None
    system_prompt: str | None = None


@dataclass
class ChatResponse:
    """Response from a chat completion."""

    content: str
    model: str
    usage: dict[str, int] | None = None  # tokens used
    finish_reason: str | None = None


@dataclass
class ChatStreamChunk:
    """A chunk from streaming chat completion."""

    content: str
    finish_reason: str | None = None


@dataclass
class SummarizationResult:
    """Result of transcript summarization."""

    summary: str
    key_points: list[str] | None = None
    action_items: list[str] | None = None
    topics: list[str] | None = None
    named_entities: list[str] | None = None


@dataclass
class AnalysisResult:
    """Result of transcript analysis."""

    analysis_type: str
    content: dict  # Flexible structure based on analysis type
    confidence: float | None = None


class IAIService(ABC):
    """Interface for AI/LLM operations.

    Implementations can wrap:
    - llama.cpp (local, basic tier)
    - Ollama (local/remote, enterprise tier)
    - OpenAI API
    - Anthropic Claude API
    - Google Gemini API
    - etc.
    """

    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        options: ChatOptions | None = None,
    ) -> ChatResponse:
        """Send a chat completion request.

        Args:
            messages: Conversation history
            options: Chat options

        Returns:
            ChatResponse with generated content
        """
        ...

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[ChatMessage],
        options: ChatOptions | None = None,
    ) -> AsyncIterator[ChatStreamChunk]:
        """Send a streaming chat completion request.

        Args:
            messages: Conversation history
            options: Chat options

        Yields:
            ChatStreamChunk with content pieces
        """
        ...

    @abstractmethod
    async def summarize_transcript(
        self,
        transcript_text: str,
        options: ChatOptions | None = None,
    ) -> SummarizationResult:
        """Generate a summary of a transcript.

        Args:
            transcript_text: Full transcript text
            options: Chat options for the underlying model

        Returns:
            SummarizationResult with summary and extracted info
        """
        ...

    @abstractmethod
    async def analyze_transcript(
        self,
        transcript_text: str,
        analysis_type: str,
        options: ChatOptions | None = None,
    ) -> AnalysisResult:
        """Perform analysis on a transcript.

        Analysis types may include:
        - sentiment: Sentiment analysis
        - topics: Topic extraction
        - entities: Named entity recognition
        - questions: Extract questions asked
        - action_items: Extract action items
        - custom: Custom analysis with instructions

        Args:
            transcript_text: Full transcript text
            analysis_type: Type of analysis to perform
            options: Chat options

        Returns:
            AnalysisResult with analysis data
        """
        ...

    @abstractmethod
    async def get_available_models(self) -> list[dict[str, str]]:
        """Get list of available models.

        Returns:
            List of model info dicts with 'id' and 'name' keys
        """
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the AI service is available and ready.

        Returns:
            True if service is ready to process requests
        """
        ...

    @abstractmethod
    async def get_service_info(self) -> dict[str, str | int | float | bool]:
        """Get information about the AI service.

        Returns:
            Dict with service details (provider, models, status, etc.)
        """
        ...
