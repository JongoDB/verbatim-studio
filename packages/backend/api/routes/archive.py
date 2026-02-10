"""Archive import/export endpoints for backup and restore."""

import io
import json
import logging
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from persistence.database import get_db
from persistence.models import Project, Recording, Speaker, Segment, Transcript

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/archive", tags=["archive"])

# Archive format version for compatibility
ARCHIVE_VERSION = "1.0"


class ArchiveInfo(BaseModel):
    """Response model for archive info."""

    version: str
    created_at: str
    recordings_count: int
    transcripts_count: int
    projects_count: int
    media_size_bytes: int


class ExportResponse(BaseModel):
    """Response model for export request."""

    message: str
    filename: str


class ImportResponse(BaseModel):
    """Response model for import request."""

    message: str
    recordings_imported: int
    transcripts_imported: int
    projects_imported: int
    errors: list[str]


async def _export_data(db: AsyncSession) -> dict:
    """Export all data from database as a dict."""
    data = {
        "version": ARCHIVE_VERSION,
        "created_at": datetime.utcnow().isoformat(),
        "projects": [],
        "recordings": [],
        "transcripts": [],
        "segments": [],
        "speakers": [],
    }

    # Export projects
    result = await db.execute(select(Project))
    for project in result.scalars().all():
        data["projects"].append({
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at.isoformat(),
            "updated_at": project.updated_at.isoformat(),
        })

    # Export recordings
    result = await db.execute(select(Recording))
    for rec in result.scalars().all():
        data["recordings"].append({
            "id": rec.id,
            "project_id": rec.project_id,
            "title": rec.title,
            "file_path": rec.file_path,
            "file_name": rec.file_name,
            "file_size": rec.file_size,
            "duration_seconds": rec.duration_seconds,
            "mime_type": rec.mime_type,
            "metadata": rec.metadata_,
            "status": rec.status,
            "created_at": rec.created_at.isoformat(),
            "updated_at": rec.updated_at.isoformat(),
        })

    # Export transcripts
    result = await db.execute(select(Transcript))
    for trans in result.scalars().all():
        data["transcripts"].append({
            "id": trans.id,
            "recording_id": trans.recording_id,
            "language": trans.language,
            "model_used": trans.model_used,
            "confidence_avg": trans.confidence_avg,
            "word_count": trans.word_count,
            "created_at": trans.created_at.isoformat(),
            "updated_at": trans.updated_at.isoformat(),
        })

    # Export segments
    result = await db.execute(select(Segment))
    for seg in result.scalars().all():
        data["segments"].append({
            "id": seg.id,
            "transcript_id": seg.transcript_id,
            "segment_index": seg.segment_index,
            "speaker": seg.speaker,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "text": seg.text,
            "confidence": seg.confidence,
            "edited": seg.edited,
            "created_at": seg.created_at.isoformat(),
            "updated_at": seg.updated_at.isoformat(),
        })

    # Export speakers
    result = await db.execute(select(Speaker))
    for spk in result.scalars().all():
        data["speakers"].append({
            "id": spk.id,
            "transcript_id": spk.transcript_id,
            "speaker_label": spk.speaker_label,
            "speaker_name": spk.speaker_name,
            "color": spk.color,
            "created_at": spk.created_at.isoformat(),
            "updated_at": spk.updated_at.isoformat(),
        })

    return data


@router.get("/info", response_model=ArchiveInfo)
async def get_archive_info(db: Annotated[AsyncSession, Depends(get_db)]) -> ArchiveInfo:
    """Get information about what would be included in an archive export."""
    # Count records
    recordings_result = await db.execute(select(Recording))
    recordings = recordings_result.scalars().all()

    transcripts_result = await db.execute(select(Transcript))
    transcripts_count = len(transcripts_result.scalars().all())

    projects_result = await db.execute(select(Project))
    projects_count = len(projects_result.scalars().all())

    # Calculate media size (with error handling for missing/inaccessible files)
    media_size = 0
    for rec in recordings:
        try:
            if not rec.file_path or rec.file_path.startswith("live://"):
                # Use DB file_size for sentinel paths
                media_size += rec.file_size or 0
                continue
            file_path = Path(rec.file_path)
            if file_path.is_absolute() and file_path.exists():
                media_size += file_path.stat().st_size
            elif rec.file_size:
                # Cloud or relative paths – use DB file_size
                media_size += rec.file_size
        except Exception:
            # Fallback to DB file_size for any path access error
            media_size += rec.file_size or 0

    return ArchiveInfo(
        version=ARCHIVE_VERSION,
        created_at=datetime.utcnow().isoformat(),
        recordings_count=len(recordings),
        transcripts_count=transcripts_count,
        projects_count=projects_count,
        media_size_bytes=media_size,
    )


