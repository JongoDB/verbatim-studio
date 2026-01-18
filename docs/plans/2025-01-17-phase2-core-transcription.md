# Phase 2: Core Transcription - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable file upload, WhisperX batch transcription, basic transcript viewer, and job queue system.

**Architecture:** File uploads stored in ~/Library/Application Support/Verbatim Studio/media/, transcription jobs processed via ThreadPoolExecutor, results saved to SQLite.

**Tech Stack:** FastAPI file upload, WhisperX for transcription, ThreadPoolExecutor for job queue, React for transcript viewer.

---

## Task 1: Add Recording File Upload API

**Files:**
- Create: `packages/backend/api/routes/recordings.py`
- Modify: `packages/backend/api/main.py`
- Create: `packages/backend/services/__init__.py`
- Create: `packages/backend/services/storage.py`

**Step 1: Create storage service**

Create `packages/backend/services/__init__.py`:
```python
"""Backend services."""
```

Create `packages/backend/services/storage.py`:
```python
"""File storage service."""

import shutil
import uuid
from pathlib import Path

import aiofiles

from core.config import settings


class StorageService:
    """Handles file storage operations."""

    def __init__(self):
        self.media_dir = settings.MEDIA_DIR
        self.media_dir.mkdir(parents=True, exist_ok=True)

    def get_recording_path(self, recording_id: str, filename: str) -> Path:
        """Get path for a recording file."""
        ext = Path(filename).suffix
        return self.media_dir / f"{recording_id}{ext}"

    async def save_upload(self, recording_id: str, filename: str, file) -> Path:
        """Save uploaded file to storage."""
        path = self.get_recording_path(recording_id, filename)
        async with aiofiles.open(path, "wb") as out_file:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                await out_file.write(chunk)
        return path

    async def delete_file(self, path: Path) -> None:
        """Delete a file from storage."""
        if path.exists():
            path.unlink()

    def get_file_size(self, path: Path) -> int:
        """Get file size in bytes."""
        return path.stat().st_size if path.exists() else 0


storage_service = StorageService()
```

**Step 2: Create recordings router**

Create `packages/backend/api/routes/recordings.py`:
```python
"""Recording endpoints."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence import get_db
from persistence.models import Recording
from services.storage import storage_service

router = APIRouter(prefix="/recordings", tags=["recordings"])

ALLOWED_MIME_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "video/mp4",
    "video/quicktime",
    "video/webm",
}


class RecordingResponse(BaseModel):
    id: str
    title: str
    file_name: str
    file_path: str
    file_size: int | None
    duration_seconds: float | None
    mime_type: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RecordingListResponse(BaseModel):
    recordings: list[RecordingResponse]
    total: int


@router.get("", response_model=RecordingListResponse)
async def list_recordings(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all recordings."""
    result = await db.execute(
        select(Recording).order_by(Recording.created_at.desc()).offset(skip).limit(limit)
    )
    recordings = result.scalars().all()

    count_result = await db.execute(select(Recording))
    total = len(count_result.scalars().all())

    return RecordingListResponse(recordings=recordings, total=total)


@router.post("/upload", response_model=RecordingResponse)
async def upload_recording(
    file: UploadFile = File(...),
    title: str | None = None,
    project_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Upload a new recording."""
    # Validate file type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Allowed: audio/video files.",
        )

    # Generate ID and save file
    recording_id = str(uuid.uuid4())
    file_path = await storage_service.save_upload(recording_id, file.filename, file)
    file_size = storage_service.get_file_size(file_path)

    # Create database record
    recording = Recording(
        id=recording_id,
        project_id=project_id,
        title=title or file.filename,
        file_path=str(file_path),
        file_name=file.filename,
        file_size=file_size,
        mime_type=content_type,
        status="pending",
    )

    db.add(recording)
    await db.flush()
    await db.refresh(recording)

    return recording


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(
    recording_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a recording by ID."""
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    return recording


@router.delete("/{recording_id}")
async def delete_recording(
    recording_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a recording."""
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Delete file
    await storage_service.delete_file(Path(recording.file_path))

    # Delete database record
    await db.delete(recording)

    return {"status": "deleted"}
```

**Step 3: Register recordings router**

