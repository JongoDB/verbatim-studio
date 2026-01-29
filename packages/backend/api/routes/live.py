"""Live transcription WebSocket endpoint."""

import asyncio
import logging
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.factory import get_factory
from core.interfaces import TranscriptionOptions
from persistence.database import get_db
from persistence.models import Recording, Transcript, Segment

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/live", tags=["live"])


@dataclass
class LiveSession:
    """State for a live transcription session."""

    session_id: str
    started_at: datetime
    segments: list[dict] = field(default_factory=list)
    audio_chunks: list[bytes] = field(default_factory=list)
    total_duration: float = 0.0
    language: str = "en"


class SaveSessionRequest(BaseModel):
    """Request to save a live session."""

    session_id: str
    title: str
    save_audio: bool = True


class SaveSessionResponse(BaseModel):
    """Response after saving a live session."""

    recording_id: str
    transcript_id: str
    message: str


# Active sessions storage
active_sessions: dict[str, LiveSession] = {}


@router.websocket("/transcribe")
async def live_transcribe(websocket: WebSocket):
    """WebSocket endpoint for live transcription.

    Protocol:
    1. Client connects
    2. Client sends JSON: {"type": "start", "language": "en"} to start session
    3. Client sends binary audio chunks (WebM/Opus or WAV)
    4. Server responds with JSON: {"type": "transcript", "text": "...", "start": 0.0, "end": 5.0}
    5. Client sends JSON: {"type": "stop"} to end session
    6. Server responds with JSON: {"type": "session_end", "session_id": "..."}
    """
    await websocket.accept()

    session: LiveSession | None = None
    chunk_index = 0

    try:
        factory = get_factory()
        engine = factory.create_transcription_engine()
        if not await engine.is_available():
            await websocket.send_json({
                "type": "error",
                "message": "Transcription engine not available"
            })
            await websocket.close()
            return

        await websocket.send_json({
            "type": "ready",
            "message": "Connected to live transcription service"
        })

        while True:
            message = await websocket.receive()

            # Handle text messages (JSON commands)
            if "text" in message:
                import json
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid JSON"
                    })
                    continue

                msg_type = data.get("type")

                if msg_type == "start":
                    # Start new session
                    session_id = str(uuid.uuid4())
                    language = data.get("language", "en")
                    session = LiveSession(
                        session_id=session_id,
                        started_at=datetime.utcnow(),
                        language=language,
                    )
                    active_sessions[session_id] = session
                    chunk_index = 0

                    await websocket.send_json({
                        "type": "session_start",
                        "session_id": session_id,
                        "message": "Recording started"
                    })
                    logger.info("Live session started: %s", session_id)

                elif msg_type == "stop":
                    if session:
                        await websocket.send_json({
                            "type": "session_end",
                            "session_id": session.session_id,
                            "total_segments": len(session.segments),
                            "total_duration": session.total_duration,
                        })
                        logger.info(
                            "Live session ended: %s (%d segments, %.1fs)",
                            session.session_id,
                            len(session.segments),
                            session.total_duration,
                        )
                    break

                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})

            # Handle binary messages (audio chunks)
            elif "bytes" in message:
                if not session:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Session not started. Send {\"type\": \"start\"} first."
                    })
                    continue

                audio_data = message["bytes"]
                session.audio_chunks.append(audio_data)

                # Save chunk to temp file for transcription
                with tempfile.NamedTemporaryFile(
                    suffix=".webm",
                    delete=False,
                    dir=settings.DATA_DIR,
                ) as tmp:
                    tmp.write(audio_data)
                    tmp_path = tmp.name

                try:
                    # Transcribe the chunk
                    options = TranscriptionOptions(
                        language=session.language,
                        word_timestamps=False,  # Faster without word timestamps
                    )

                    result = await engine.transcribe(tmp_path, options)

                    # Calculate time offset based on previous chunks
                    time_offset = session.total_duration

                    for seg in result.segments:
                        segment_data = {
                            "text": seg.text,
                            "start": time_offset + seg.start,
                            "end": time_offset + seg.end,
                            "speaker": seg.speaker,
                        }
                        session.segments.append(segment_data)

                        # Send segment to client
                        await websocket.send_json({
                            "type": "transcript",
                            "text": seg.text,
                            "start": segment_data["start"],
                            "end": segment_data["end"],
                            "chunk_index": chunk_index,
                        })

                    # Update duration (assume ~5 seconds per chunk)
                    if result.segments:
                        chunk_duration = result.segments[-1].end
                    else:
                        chunk_duration = 5.0
                    session.total_duration += chunk_duration
                    chunk_index += 1

                    logger.debug(
                        "Processed chunk %d: %d segments, total duration %.1fs",
                        chunk_index,
                        len(result.segments),
                        session.total_duration,
                    )

                except Exception as e:
                    logger.error("Transcription error: %s", e)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Transcription failed: {str(e)}"
                    })

                finally:
                    # Clean up temp file
                    try:
                        Path(tmp_path).unlink()
                    except Exception:
                        pass

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error("WebSocket error: %s", e)
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except Exception:
            pass
    finally:
        # Keep session in memory for potential save
        pass


@router.post("/save", response_model=SaveSessionResponse)
async def save_live_session(
    request: SaveSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Save a live transcription session as a Recording + Transcript."""
    session = active_sessions.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    # Create recording
    recording_id = str(uuid.uuid4())
    file_path = None
    file_size = None

    # Optionally save audio
    if request.save_audio and session.audio_chunks:
        # Combine all audio chunks into one file
        audio_filename = f"live-{recording_id}.webm"
        audio_path = settings.MEDIA_DIR / audio_filename

        with open(audio_path, "wb") as f:
            for chunk in session.audio_chunks:
                f.write(chunk)

        file_path = str(audio_path)
        file_size = audio_path.stat().st_size

    recording = Recording(
        id=recording_id,
        title=request.title,
        file_path=file_path,
        file_name=f"live-{recording_id}.webm" if file_path else None,
        file_size=file_size,
        duration_seconds=session.total_duration,
        mime_type="audio/webm" if file_path else None,
        metadata={"source": "live", "session_id": request.session_id},
        status="completed",
    )
    db.add(recording)

    # Create transcript
    transcript_id = str(uuid.uuid4())
    transcript = Transcript(
        id=transcript_id,
        recording_id=recording_id,
        language=session.language,
        model_used="live-transcription",
    )
    db.add(transcript)

    # Create segments
    for i, seg_data in enumerate(session.segments):
        segment = Segment(
            id=str(uuid.uuid4()),
            transcript_id=transcript_id,
            segment_index=i,
            speaker=seg_data.get("speaker"),
            start_time=seg_data["start"],
            end_time=seg_data["end"],
            text=seg_data["text"],
            edited=False,
        )
        db.add(segment)

    await db.commit()

    # Remove session from memory
    del active_sessions[request.session_id]

    logger.info(
        "Saved live session %s as recording %s with %d segments",
        request.session_id,
        recording_id,
        len(session.segments),
    )

    return SaveSessionResponse(
        recording_id=recording_id,
        transcript_id=transcript_id,
        message=f"Saved {len(session.segments)} segments",
    )


@router.delete("/session/{session_id}")
async def discard_session(session_id: str):
    """Discard a live session without saving."""
    if session_id in active_sessions:
        del active_sessions[session_id]
        return {"message": "Session discarded"}
    raise HTTPException(status_code=404, detail="Session not found")