@router.post("/export")
async def export_archive(
    db: Annotated[AsyncSession, Depends(get_db)],
    include_media: bool = True,
) -> StreamingResponse:
    """Export all data as a .vbz archive (zip file).

    The archive includes:
    - manifest.json: Archive metadata and version
    - data.json: Database records (projects, recordings, transcripts, etc.)
    - media/: Media files (if include_media is True)
    """
    # Export data
    data = await _export_data(db)

    # Create archive in memory
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # Write manifest
        manifest = {
            "version": ARCHIVE_VERSION,
            "created_at": data["created_at"],
            "include_media": include_media,
            "recordings_count": len(data["recordings"]),
            "transcripts_count": len(data["transcripts"]),
            "projects_count": len(data["projects"]),
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

        # Write data
        zf.writestr("data.json", json.dumps(data, indent=2))

        # Include media files
        if include_media:
            for rec in data["recordings"]:
                fp = rec.get("file_path") or ""
                if not fp or fp.startswith("live://"):
                    continue
                try:
                    file_path = Path(fp)
                    if file_path.is_absolute() and file_path.exists():
                        archive_path = f"media/{rec['id']}/{rec['file_name']}"
                        zf.write(file_path, archive_path)
                except Exception:
                    continue

    buffer.seek(0)

    # Generate filename with timestamp
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"verbatim_backup_{timestamp}.vbz"

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", response_model=ImportResponse)
async def import_archive(
    db: Annotated[AsyncSession, Depends(get_db)],
    file: Annotated[UploadFile, File(description="Archive file (.vbz)")],
    merge: bool = True,
) -> ImportResponse:
    """Import data from a .vbz archive.

    Args:
        file: The archive file to import
        merge: If True, merge with existing data. If False, replace all data.
    """
    if not file.filename or not file.filename.endswith((".vbz", ".zip")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Expected .vbz archive.",
        )

    errors: list[str] = []
    recordings_imported = 0
    transcripts_imported = 0
    projects_imported = 0

    # Read archive
    content = await file.read()
    buffer = io.BytesIO(content)

    try:
        with zipfile.ZipFile(buffer, "r") as zf:
            # Verify manifest
            try:
                manifest_data = zf.read("manifest.json")
                manifest = json.loads(manifest_data)
            except KeyError:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid archive: missing manifest.json",
                )

            # Check version compatibility
            archive_version = manifest.get("version", "0.0")
            if archive_version != ARCHIVE_VERSION:
                logger.warning(
                    "Archive version mismatch: %s vs %s",
                    archive_version,
                    ARCHIVE_VERSION,
                )

            # Read data
            try:
                data_content = zf.read("data.json")
                data = json.loads(data_content)
            except KeyError:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid archive: missing data.json",
                )

            # Create temp directory for media extraction
            with TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)

                # Extract media files if present
                media_files = {}
                for name in zf.namelist():
                    if name.startswith("media/"):
                        zf.extract(name, temp_path)
                        # Map recording ID to extracted path
                        parts = name.split("/")
                        if len(parts) >= 3:
                            rec_id = parts[1]
                            media_files[rec_id] = temp_path / name

                # Import projects
                for proj_data in data.get("projects", []):
                    try:
                        # Check if project exists
                        existing = await db.execute(
                            select(Project).where(Project.id == proj_data["id"])
                        )
                        if existing.scalar_one_or_none() is None:
                            project = Project(
                                id=proj_data["id"],
                                name=proj_data["name"],
                                description=proj_data.get("description"),
                            )
                            db.add(project)
                            projects_imported += 1
                    except Exception as e:
                        errors.append(f"Project {proj_data.get('name')}: {str(e)}")

                # Import recordings
                for rec_data in data.get("recordings", []):
                    try:
                        # Check if recording exists
                        existing = await db.execute(
                            select(Recording).where(Recording.id == rec_data["id"])
                        )
                        if existing.scalar_one_or_none() is not None:
                            continue  # Skip existing

                        # Copy media file if available
                        file_path = ""
                        if rec_data["id"] in media_files:
                            src_path = media_files[rec_data["id"]]
                            if src_path.exists():
                                # Create destination path
                                dest_dir = settings.MEDIA_DIR / rec_data["id"]
                                dest_dir.mkdir(parents=True, exist_ok=True)
                                dest_path = dest_dir / rec_data["file_name"]
                                shutil.copy2(src_path, dest_path)
                                file_path = str(dest_path)

                        recording = Recording(
                            id=rec_data["id"],
                            project_id=rec_data.get("project_id"),
                            title=rec_data["title"],
                            file_path=file_path or rec_data.get("file_path", ""),
                            file_name=rec_data["file_name"],
                            file_size=rec_data.get("file_size"),
                            duration_seconds=rec_data.get("duration_seconds"),
                            mime_type=rec_data.get("mime_type"),
                            metadata_=rec_data.get("metadata", {}),
                            status=rec_data.get("status", "completed"),
                        )
                        db.add(recording)
                        recordings_imported += 1
                    except Exception as e:
                        errors.append(f"Recording {rec_data.get('title')}: {str(e)}")

                # Import transcripts
                for trans_data in data.get("transcripts", []):
                    try:
                        existing = await db.execute(
                            select(Transcript).where(Transcript.id == trans_data["id"])
                        )
                        if existing.scalar_one_or_none() is not None:
                            continue

                        transcript = Transcript(
                            id=trans_data["id"],
                            recording_id=trans_data["recording_id"],
                            language=trans_data.get("language"),
                            model_used=trans_data.get("model_used"),
                            confidence_avg=trans_data.get("confidence_avg"),
                            word_count=trans_data.get("word_count"),
                        )
                        db.add(transcript)
                        transcripts_imported += 1
                    except Exception as e:
                        errors.append(f"Transcript {trans_data.get('id')}: {str(e)}")

                # Import segments
                for seg_data in data.get("segments", []):
                    try:
                        existing = await db.execute(
                            select(Segment).where(Segment.id == seg_data["id"])
                        )
                        if existing.scalar_one_or_none() is not None:
                            continue

                        segment = Segment(
                            id=seg_data["id"],
                            transcript_id=seg_data["transcript_id"],
                            segment_index=seg_data["segment_index"],
                            speaker=seg_data.get("speaker"),
                            start_time=seg_data["start_time"],
                            end_time=seg_data["end_time"],
                            text=seg_data["text"],
                            confidence=seg_data.get("confidence"),
                            edited=seg_data.get("edited", False),
                        )
                        db.add(segment)
                    except Exception as e:
                        errors.append(f"Segment {seg_data.get('id')}: {str(e)}")

                # Import speakers
                for spk_data in data.get("speakers", []):
                    try:
                        existing = await db.execute(
                            select(Speaker).where(Speaker.id == spk_data["id"])
                        )
                        if existing.scalar_one_or_none() is not None:
                            continue

                        speaker = Speaker(
                            id=spk_data["id"],
                            transcript_id=spk_data["transcript_id"],
                            speaker_label=spk_data["speaker_label"],
                            speaker_name=spk_data.get("speaker_name"),
                            color=spk_data.get("color"),
                        )
                        db.add(speaker)
                    except Exception as e:
                        errors.append(f"Speaker {spk_data.get('speaker_label')}: {str(e)}")

                await db.commit()

    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400,
            detail="Invalid archive: corrupted or not a valid zip file",
        )

    return ImportResponse(
        message="Import completed" + (" with errors" if errors else " successfully"),
        recordings_imported=recordings_imported,
        transcripts_imported=transcripts_imported,
        projects_imported=projects_imported,
        errors=errors[:10],  # Limit error messages
    )