Modify `packages/backend/api/main.py` to add:
```python
from api.routes import health, recordings

# Routes
app.include_router(health.router)
app.include_router(recordings.router, prefix="/api")
```

**Step 4: Add aiofiles dependency**

Add to `packages/backend/pyproject.toml`:
```toml
"aiofiles>=24.0.0",
```

**Step 5: Install and test**

Run:
```bash
cd packages/backend
source .venv/bin/activate
pip install -e .
uvicorn api.main:app --reload
```

Test:
```bash
curl -X POST "http://127.0.0.1:8000/api/recordings/upload" \
  -F "file=@test.mp3" \
  -F "title=Test Recording"
```

**Step 6: Commit**

```bash
git add packages/backend/
git commit -m "feat: add recording file upload API"
```

---

## Task 2: Add Job Queue System

**Files:**
- Create: `packages/backend/services/jobs.py`
- Modify: `packages/backend/api/main.py`
- Create: `packages/backend/api/routes/jobs.py`

**Step 1: Create job queue service**

Create `packages/backend/services/jobs.py`:
```python
"""Job queue service using ThreadPoolExecutor."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import select, update

from persistence.database import async_session
from persistence.models import Job


class JobQueue:
    """Simple job queue using ThreadPoolExecutor."""

    def __init__(self, max_workers: int = 2):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.handlers: dict[str, Callable] = {}

    def register_handler(self, job_type: str, handler: Callable):
        """Register a handler for a job type."""
        self.handlers[job_type] = handler

    async def enqueue(
        self,
        job_type: str,
        payload: dict[str, Any],
    ) -> Job:
        """Add a job to the queue."""
        async with async_session() as session:
            job = Job(
                job_type=job_type,
                payload=payload,
                status="queued",
            )
            session.add(job)
            await session.commit()
            await session.refresh(job)

            # Submit to executor
            self.executor.submit(self._run_job_sync, job.id)

            return job

    def _run_job_sync(self, job_id: str):
        """Synchronous wrapper to run job in thread."""
        asyncio.run(self._run_job(job_id))

    async def _run_job(self, job_id: str):
        """Execute a job."""
        async with async_session() as session:
            # Get job
            result = await session.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one_or_none()

            if not job:
                return

            # Mark as running
            job.status = "running"
            job.started_at = datetime.utcnow()
            await session.commit()

            try:
                # Get handler
                handler = self.handlers.get(job.job_type)
                if not handler:
                    raise ValueError(f"No handler for job type: {job.job_type}")

                # Run handler
                job_result = await handler(job.payload, self._make_progress_callback(job_id))

                # Mark complete
                job.status = "completed"
                job.result = job_result
                job.progress = 100
                job.completed_at = datetime.utcnow()

            except Exception as e:
                job.status = "failed"
                job.error = str(e)
                job.completed_at = datetime.utcnow()

            await session.commit()

    def _make_progress_callback(self, job_id: str):
        """Create a progress callback for a job."""

        async def update_progress(progress: float):
            async with async_session() as session:
                await session.execute(
                    update(Job).where(Job.id == job_id).values(progress=progress)
                )
                await session.commit()

        return update_progress

    async def get_job(self, job_id: str) -> Job | None:
        """Get job by ID."""
        async with async_session() as session:
            result = await session.execute(select(Job).where(Job.id == job_id))
            return result.scalar_one_or_none()

    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a queued job."""
        async with async_session() as session:
            result = await session.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one_or_none()

            if job and job.status == "queued":
                job.status = "cancelled"
                job.completed_at = datetime.utcnow()
                await session.commit()
                return True

            return False

    def shutdown(self):
        """Shutdown the executor."""
        self.executor.shutdown(wait=True)


job_queue = JobQueue()
```

**Step 2: Create jobs router**

Create `packages/backend/api/routes/jobs.py`:
```python
"""Job queue endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persistence import get_db
from persistence.models import Job

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobResponse(BaseModel):
    id: str
    job_type: str
    status: str
    progress: float
    error: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    jobs: list[JobResponse]
    total: int


@router.get("", response_model=JobListResponse)
async def list_jobs(
    status: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List jobs, optionally filtered by status."""
    query = select(Job).order_by(Job.created_at.desc())

    if status:
        query = query.where(Job.status == status)

    result = await db.execute(query.offset(skip).limit(limit))
    jobs = result.scalars().all()

    count_result = await db.execute(query)
    total = len(count_result.scalars().all())

    return JobListResponse(jobs=jobs, total=total)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get job status."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return job


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a queued job."""
    from services.jobs import job_queue

    success = await job_queue.cancel_job(job_id)

    if not success:
        raise HTTPException(status_code=400, detail="Cannot cancel job (not queued)")

    return {"status": "cancelled"}
```

