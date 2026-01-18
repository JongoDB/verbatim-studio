"""AI analysis endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.factory import get_factory
from core.interfaces import ChatMessage, ChatOptions
from persistence.database import get_db
from persistence.models import Transcript, Segment

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])


class ChatRequest(BaseModel):
    """Request model for chat."""

    message: str
    context: str | None = None  # Optional transcript context
    temperature: float = 0.7
    max_tokens: int | None = None


class ChatResponse(BaseModel):
    """Response model for chat."""

    content: str
    model: str


class SummarizationResponse(BaseModel):
    """Response model for transcript summarization."""

    summary: str
    key_points: list[str] | None
    action_items: list[str] | None
    topics: list[str] | None


class AnalysisResponse(BaseModel):
    """Response model for transcript analysis."""

    analysis_type: str
    content: dict


class AIStatusResponse(BaseModel):
    """Response model for AI service status."""

    available: bool
    provider: str
    model_loaded: bool
    model_path: str | None
    models: list[dict]


async def get_transcript_text(db: AsyncSession, transcript_id: str) -> str:
    """Get full transcript text from segments."""
    result = await db.execute(
        select(Segment)
        .where(Segment.transcript_id == transcript_id)
        .order_by(Segment.segment_index)
    )
    segments = result.scalars().all()

    if not segments:
        raise HTTPException(status_code=404, detail="Transcript not found or empty")

    # Format with speaker labels if available
    lines = []
    for seg in segments:
        if seg.speaker:
            lines.append(f"[{seg.speaker}]: {seg.text}")
        else:
            lines.append(seg.text)

    return "\n".join(lines)


@router.get("/status", response_model=AIStatusResponse)
async def get_ai_status() -> AIStatusResponse:
    """Get AI service status and available models."""
    factory = get_factory()
    ai_service = factory.create_ai_service()

    available = await ai_service.is_available()
    info = await ai_service.get_service_info()
    models = await ai_service.get_available_models() if available else []

    return AIStatusResponse(
        available=available,
        provider=str(info.get("name", "unknown")),
        model_loaded=bool(info.get("model_loaded", False)),
        model_path=str(info.get("model_path")) if info.get("model_path") else None,
        models=models,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Send a chat message to the AI."""
    factory = get_factory()
    ai_service = factory.create_ai_service()

    if not await ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service not available. Please configure a model path.",
        )

    messages = []

    # Add context if provided
    if request.context:
        messages.append(ChatMessage(
            role="system",
            content=f"You are a helpful assistant. Here is some context:\n\n{request.context}",
        ))

    messages.append(ChatMessage(role="user", content=request.message))

    options = ChatOptions(
        temperature=request.temperature,
        max_tokens=request.max_tokens,
    )

    try:
        response = await ai_service.chat(messages, options)
        return ChatResponse(content=response.content, model=response.model)
    except Exception as e:
        logger.exception("Chat request failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    """Send a streaming chat message to the AI."""
    factory = get_factory()
    ai_service = factory.create_ai_service()

    if not await ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service not available. Please configure a model path.",
        )

    messages = []
    if request.context:
        messages.append(ChatMessage(
            role="system",
            content=f"You are a helpful assistant. Here is some context:\n\n{request.context}",
        ))
    messages.append(ChatMessage(role="user", content=request.message))

    options = ChatOptions(
        temperature=request.temperature,
        max_tokens=request.max_tokens,
    )

    async def generate():
        try:
            async for chunk in ai_service.chat_stream(messages, options):
                yield f"data: {chunk.content}\n\n"
                if chunk.finish_reason:
                    yield f"data: [DONE]\n\n"
        except Exception as e:
            logger.exception("Stream chat failed")
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/transcripts/{transcript_id}/summarize", response_model=SummarizationResponse)
async def summarize_transcript(
    transcript_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    temperature: Annotated[float, Query(ge=0, le=2)] = 0.3,
) -> SummarizationResponse:
    """Generate a summary of a transcript."""
    factory = get_factory()
    ai_service = factory.create_ai_service()

    if not await ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service not available. Please configure a model path.",
        )

    # Verify transcript exists
    result = await db.execute(select(Transcript).where(Transcript.id == transcript_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Transcript not found")

    transcript_text = await get_transcript_text(db, transcript_id)

    try:
        options = ChatOptions(temperature=temperature, max_tokens=1024)
        result = await ai_service.summarize_transcript(transcript_text, options)

        return SummarizationResponse(
            summary=result.summary,
            key_points=result.key_points,
            action_items=result.action_items,
            topics=result.topics,
        )
    except Exception as e:
        logger.exception("Summarization failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transcripts/{transcript_id}/analyze", response_model=AnalysisResponse)
async def analyze_transcript(
    transcript_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    analysis_type: Annotated[
        str,
        Query(description="Type of analysis: sentiment, topics, entities, questions, action_items"),
    ] = "topics",
    temperature: Annotated[float, Query(ge=0, le=2)] = 0.3,
) -> AnalysisResponse:
    """Perform analysis on a transcript."""
    factory = get_factory()
    ai_service = factory.create_ai_service()

    if not await ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service not available. Please configure a model path.",
        )

    # Verify transcript exists
    result = await db.execute(select(Transcript).where(Transcript.id == transcript_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Transcript not found")

    transcript_text = await get_transcript_text(db, transcript_id)

    valid_types = ["sentiment", "topics", "entities", "questions", "action_items"]
    if analysis_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid analysis type. Valid types: {', '.join(valid_types)}",
        )

    try:
        options = ChatOptions(temperature=temperature, max_tokens=1024)
        result = await ai_service.analyze_transcript(transcript_text, analysis_type, options)

        return AnalysisResponse(
            analysis_type=result.analysis_type,
            content=result.content,
        )
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transcripts/{transcript_id}/ask", response_model=ChatResponse)
async def ask_about_transcript(
    transcript_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    question: Annotated[str, Query(description="Question about the transcript")],
    temperature: Annotated[float, Query(ge=0, le=2)] = 0.5,
) -> ChatResponse:
    """Ask a question about a specific transcript."""
    factory = get_factory()
    ai_service = factory.create_ai_service()

    if not await ai_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI service not available. Please configure a model path.",
        )

    # Verify transcript exists
    result = await db.execute(select(Transcript).where(Transcript.id == transcript_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Transcript not found")

    transcript_text = await get_transcript_text(db, transcript_id)

    messages = [
        ChatMessage(
            role="system",
            content=f"""You are a helpful assistant that answers questions about transcripts.
Here is the transcript to reference:

{transcript_text}

Answer questions based on the content of this transcript. If the answer cannot be found in the transcript, say so.""",
        ),
        ChatMessage(role="user", content=question),
    ]

    try:
        options = ChatOptions(temperature=temperature, max_tokens=512)
        response = await ai_service.chat(messages, options)
        return ChatResponse(content=response.content, model=response.model)
    except Exception as e:
        logger.exception("Ask about transcript failed")
        raise HTTPException(status_code=500, detail=str(e))
