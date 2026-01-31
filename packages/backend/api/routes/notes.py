"""Notes management endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence import get_db
from persistence.models import Document, Note, Recording

router = APIRouter(prefix="/notes", tags=["notes"])


class NoteCreate(BaseModel):
    """Request model for creating a note."""

    content: str
    recording_id: str | None = None
    document_id: str | None = None
    anchor_type: str  # timestamp, page, paragraph, selection
    anchor_data: dict  # {time: 45.2} or {page: 3}


class NoteUpdate(BaseModel):
    """Request model for updating a note."""

    content: str | None = None
    anchor_type: str | None = None
    anchor_data: dict | None = None


class NoteResponse(BaseModel):
    """Response model for a note."""

    id: str
    content: str
    recording_id: str | None
    document_id: str | None
    anchor_type: str
    anchor_data: dict
    created_at: str
    updated_at: str


class NoteListResponse(BaseModel):
    """Response model for listing notes."""

    items: list[NoteResponse]
    total: int


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    id: str | None = None


def _note_to_response(note: Note) -> NoteResponse:
    """Convert Note model to response."""
    return NoteResponse(
        id=note.id,
        content=note.content,
        recording_id=note.recording_id,
        document_id=note.document_id,
        anchor_type=note.anchor_type,
        anchor_data=note.anchor_data,
        created_at=note.created_at.isoformat(),
        updated_at=note.updated_at.isoformat(),
    )


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_in: NoteCreate,
) -> NoteResponse:
    """Create a new note attached to a recording or document."""
    # Validate exactly one parent is set
    if not note_in.recording_id and not note_in.document_id:
        raise HTTPException(status_code=400, detail="Must specify either recording_id or document_id")
    if note_in.recording_id and note_in.document_id:
        raise HTTPException(status_code=400, detail="Cannot specify both recording_id and document_id")

    # Validate parent exists
    if note_in.recording_id:
        recording = await db.get(Recording, note_in.recording_id)
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
    if note_in.document_id:
        document = await db.get(Document, note_in.document_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

    # Validate anchor_type
    valid_anchor_types = {"timestamp", "page", "paragraph", "selection"}
    if note_in.anchor_type not in valid_anchor_types:
        raise HTTPException(status_code=400, detail=f"Invalid anchor_type. Must be one of: {valid_anchor_types}")

    note = Note(
        content=note_in.content,
        recording_id=note_in.recording_id,
        document_id=note_in.document_id,
        anchor_type=note_in.anchor_type,
        anchor_data=note_in.anchor_data,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)

    return _note_to_response(note)


@router.get("", response_model=NoteListResponse)
async def list_notes(
    db: Annotated[AsyncSession, Depends(get_db)],
    recording_id: Annotated[str | None, Query(description="Filter by recording")] = None,
    document_id: Annotated[str | None, Query(description="Filter by document")] = None,
) -> NoteListResponse:
    """List notes for a recording or document."""
    if not recording_id and not document_id:
        raise HTTPException(status_code=400, detail="Must specify either recording_id or document_id")

    query = select(Note).order_by(Note.created_at.asc())

    if recording_id:
        query = query.where(Note.recording_id == recording_id)
    if document_id:
        query = query.where(Note.document_id == document_id)

    result = await db.execute(query)
    notes = result.scalars().all()

    return NoteListResponse(
        items=[_note_to_response(note) for note in notes],
        total=len(notes),
    )


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_id: str,
) -> NoteResponse:
    """Get a single note by ID."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return _note_to_response(note)


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_id: str,
    update: NoteUpdate,
) -> NoteResponse:
    """Update a note's content or anchor."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if update.content is not None:
        note.content = update.content
    if update.anchor_type is not None:
        valid_anchor_types = {"timestamp", "page", "paragraph", "selection"}
        if update.anchor_type not in valid_anchor_types:
            raise HTTPException(status_code=400, detail=f"Invalid anchor_type")
        note.anchor_type = update.anchor_type
    if update.anchor_data is not None:
        note.anchor_data = update.anchor_data

    await db.commit()
    await db.refresh(note)
    return _note_to_response(note)


@router.delete("/{note_id}", response_model=MessageResponse)
async def delete_note(
    db: Annotated[AsyncSession, Depends(get_db)],
    note_id: str,
) -> MessageResponse:
    """Delete a note."""
    note = await db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    await db.delete(note)
    await db.commit()

    return MessageResponse(message="Note deleted", id=note_id)