**Step 3: Register jobs router and shutdown hook**

Modify `packages/backend/api/main.py`:
```python
from api.routes import health, jobs, recordings
from services.jobs import job_queue

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    settings.ensure_directories()
    await init_db()
    yield
    # Shutdown
    job_queue.shutdown()

# Routes
app.include_router(health.router)
app.include_router(recordings.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
```

**Step 4: Test and commit**

Run:
```bash
cd packages/backend && source .venv/bin/activate
uvicorn api.main:app --reload
```

Test:
```bash
curl http://127.0.0.1:8000/api/jobs
```

Commit:
```bash
git add packages/backend/
git commit -m "feat: add job queue system with ThreadPoolExecutor"
```

---

## Task 3: Add WhisperX Transcription Service

**Files:**
- Create: `packages/backend/services/transcription.py`
- Modify: `packages/backend/api/routes/recordings.py`
- Modify: `packages/backend/pyproject.toml`

**Step 1: Add WhisperX dependencies**

Add to `packages/backend/pyproject.toml`:
```toml
[project.optional-dependencies]
ml = [
    "whisperx>=3.1.0",
    "torch>=2.0.0",
]
```

**Step 2: Create transcription service**

Create `packages/backend/services/transcription.py`:
```python
"""WhisperX transcription service."""

import logging
from pathlib import Path
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)


class TranscriptionService:
    """Handles audio transcription using WhisperX."""

    def __init__(self):
        self.model = None
        self.model_name = "base"  # Default model
        self._whisperx = None

    def _ensure_loaded(self):
        """Lazy load WhisperX and model."""
        if self._whisperx is None:
            try:
                import whisperx

                self._whisperx = whisperx
            except ImportError:
                raise RuntimeError(
                    "WhisperX not installed. Install with: pip install -e '.[ml]'"
                )

        if self.model is None:
            device = "cpu"  # TODO: Detect MPS/CUDA
            compute_type = "int8"

            logger.info(f"Loading WhisperX model: {self.model_name}")
            self.model = self._whisperx.load_model(
                self.model_name,
                device=device,
                compute_type=compute_type,
            )
            logger.info("WhisperX model loaded")

    async def transcribe(
        self,
        audio_path: Path,
        language: str | None = None,
        progress_callback=None,
    ) -> dict[str, Any]:
        """Transcribe an audio file."""
        self._ensure_loaded()

        if progress_callback:
            await progress_callback(10)

        # Load audio
        logger.info(f"Loading audio: {audio_path}")
        audio = self._whisperx.load_audio(str(audio_path))

        if progress_callback:
            await progress_callback(20)

        # Transcribe
        logger.info("Running transcription...")
        result = self.model.transcribe(
            audio,
            batch_size=16,
            language=language,
        )

        if progress_callback:
            await progress_callback(60)

        # Align whisper output
        logger.info("Aligning timestamps...")
        model_a, metadata = self._whisperx.load_align_model(
            language_code=result["language"],
            device="cpu",
        )

        result = self._whisperx.align(
            result["segments"],
            model_a,
            metadata,
            audio,
            device="cpu",
            return_char_alignments=False,
        )

        if progress_callback:
            await progress_callback(90)

        return {
            "language": result.get("language", language or "en"),
            "segments": result["segments"],
        }


transcription_service = TranscriptionService()
```

**Step 3: Add transcription job handler**

