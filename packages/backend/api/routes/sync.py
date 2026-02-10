"""WebSocket endpoint for real-time data sync."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["sync"])

# Connected WebSocket clients
_clients: Set[WebSocket] = set()


@router.websocket("/sync")
async def sync_websocket(websocket: WebSocket):
    """WebSocket endpoint for data change notifications."""
    await websocket.accept()
    _clients.add(websocket)
    logger.info(f"WebSocket client connected. Total clients: {len(_clients)}")

    try:
        while True:
            # Keep connection alive - client can send ping messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        _clients.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(_clients)}")


async def broadcast(resource: str, action: str, id: str | None = None):
    """
    Broadcast a data change notification to all connected clients.

    Args:
        resource: The resource type (e.g., 'recordings', 'projects', 'conversations')
        action: The action performed (e.g., 'created', 'updated', 'deleted', 'status_changed')
        id: Optional ID of the affected resource
    """
    if not _clients:
        return

    message = {
        "type": "invalidate",
        "resource": resource,
        "action": action,
    }
    if id:
        message["id"] = id

    disconnected = set()
    for client in _clients.copy():
        try:
            await client.send_json(message)
        except Exception:
            disconnected.add(client)

    # Clean up disconnected clients
    for client in disconnected:
        _clients.discard(client)


async def broadcast_job_progress(
    job_id: str,
    job_type: str,
    status: str,
    progress: float,
    task_name: str | None = None,
    recording_id: str | None = None,
    transcript_id: str | None = None,
    error: str | None = None,
):
    """
    Broadcast job progress to all connected clients.

    Args:
        job_id: The job ID
        job_type: The job type (e.g., 'summarize', 'transcribe', 'embed')
        status: The job status ('running', 'completed', 'failed')
        progress: Progress percentage (0-100)
        task_name: Human-readable task name
        recording_id: Optional associated recording ID
        transcript_id: Optional associated transcript ID
        error: Optional error message for failed jobs
    """
    if not _clients:
        return

    message = {
        "type": "job_progress",
        "job_id": job_id,
        "job_type": job_type,
        "status": status,
        "progress": progress,
    }
    if task_name:
        message["task_name"] = task_name
    if recording_id:
        message["recording_id"] = recording_id
    if transcript_id:
        message["transcript_id"] = transcript_id
    if error:
        message["error"] = error

    disconnected = set()
    for client in _clients.copy():
        try:
            await client.send_json(message)
        except Exception:
            disconnected.add(client)

    # Clean up disconnected clients
    for client in disconnected:
        _clients.discard(client)
