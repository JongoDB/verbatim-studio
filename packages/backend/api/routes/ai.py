"""AI analysis endpoints."""

import asyncio
import json
import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.factory import get_factory
from core.interfaces import ChatMessage, ChatOptions
from core.model_catalog import MODEL_CATALOG
from persistence.database import get_db
from persistence.models import Transcript, Segment

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])

# ── Active model tracking ──────────────────────────────────────────────

def _active_model_path() -> Path:
    """Path to the JSON file tracking which model is active."""
    return settings.MODELS_DIR / "active_model.json"


def _read_active_model() -> str | None:
    """Read the currently active model ID from disk."""
    p = _active_model_path()
    if p.exists():
        try:
            data = json.loads(p.read_text())
            return data.get("model_id")
        except (json.JSONDecodeError, OSError):
            pass
    return None


def _write_active_model(model_id: str) -> None:
    """Persist the active model ID."""
    settings.ensure_directories()
    _active_model_path().write_text(json.dumps({"model_id": model_id}))


def _model_file_path(model_id: str) -> Path | None:
    """Return the local file path for a catalog model, or None if not in catalog."""
    entry = MODEL_CATALOG.get(model_id)
    if not entry:
        return None
    return settings.MODELS_DIR / entry["filename"]


def _ensure_active_model_loaded() -> None:
    """Ensure settings.AI_MODEL_PATH is set from the active model if available.

    This bridges the gap between the persisted active_model.json and the
    runtime settings used by the AI service factory.
    """
    if settings.AI_MODEL_PATH:
        return  # Already configured (e.g., via env var)

    active_id = _read_active_model()
    if not active_id:
        return

    file_path = _model_file_path(active_id)
    if file_path and file_path.exists():
        settings.AI_MODEL_PATH = str(file_path)
        logger.info("Loaded active AI model from disk: %s", file_path.name)


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


class AIModelInfo(BaseModel):
    """Info about a catalog model."""

    id: str
    label: str
    description: str
    repo: str
    filename: str
    size_bytes: int
    is_default: bool
    downloaded: bool
    active: bool
    download_path: str | None


class AIModelListResponse(BaseModel):
    """Response listing all catalog models."""

    models: list[AIModelInfo]


# ── Model management endpoints ─────────────────────────────────────────

@router.get("/models", response_model=AIModelListResponse)
async def list_models() -> AIModelListResponse:
    """Return the model catalog merged with download/active status."""
    active_id = _read_active_model()
    items: list[AIModelInfo] = []

    for model_id, entry in MODEL_CATALOG.items():
        file_path = _model_file_path(model_id)
        downloaded = file_path is not None and file_path.exists()
        items.append(AIModelInfo(
            id=model_id,
            label=entry["label"],
            description=entry["description"],
            repo=entry["repo"],
            filename=entry["filename"],
            size_bytes=entry["size_bytes"],
            is_default=entry.get("default", False),
            downloaded=downloaded,
            active=(model_id == active_id),
            download_path=str(file_path) if downloaded else None,
        ))

    return AIModelListResponse(models=items)


# Track in-progress downloads so we don't start duplicates
_download_tasks: dict[str, asyncio.Task] = {}


@router.post("/models/{model_id}/download")
async def download_model(model_id: str) -> StreamingResponse:
    """Download a model from HuggingFace, streaming byte-level progress via SSE."""
    entry = MODEL_CATALOG.get(model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not in catalog")

    file_path = _model_file_path(model_id)
    if file_path and file_path.exists():
        raise HTTPException(status_code=409, detail="Model already downloaded")

    settings.ensure_directories()

    async def _stream_progress():
        import httpx

        try:
            from huggingface_hub import hf_hub_url

            url = hf_hub_url(repo_id=entry["repo"], filename=entry["filename"])
        except ImportError:
            yield f"data: {json.dumps({'status': 'error', 'error': 'huggingface-hub is not installed. Install with: pip install huggingface-hub'})}\n\n"
            return

        yield f"data: {json.dumps({'status': 'starting', 'model_id': model_id})}\n\n"

        total_bytes = entry["size_bytes"]
        dest = settings.MODELS_DIR / entry["filename"]
        tmp_dest = dest.with_suffix(".part")

        try:
            downloaded = 0
            last_pct = -1
            async with httpx.AsyncClient(follow_redirects=True, timeout=None) as client:
                async with client.stream("GET", url) as resp:
                    resp.raise_for_status()
                    content_length = resp.headers.get("content-length")
                    if content_length:
                        total_bytes = int(content_length)

                    with open(tmp_dest, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=256 * 1024):
                            f.write(chunk)
                            downloaded += len(chunk)
                            pct = int(downloaded * 100 / total_bytes) if total_bytes else 0
                            # Emit progress every 1%
                            if pct != last_pct:
                                last_pct = pct
                                yield f"data: {json.dumps({'status': 'progress', 'model_id': model_id, 'downloaded_bytes': downloaded, 'total_bytes': total_bytes})}\n\n"

            # Rename .part → final filename
            tmp_dest.rename(dest)

            yield f"data: {json.dumps({'status': 'complete', 'model_id': model_id, 'path': str(dest)})}\n\n"

            # Auto-activate if no model is currently active
            if _read_active_model() is None:
                _write_active_model(model_id)
                settings.AI_MODEL_PATH = str(dest)
                yield f"data: {json.dumps({'status': 'activated', 'model_id': model_id})}\n\n"

        except Exception as exc:
            logger.exception("Model download failed")
            # Clean up partial file
            if tmp_dest.exists():
                tmp_dest.unlink()
            yield f"data: {json.dumps({'status': 'error', 'error': str(exc)})}\n\n"

    return StreamingResponse(_stream_progress(), media_type="text/event-stream")


@router.post("/models/{model_id}/activate")
async def activate_model(model_id: str):
    """Set a downloaded model as the active model."""
    entry = MODEL_CATALOG.get(model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not in catalog")

    file_path = _model_file_path(model_id)
    if file_path is None or not file_path.exists():
        raise HTTPException(status_code=400, detail="Model is not downloaded")

    _write_active_model(model_id)
    settings.AI_MODEL_PATH = str(file_path)

    return {"status": "activated", "model_id": model_id, "path": str(file_path)}


@router.delete("/models/{model_id}")
async def delete_model(model_id: str):
    """Delete a downloaded model file. If it's the active model, deactivate first."""
    entry = MODEL_CATALOG.get(model_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not in catalog")

    file_path = _model_file_path(model_id)
    if file_path is None or not file_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found")

    # If this is the active model, clear the active state
    active_id = _read_active_model()
    if model_id == active_id:
        _active_model_path().unlink(missing_ok=True)
        settings.AI_MODEL_PATH = None

    file_path.unlink()
    return {"status": "deleted", "model_id": model_id}


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
    _ensure_active_model_loaded()
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
    _ensure_active_model_loaded()
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
    _ensure_active_model_loaded()
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
    _ensure_active_model_loaded()
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
    _ensure_active_model_loaded()
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
    _ensure_active_model_loaded()
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