Modify `packages/backend/services/jobs.py` to add:
```python
from services.transcription import transcription_service

async def handle_transcription(payload: dict, progress_callback) -> dict:
    """Handle transcription job."""
    from pathlib import Path
    from persistence.database import async_session
    from persistence.models import Recording, Transcript, Segment

    recording_id = payload["recording_id"]

    async with async_session() as session:
        # Get recording
        result = await session.execute(
            select(Recording).where(Recording.id == recording_id)
        )
        recording = result.scalar_one()

        # Update status
        recording.status = "processing"
        await session.commit()

        try:
            # Transcribe
            result = await transcription_service.transcribe(
                Path(recording.file_path),
                progress_callback=progress_callback,
            )

            # Create transcript
            transcript = Transcript(
                recording_id=recording_id,
                language=result["language"],
                model_used="whisperx-base",
                word_count=sum(len(s.get("text", "").split()) for s in result["segments"]),
            )
            session.add(transcript)
            await session.flush()

            # Create segments
            for i, seg in enumerate(result["segments"]):
                segment = Segment(
                    transcript_id=transcript.id,
                    segment_index=i,
                    start_time=seg["start"],
                    end_time=seg["end"],
                    text=seg["text"].strip(),
                    confidence=seg.get("confidence"),
                )
                session.add(segment)

            # Update recording status
            recording.status = "completed"
            await session.commit()

            return {"transcript_id": transcript.id}

        except Exception as e:
            recording.status = "failed"
            await session.commit()
            raise


# Register handler
job_queue.register_handler("transcribe", handle_transcription)
```

**Step 4: Add transcription endpoint**

Modify `packages/backend/api/routes/recordings.py` to add:
```python
from services.jobs import job_queue

@router.post("/{recording_id}/transcribe")
async def start_transcription(
    recording_id: str,
    language: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Start transcription job for a recording."""
    # Verify recording exists
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if recording.status == "processing":
        raise HTTPException(status_code=400, detail="Already processing")

    # Create job
    job = await job_queue.enqueue(
        "transcribe",
        {"recording_id": recording_id, "language": language},
    )

    return {"job_id": job.id, "status": "queued"}
```

**Step 5: Test and commit**

```bash
git add packages/backend/
git commit -m "feat: add WhisperX transcription service"
```

---

## Task 4: Add Transcript API Endpoints

**Files:**
- Create: `packages/backend/api/routes/transcripts.py`
- Modify: `packages/backend/api/main.py`

**Step 1: Create transcripts router**

Create `packages/backend/api/routes/transcripts.py`:
```python
"""Transcript endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from persistence import get_db
from persistence.models import Segment, Transcript

router = APIRouter(prefix="/transcripts", tags=["transcripts"])


class SegmentResponse(BaseModel):
    id: str
    segment_index: int
    speaker: str | None
    start_time: float
    end_time: float
    text: str
    confidence: float | None
    edited: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TranscriptResponse(BaseModel):
    id: str
    recording_id: str
    language: str | None
    model_used: str | None
    confidence_avg: float | None
    word_count: int | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TranscriptWithSegmentsResponse(TranscriptResponse):
    segments: list[SegmentResponse]


class SegmentUpdateRequest(BaseModel):
    text: str | None = None
    speaker: str | None = None


@router.get("/{transcript_id}", response_model=TranscriptWithSegmentsResponse)
async def get_transcript(
    transcript_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get transcript with all segments."""
    result = await db.execute(
        select(Transcript)
        .options(selectinload(Transcript.segments))
        .where(Transcript.id == transcript_id)
    )
    transcript = result.scalar_one_or_none()

    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    # Sort segments by index
    transcript.segments.sort(key=lambda s: s.segment_index)

    return transcript


@router.get("/{transcript_id}/segments", response_model=list[SegmentResponse])
async def get_segments(
    transcript_id: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """Get paginated segments for a transcript."""
    # Verify transcript exists
    result = await db.execute(select(Transcript).where(Transcript.id == transcript_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Transcript not found")

    result = await db.execute(
        select(Segment)
        .where(Segment.transcript_id == transcript_id)
        .order_by(Segment.segment_index)
        .offset(skip)
        .limit(limit)
    )

    return result.scalars().all()


@router.patch("/{transcript_id}/segments/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    transcript_id: str,
    segment_id: str,
    update: SegmentUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update a segment's text or speaker."""
    result = await db.execute(
        select(Segment).where(
            Segment.id == segment_id,
            Segment.transcript_id == transcript_id,
        )
    )
    segment = result.scalar_one_or_none()

    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    if update.text is not None:
        segment.text = update.text
        segment.edited = True

    if update.speaker is not None:
        segment.speaker = update.speaker

    await db.flush()
    await db.refresh(segment)

    return segment


@router.get("/by-recording/{recording_id}", response_model=TranscriptResponse | None)
async def get_transcript_by_recording(
    recording_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get transcript for a recording."""
    result = await db.execute(
        select(Transcript).where(Transcript.recording_id == recording_id)
    )
    return result.scalar_one_or_none()
```

**Step 2: Register transcripts router**

Modify `packages/backend/api/main.py`:
```python
from api.routes import health, jobs, recordings, transcripts

# Routes
app.include_router(health.router)
app.include_router(recordings.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(transcripts.router, prefix="/api")
```

**Step 3: Test and commit**

```bash
git add packages/backend/
git commit -m "feat: add transcript API endpoints"
```

---

## Task 5: Add Frontend Recording Upload UI

**Files:**
- Create: `packages/frontend/src/components/recordings/UploadDropzone.tsx`
- Create: `packages/frontend/src/components/recordings/RecordingCard.tsx`
- Create: `packages/frontend/src/pages/recordings/RecordingsPage.tsx`
- Modify: `packages/frontend/src/lib/api.ts`
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Extend API client**

Modify `packages/frontend/src/lib/api.ts`:
```typescript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export interface Recording {
  id: string;
  title: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  duration_seconds: number | null;
  mime_type: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  job_type: string;
  status: string;
  progress: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Segment {
  id: string;
  segment_index: number;
  speaker: string | null;
  start_time: number;
  end_time: number;
  text: string;
  confidence: number | null;
  edited: boolean;
}

export interface Transcript {
  id: string;
  recording_id: string;
  language: string | null;
  model_used: string | null;
  word_count: number | null;
  segments: Segment[];
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Health
  health = {
    ready: () =>
      this.request<{
        status: string;
        services: Record<string, string>;
      }>('/health/ready'),
  };

  // Root info
  info = () =>
    this.request<{
      name: string;
      version: string;
      mode: string;
    }>('/');

  // Recordings
  recordings = {
    list: () =>
      this.request<{ recordings: Recording[]; total: number }>('/api/recordings'),

    get: (id: string) => this.request<Recording>(`/api/recordings/${id}`),

    upload: async (file: File, title?: string): Promise<Recording> => {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);

      const response = await fetch(`${this.baseUrl}/api/recordings/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      return response.json();
    },

    delete: (id: string) =>
      this.request<{ status: string }>(`/api/recordings/${id}`, {
        method: 'DELETE',
      }),

    transcribe: (id: string) =>
      this.request<{ job_id: string; status: string }>(
        `/api/recordings/${id}/transcribe`,
        { method: 'POST' }
      ),
  };

  // Jobs
  jobs = {
    list: () => this.request<{ jobs: Job[]; total: number }>('/api/jobs'),
    get: (id: string) => this.request<Job>(`/api/jobs/${id}`),
  };

  // Transcripts
  transcripts = {
    get: (id: string) => this.request<Transcript>(`/api/transcripts/${id}`),
    byRecording: (recordingId: string) =>
      this.request<Transcript | null>(`/api/transcripts/by-recording/${recordingId}`),
  };
}

export const api = new ApiClient();
```

**Step 2: Create UploadDropzone component**

Create `packages/frontend/src/components/recordings/UploadDropzone.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

interface UploadDropzoneProps {
  onUpload: (file: File) => Promise<void>;
  isUploading: boolean;
}

export function UploadDropzone({ onUpload, isUploading }: UploadDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        await onUpload(file);
      }
    },
    [onUpload]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await onUpload(file);
      }
    },
    [onUpload]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
        isDragOver ? 'border-primary bg-primary/5' : 'border-border',
        isUploading && 'opacity-50 pointer-events-none'
      )}
    >
      <div className="space-y-4">
        <div className="text-4xl">🎙️</div>
        <div>
          <p className="text-lg font-medium">
            {isUploading ? 'Uploading...' : 'Drop audio or video file here'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            or click to browse
          </p>
        </div>
        <input
          type="file"
          accept="audio/*,video/*"
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
          disabled={isUploading}
        />
        <label
          htmlFor="file-upload"
          className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90"
        >
          Choose File
        </label>
      </div>
    </div>
  );
}
```

**Step 3: Create RecordingCard component**

Create `packages/frontend/src/components/recordings/RecordingCard.tsx`:
```tsx
import { Recording } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RecordingCardProps {
  recording: Recording;
  onTranscribe: () => void;
  onDelete: () => void;
  onView: () => void;
}

export function RecordingCard({
  recording,
  onTranscribe,
  onDelete,
  onView,
}: RecordingCardProps) {
  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{recording.title}</h3>
          <p className="text-sm text-muted-foreground truncate">
            {recording.file_name}
          </p>
        </div>
        <span
          className={cn(
            'px-2 py-1 text-xs rounded-full ml-2',
            statusColors[recording.status] || 'bg-gray-100'
          )}
        >
          {recording.status}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
        <span>{formatSize(recording.file_size)}</span>
        <span>{formatDate(recording.created_at)}</span>
      </div>

      <div className="mt-4 flex gap-2">
        {recording.status === 'pending' && (
          <button
            onClick={onTranscribe}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Transcribe
          </button>
        )}
        {recording.status === 'completed' && (
          <button
            onClick={onView}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            View Transcript
          </button>
        )}
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-sm border rounded hover:bg-destructive/10"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
```

**Step 4: Create RecordingsPage**

Create `packages/frontend/src/pages/recordings/RecordingsPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api, Recording } from '@/lib/api';
import { UploadDropzone } from '@/components/recordings/UploadDropzone';
import { RecordingCard } from '@/components/recordings/RecordingCard';

export function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecordings = async () => {
    try {
      const data = await api.recordings.list();
      setRecordings(data.recordings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recordings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecordings();
    const interval = setInterval(loadRecordings, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      await api.recordings.upload(file);
      await loadRecordings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleTranscribe = async (id: string) => {
    try {
      await api.recordings.transcribe(id);
      await loadRecordings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start transcription');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.recordings.delete(id);
      await loadRecordings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleView = (id: string) => {
    // TODO: Navigate to transcript view
    console.log('View transcript for recording:', id);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Recordings</h1>

      <UploadDropzone onUpload={handleUpload} isUploading={isUploading} />

      {error && (
        <div className="mt-4 p-4 bg-destructive/10 text-destructive rounded">
          {error}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Your Recordings</h2>

        {isLoading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : recordings.length === 0 ? (
          <p className="text-muted-foreground">No recordings yet. Upload one to get started!</p>
        ) : (
          <div className="grid gap-4">
            {recordings.map((recording) => (
              <RecordingCard
                key={recording.id}
                recording={recording}
                onTranscribe={() => handleTranscribe(recording.id)}
                onDelete={() => handleDelete(recording.id)}
                onView={() => handleView(recording.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 5: Update App.tsx with routing**

Modify `packages/frontend/src/app/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { RecordingsPage } from '@/pages/recordings/RecordingsPage';

interface ApiInfo {
  name: string;
  version: string;
  mode: string;
}

interface HealthStatus {
  status: string;
  services: Record<string, string>;
}

export function App() {
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkBackend() {
      try {
        const [info, healthStatus] = await Promise.all([
          api.info(),
          api.health.ready(),
        ]);
        setApiInfo(info);
        setHealth(healthStatus);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
      }
    }

    checkBackend();
    const interval = setInterval(checkBackend, 15000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-destructive mb-4">
            Connection Error
          </h1>
          <p className="text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Make sure the backend is running on port 8000
          </p>
        </div>
      </div>
    );
  }

  if (!apiInfo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Connecting to backend...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <h1 className="font-semibold">Verbatim Studio</h1>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>v{apiInfo.version}</span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs ${
              health?.status === 'ready'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {health?.status || 'checking'}
          </span>
        </div>
      </header>

      <main>
        <RecordingsPage />
      </main>
    </div>
  );
}
```

**Step 6: Test and commit**

```bash
cd packages/frontend && pnpm build
git add packages/frontend/
git commit -m "feat: add recording upload UI and recordings page"
```

---

## Task 6: Add Basic Transcript Viewer

**Files:**
- Create: `packages/frontend/src/pages/transcript/TranscriptPage.tsx`
- Create: `packages/frontend/src/components/transcript/SegmentList.tsx`
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Create SegmentList component**

Create `packages/frontend/src/components/transcript/SegmentList.tsx`:
```tsx
import { Segment } from '@/lib/api';

interface SegmentListProps {
  segments: Segment[];
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SegmentList({ segments }: SegmentListProps) {
  return (
    <div className="space-y-4">
      {segments.map((segment) => (
        <div
          key={segment.id}
          className="flex gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors"
        >
          <div className="flex-shrink-0 w-20 text-sm text-muted-foreground font-mono">
            {formatTime(segment.start_time)}
          </div>
          {segment.speaker && (
            <div className="flex-shrink-0 w-24">
              <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded">
                {segment.speaker}
              </span>
            </div>
          )}
          <div className="flex-1">
            <p className={segment.edited ? 'italic' : ''}>{segment.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Create TranscriptPage**

Create `packages/frontend/src/pages/transcript/TranscriptPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api, Transcript } from '@/lib/api';
import { SegmentList } from '@/components/transcript/SegmentList';

interface TranscriptPageProps {
  recordingId: string;
  onBack: () => void;
}

export function TranscriptPage({ recordingId, onBack }: TranscriptPageProps) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTranscript() {
      try {
        const data = await api.transcripts.byRecording(recordingId);
        if (data) {
          const full = await api.transcripts.get(data.id);
          setTranscript(full);
        } else {
          setError('No transcript found for this recording');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load transcript');
      } finally {
        setIsLoading(false);
      }
    }

    loadTranscript();
  }, [recordingId]);

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading transcript...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <button
          onClick={onBack}
          className="mb-4 text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to recordings
        </button>
        <div className="p-4 bg-destructive/10 text-destructive rounded">
          {error}
        </div>
      </div>
    );
  }

  if (!transcript) {
    return null;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="mb-4 text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to recordings
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Transcript</h1>
        <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
          <span>Language: {transcript.language || 'Unknown'}</span>
          <span>Words: {transcript.word_count || 0}</span>
          <span>Model: {transcript.model_used || 'Unknown'}</span>
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-card">
        <SegmentList segments={transcript.segments} />
      </div>
    </div>
  );
}
```

**Step 3: Update App.tsx with navigation**

Modify `packages/frontend/src/app/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { RecordingsPage } from '@/pages/recordings/RecordingsPage';
import { TranscriptPage } from '@/pages/transcript/TranscriptPage';

// ... existing code ...

export function App() {
  const [currentView, setCurrentView] = useState<
    { type: 'recordings' } | { type: 'transcript'; recordingId: string }
  >({ type: 'recordings' });

  // ... existing backend connection code ...

  const handleViewTranscript = (recordingId: string) => {
    setCurrentView({ type: 'transcript', recordingId });
  };

  const handleBackToRecordings = () => {
    setCurrentView({ type: 'recordings' });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ... header ... */}
      <main>
        {currentView.type === 'recordings' ? (
          <RecordingsPage onViewTranscript={handleViewTranscript} />
        ) : (
          <TranscriptPage
            recordingId={currentView.recordingId}
            onBack={handleBackToRecordings}
          />
        )}
      </main>
    </div>
  );
}
```

Update `RecordingsPage` to accept `onViewTranscript` prop:
```tsx
interface RecordingsPageProps {
  onViewTranscript: (recordingId: string) => void;
}

export function RecordingsPage({ onViewTranscript }: RecordingsPageProps) {
  // ... existing code ...

  const handleView = (id: string) => {
    onViewTranscript(id);
  };

  // ... rest of component ...
}
```

**Step 4: Test and commit**

```bash
cd packages/frontend && pnpm build
git add packages/frontend/
git commit -m "feat: add basic transcript viewer"
```

---

## Summary

After completing all tasks, you will have:

1. **Recording file upload API** - Upload audio/video files with storage management
2. **Job queue system** - ThreadPoolExecutor-based queue for async processing
3. **WhisperX transcription service** - Batch transcription with progress tracking
4. **Transcript API** - CRUD endpoints for transcripts and segments
5. **Recording upload UI** - Drag-and-drop upload with status display
6. **Transcript viewer** - Read-only view of transcription results

Phase 2 is ready for Phase 3: Speaker Diarization (Pyannote integration).
