# Phase 3: Speaker Diarization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add speaker identification to transcriptions using Pyannote, allowing users to see who said what and rename speakers

**Architecture:** Extend transcription pipeline to run diarization after WhisperX, merge speaker labels into segments, add Speaker model for custom names

**Tech Stack:** Pyannote.audio, WhisperX assign_word_speakers, SQLAlchemy, React

---

## Task 1: Add Speaker Model

**Files:**
- Modify: `packages/backend/persistence/models.py`

**Step 1: Write the failing test**

Create `packages/backend/tests/test_speaker_model.py`:
```python
"""Test Speaker model."""
import pytest
from sqlalchemy import select
from persistence.database import async_session
from persistence.models import Speaker, Transcript, Recording


@pytest.mark.asyncio
async def test_create_speaker():
    """Test creating a speaker with label and name."""
    async with async_session() as session:
        # Create recording first
        recording = Recording(
            title="Test Recording",
            file_path="/tmp/test.wav",
            file_name="test.wav",
        )
        session.add(recording)
        await session.flush()

        # Create transcript
        transcript = Transcript(recording_id=recording.id, language="en")
        session.add(transcript)
        await session.flush()

        # Create speaker
        speaker = Speaker(
            transcript_id=transcript.id,
            speaker_label="SPEAKER_00",
            speaker_name="John Smith",
            color="#FF5733",
        )
        session.add(speaker)
        await session.commit()

        # Verify
        result = await session.execute(
            select(Speaker).where(Speaker.id == speaker.id)
        )
        saved = result.scalar_one()
        assert saved.speaker_label == "SPEAKER_00"
        assert saved.speaker_name == "John Smith"
        assert saved.color == "#FF5733"
```

**Step 2: Run test to verify it fails**

Run: `cd packages/backend && python -m pytest tests/test_speaker_model.py -v`
Expected: FAIL with "cannot import name 'Speaker'"

**Step 3: Add Speaker model**

In `packages/backend/persistence/models.py`, add after `Segment` class:
```python
class Speaker(Base):
    """Speaker mapping for transcript diarization."""

    __tablename__ = "speakers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    transcript_id: Mapped[str] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    speaker_label: Mapped[str] = mapped_column(String(50), nullable=False)  # "SPEAKER_00"
    speaker_name: Mapped[str | None] = mapped_column(String(255))  # "John Smith"
    color: Mapped[str | None] = mapped_column(String(7))  # "#FF5733"

    transcript: Mapped[Transcript] = relationship(back_populates="speakers")

    __table_args__ = (
        # Unique constraint on transcript_id + speaker_label
        {"sqlite_autoincrement": True},
    )
```

Also add to Transcript model:
```python
speakers: Mapped[list["Speaker"]] = relationship(back_populates="transcript")
```

**Step 4: Run test to verify it passes**

Run: `cd packages/backend && python -m pytest tests/test_speaker_model.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/persistence/models.py packages/backend/tests/test_speaker_model.py
git commit -m "feat(backend): add Speaker model for diarization"
```

---

## Task 2: Create Diarization Service

**Files:**
- Create: `packages/backend/services/diarization.py`
- Create: `packages/backend/tests/test_diarization.py`

**Step 1: Write the failing test**

Create `packages/backend/tests/test_diarization.py`:
```python
"""Test diarization service."""
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_diarization_service_imports():
    """Test that diarization service can be imported."""
    from services.diarization import DiarizationService

    service = DiarizationService()
    assert service is not None
    assert service.device == "cpu"


@pytest.mark.asyncio
async def test_diarization_returns_segments_with_speakers():
    """Test that diarization assigns speakers to segments."""
    from services.diarization import DiarizationService

    service = DiarizationService()

    # Mock whisperx.DiarizationPipeline and assign_word_speakers
    mock_diarize_result = {
        "segments": [
            {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"},
            {"start": 2.0, "end": 4.0, "speaker": "SPEAKER_01"},
        ]
    }

    input_segments = [
        {"start": 0.0, "end": 2.0, "text": "Hello there."},
        {"start": 2.0, "end": 4.0, "text": "Hi, how are you?"},
    ]

    with patch.object(service, '_whisperx') as mock_wx:
        mock_wx.DiarizationPipeline.return_value = MagicMock(
            return_value=mock_diarize_result
        )
        mock_wx.assign_word_speakers.return_value = {
            "segments": [
                {"start": 0.0, "end": 2.0, "text": "Hello there.", "speaker": "SPEAKER_00"},
                {"start": 2.0, "end": 4.0, "text": "Hi, how are you?", "speaker": "SPEAKER_01"},
            ]
        }

        service._diarize_model = mock_wx.DiarizationPipeline()
        service._whisperx = mock_wx

        result = await service.diarize(
            audio_path=Path("/tmp/test.wav"),
            segments=input_segments,
        )

        assert len(result["segments"]) == 2
        assert result["segments"][0]["speaker"] == "SPEAKER_00"
        assert result["segments"][1]["speaker"] == "SPEAKER_01"
        assert "SPEAKER_00" in result["speakers"]
        assert "SPEAKER_01" in result["speakers"]
```

**Step 2: Run test to verify it fails**

Run: `cd packages/backend && python -m pytest tests/test_diarization.py -v`
Expected: FAIL with "No module named 'services.diarization'"

**Step 3: Create diarization service**

Create `packages/backend/services/diarization.py`:
```python
"""Diarization service using Pyannote via WhisperX."""

import logging
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Type for progress callback
ProgressCallback = Callable[[float], Coroutine[Any, Any, None]]


class DiarizationService:
    """Service for speaker diarization using Pyannote via WhisperX.

    Uses lazy loading to avoid import errors when dependencies are not installed.
    """

    def __init__(
        self,
        device: str = "cpu",
        hf_token: str | None = None,
    ):
        """Initialize the diarization service.

        Args:
            device: Device to run inference on (cpu, cuda).
            hf_token: HuggingFace token for pyannote models (optional if pre-downloaded).
        """
        self.device = device
        self.hf_token = hf_token
        self._diarize_model = None
        self._whisperx = None

    def _ensure_loaded(self) -> None:
        """Ensure Pyannote/WhisperX diarization is loaded.

        Raises:
            ImportError: If dependencies are not installed.
        """
        if self._diarize_model is not None:
            return

        try:
            import whisperx
        except ImportError as e:
            raise ImportError(
                "WhisperX is not installed. Install with: pip install 'verbatim-backend[ml]'"
            ) from e

        self._whisperx = whisperx

        logger.info("Loading diarization pipeline (device=%s)", self.device)

        # Load diarization pipeline
        self._diarize_model = whisperx.DiarizationPipeline(
            use_auth_token=self.hf_token,
            device=self.device,
        )

        logger.info("Diarization pipeline loaded successfully")

    async def diarize(
        self,
        audio_path: str | Path,
        segments: list[dict[str, Any]],
        progress_callback: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        """Run diarization on audio and assign speakers to segments.

        Args:
            audio_path: Path to the audio file.
            segments: List of transcript segments with start, end, text.
            progress_callback: Optional async callback for progress updates.

        Returns:
            Dictionary with:
                - segments: List of segments with speaker labels added
                - speakers: List of unique speaker labels found

        Raises:
            ImportError: If dependencies are not installed.
            FileNotFoundError: If audio file doesn't exist.
        """
        audio_path = Path(audio_path)

        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        if progress_callback:
            await progress_callback(5)

        # Load model (lazy)
        self._ensure_loaded()

        if progress_callback:
            await progress_callback(10)

        # Load audio
        logger.info("Loading audio for diarization: %s", audio_path)
        audio = self._whisperx.load_audio(str(audio_path))

        if progress_callback:
            await progress_callback(20)

        # Run diarization
        logger.info("Running diarization...")
        diarize_segments = self._diarize_model(audio)

        if progress_callback:
            await progress_callback(70)

        # Assign speakers to transcript segments
        logger.info("Assigning speakers to segments...")
        result = self._whisperx.assign_word_speakers(diarize_segments, {"segments": segments})

        if progress_callback:
            await progress_callback(90)

        # Extract unique speakers
        speakers = set()
        for segment in result.get("segments", []):
            speaker = segment.get("speaker")
            if speaker:
                speakers.add(speaker)

        logger.info("Diarization complete: %d speakers found", len(speakers))

        if progress_callback:
            await progress_callback(100)

        return {
            "segments": result.get("segments", []),
            "speakers": sorted(speakers),
        }


# Default diarization service instance
diarization_service = DiarizationService()
```

**Step 4: Run test to verify it passes**

Run: `cd packages/backend && python -m pytest tests/test_diarization.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/services/diarization.py packages/backend/tests/test_diarization.py
git commit -m "feat(backend): add diarization service using Pyannote"
```

---

## Task 3: Integrate Diarization into Transcription Job

**Files:**
- Modify: `packages/backend/services/jobs.py`

**Step 1: Update transcription handler to call diarization**

In `packages/backend/services/jobs.py`, modify `handle_transcription`:

```python
async def handle_transcription(
    payload: dict[str, Any], progress_callback: ProgressCallback
) -> dict[str, Any]:
    """Handle transcription job with optional diarization.

    Args:
        payload: Job payload with:
            - recording_id: Required recording ID
            - language: Optional language code
            - diarize: Optional bool to enable diarization (default True)
        progress_callback: Callback to report progress.

    Returns:
        Result dictionary with transcript_id, segment count, speaker count.
    """
    from services.transcription import transcription_service
    from services.diarization import diarization_service

    recording_id = payload.get("recording_id")
    language = payload.get("language")
    diarize = payload.get("diarize", True)  # Default to enabled

    if not recording_id:
        raise ValueError("Missing recording_id in payload")

    # Get recording and update status
    async with async_session() as session:
        result = await session.execute(select(Recording).where(Recording.id == recording_id))
        recording = result.scalar_one_or_none()

        if recording is None:
            raise ValueError(f"Recording not found: {recording_id}")

        # Update recording status to processing
        await session.execute(
            update(Recording).where(Recording.id == recording_id).values(status="processing")
        )
        await session.commit()
        audio_path = recording.file_path

    try:
        # Wrap progress for transcription phase (0-60%)
        async def transcription_progress(p: float) -> None:
            # Scale to 0-60%
            await progress_callback(p * 0.6)

        # Run transcription
        transcription_result = await transcription_service.transcribe(
            audio_path=audio_path,
            language=language,
            progress_callback=transcription_progress,
        )

        detected_language = transcription_result["language"]
        segments_data = transcription_result["segments"]
        speakers_found: list[str] = []

        # Run diarization if enabled
        if diarize and segments_data:
            # Wrap progress for diarization phase (60-95%)
            async def diarization_progress(p: float) -> None:
                await progress_callback(60 + p * 0.35)

            try:
                diarization_result = await diarization_service.diarize(
                    audio_path=audio_path,
                    segments=segments_data,
                    progress_callback=diarization_progress,
                )
                segments_data = diarization_result["segments"]
                speakers_found = diarization_result["speakers"]
                logger.info("Diarization found %d speakers", len(speakers_found))
            except Exception as e:
                # Log but don't fail - diarization is optional
                logger.warning("Diarization failed, continuing without speakers: %s", e)

        await progress_callback(95)

        # Calculate word count
        word_count = sum(len(seg.get("text", "").split()) for seg in segments_data)

        # Create transcript, segments, and speakers in database
        async with async_session() as session:
            # Create transcript
            transcript = Transcript(
                recording_id=recording_id,
                language=detected_language,
                model_used=f"whisperx-{transcription_service.model_name}",
                word_count=word_count,
            )
            session.add(transcript)
            await session.flush()

            # Create segments with speaker labels
            for idx, seg in enumerate(segments_data):
                segment = Segment(
                    transcript_id=transcript.id,
                    segment_index=idx,
                    speaker=seg.get("speaker"),  # Now includes speaker from diarization
                    start_time=seg.get("start", 0.0),
                    end_time=seg.get("end", 0.0),
                    text=seg.get("text", ""),
                    confidence=seg.get("confidence") or seg.get("score"),
                )
                session.add(segment)

            # Create speaker entries for renaming
            for speaker_label in speakers_found:
                speaker = Speaker(
                    transcript_id=transcript.id,
                    speaker_label=speaker_label,
                )
                session.add(speaker)

            # Update recording status to completed
            await session.execute(
                update(Recording).where(Recording.id == recording_id).values(status="completed")
            )
            await session.commit()

            transcript_id = transcript.id

        await progress_callback(100)

        logger.info(
            "Transcription complete for recording %s: %d segments, %d words, %d speakers",
            recording_id,
            len(segments_data),
            word_count,
            len(speakers_found),
        )

        return {
            "transcript_id": transcript_id,
            "segment_count": len(segments_data),
            "word_count": word_count,
            "language": detected_language,
            "speaker_count": len(speakers_found),
        }

    except Exception:
        # Update recording status to failed
        async with async_session() as session:
            await session.execute(
                update(Recording).where(Recording.id == recording_id).values(status="failed")
            )
            await session.commit()
        logger.exception("Transcription failed for recording %s", recording_id)
        raise
```

Also add the Speaker import at the top:
```python
from persistence.models import Job, Recording, Segment, Speaker, Transcript
```

**Step 2: Run existing tests to verify no regressions**

Run: `cd packages/backend && python -m pytest tests/ -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/backend/services/jobs.py
git commit -m "feat(backend): integrate diarization into transcription job"
```

---

## Task 4: Add Speaker API Endpoints

**Files:**
- Create: `packages/backend/api/routes/speakers.py`
- Modify: `packages/backend/api/routes/__init__.py`

**Step 1: Create speakers router**

Create `packages/backend/api/routes/speakers.py`:
```python
"""Speaker API routes."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update

from persistence.database import async_session
from persistence.models import Speaker, Transcript

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/speakers", tags=["speakers"])


class SpeakerResponse(BaseModel):
    """Speaker response model."""

    id: str
    transcript_id: str
    speaker_label: str
    speaker_name: str | None
    color: str | None


class SpeakerUpdateRequest(BaseModel):
    """Speaker update request model."""

    speaker_name: str | None = None
    color: str | None = None


class SpeakerListResponse(BaseModel):
    """Speaker list response model."""

    items: list[SpeakerResponse]


@router.get("/by-transcript/{transcript_id}", response_model=SpeakerListResponse)
async def get_speakers_by_transcript(transcript_id: str) -> SpeakerListResponse:
    """Get all speakers for a transcript.

    Args:
        transcript_id: The transcript ID.

    Returns:
        List of speakers.

    Raises:
        HTTPException: If transcript not found.
    """
    async with async_session() as session:
        # Verify transcript exists
        result = await session.execute(
            select(Transcript).where(Transcript.id == transcript_id)
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Transcript not found")

        # Get speakers
        result = await session.execute(
            select(Speaker)
            .where(Speaker.transcript_id == transcript_id)
            .order_by(Speaker.speaker_label)
        )
        speakers = result.scalars().all()

        return SpeakerListResponse(
            items=[
                SpeakerResponse(
                    id=s.id,
                    transcript_id=s.transcript_id,
                    speaker_label=s.speaker_label,
                    speaker_name=s.speaker_name,
                    color=s.color,
                )
                for s in speakers
            ]
        )


@router.patch("/{speaker_id}", response_model=SpeakerResponse)
async def update_speaker(speaker_id: str, request: SpeakerUpdateRequest) -> SpeakerResponse:
    """Update speaker name or color.

    Args:
        speaker_id: The speaker ID.
        request: Update data.

    Returns:
        Updated speaker.

    Raises:
        HTTPException: If speaker not found.
    """
    async with async_session() as session:
        result = await session.execute(select(Speaker).where(Speaker.id == speaker_id))
        speaker = result.scalar_one_or_none()

        if speaker is None:
            raise HTTPException(status_code=404, detail="Speaker not found")

        # Update fields
        update_data = {}
        if request.speaker_name is not None:
            update_data["speaker_name"] = request.speaker_name
        if request.color is not None:
            update_data["color"] = request.color

        if update_data:
            await session.execute(
                update(Speaker).where(Speaker.id == speaker_id).values(**update_data)
            )
            await session.commit()

            # Refresh
            result = await session.execute(select(Speaker).where(Speaker.id == speaker_id))
            speaker = result.scalar_one()

        return SpeakerResponse(
            id=speaker.id,
            transcript_id=speaker.transcript_id,
            speaker_label=speaker.speaker_label,
            speaker_name=speaker.speaker_name,
            color=speaker.color,
        )
```

**Step 2: Register router in __init__.py**

In `packages/backend/api/routes/__init__.py`, add:
```python
from .speakers import router as speakers_router

# In the list of routers to register:
# speakers_router
```

**Step 3: Commit**

```bash
git add packages/backend/api/routes/speakers.py packages/backend/api/routes/__init__.py
git commit -m "feat(backend): add speaker API endpoints"
```

---

## Task 5: Update Frontend API Client

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add speaker types and API methods**

In `packages/frontend/src/lib/api.ts`, add interfaces:
```typescript
export interface Speaker {
  id: string;
  transcript_id: string;
  speaker_label: string;
  speaker_name: string | null;
  color: string | null;
}

export interface SpeakerListResponse {
  items: Speaker[];
}

export interface SpeakerUpdateRequest {
  speaker_name?: string | null;
  color?: string | null;
}
```

Add to ApiClient class:
```typescript
// Speakers
speakers = {
  byTranscript: (transcriptId: string) =>
    this.request<SpeakerListResponse>(`/api/speakers/by-transcript/${transcriptId}`),

  update: (speakerId: string, data: SpeakerUpdateRequest) =>
    this.request<Speaker>(`/api/speakers/${speakerId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
```

**Step 2: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat(frontend): add speaker API methods"
```

---

## Task 6: Add Speaker Badge Component

**Files:**
- Create: `packages/frontend/src/components/transcript/SpeakerBadge.tsx`

**Step 1: Create SpeakerBadge component**

Create `packages/frontend/src/components/transcript/SpeakerBadge.tsx`:
```tsx
import { useState } from 'react';
import { Speaker, api } from '../../lib/api';

// Default colors for speakers
const DEFAULT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

interface SpeakerBadgeProps {
  speaker: Speaker;
  speakerIndex: number;
  onUpdate?: (speaker: Speaker) => void;
}

export function SpeakerBadge({ speaker, speakerIndex, onUpdate }: SpeakerBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(speaker.speaker_name || '');
  const [isLoading, setIsLoading] = useState(false);

  const color = speaker.color || DEFAULT_COLORS[speakerIndex % DEFAULT_COLORS.length];
  const displayName = speaker.speaker_name || speaker.speaker_label;

  const handleSave = async () => {
    if (name === speaker.speaker_name) {
      setIsEditing(false);
      return;
    }

    setIsLoading(true);
    try {
      const updated = await api.speakers.update(speaker.id, {
        speaker_name: name || null,
      });
      onUpdate?.(updated);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update speaker:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setName(speaker.speaker_name || '');
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        className="px-2 py-0.5 text-xs rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
        placeholder={speaker.speaker_label}
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full cursor-pointer hover:opacity-80 transition-opacity"
      style={{ backgroundColor: `${color}20`, color }}
      title="Click to rename speaker"
    >
      {displayName}
    </button>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/transcript/SpeakerBadge.tsx
git commit -m "feat(frontend): add SpeakerBadge component for speaker renaming"
```

---

## Task 7: Update SegmentList to Show Speakers

**Files:**
- Modify: `packages/frontend/src/components/transcript/SegmentList.tsx`

**Step 1: Update SegmentList to display speaker badges**

Update `packages/frontend/src/components/transcript/SegmentList.tsx`:
```tsx
import { Segment, Speaker, api } from '../../lib/api';
import { useEffect, useState } from 'react';
import { SpeakerBadge } from './SpeakerBadge';

interface SegmentListProps {
  segments: Segment[];
  transcriptId: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SegmentList({ segments, transcriptId }: SegmentListProps) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);

  useEffect(() => {
    // Fetch speakers for this transcript
    api.speakers.byTranscript(transcriptId)
      .then((response) => setSpeakers(response.items))
      .catch((error) => console.error('Failed to load speakers:', error));
  }, [transcriptId]);

  // Create a map of speaker_label -> Speaker object
  const speakerMap = new Map<string, Speaker>();
  speakers.forEach((s) => speakerMap.set(s.speaker_label, s));

  // Create a map of speaker_label -> index for consistent coloring
  const speakerIndexMap = new Map<string, number>();
  speakers.forEach((s, idx) => speakerIndexMap.set(s.speaker_label, idx));

  const handleSpeakerUpdate = (updated: Speaker) => {
    setSpeakers((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    );
  };

  if (segments.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No segments found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {segments.map((segment) => {
        const speaker = segment.speaker ? speakerMap.get(segment.speaker) : null;
        const speakerIndex = segment.speaker ? (speakerIndexMap.get(segment.speaker) ?? 0) : 0;

        return (
          <div
            key={segment.id}
            className="flex gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {/* Timestamp */}
            <div className="flex-shrink-0 w-16 text-xs text-gray-400 font-mono pt-0.5">
              {formatTime(segment.start_time)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Speaker badge */}
              {speaker && (
                <div className="mb-1">
                  <SpeakerBadge
                    speaker={speaker}
                    speakerIndex={speakerIndex}
                    onUpdate={handleSpeakerUpdate}
                  />
                </div>
              )}

              {/* Segment text */}
              <p className="text-gray-800">{segment.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/transcript/SegmentList.tsx
git commit -m "feat(frontend): display speakers in SegmentList with renaming"
```

---

## Task 8: End-to-End Test

**Step 1: Start backend and create test audio with multiple speakers**

```bash
# Start backend
cd packages/backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000 &

# Create test audio with two "speakers" (different voices from macOS say)
cd /tmp
say -v Samantha "Hello, this is the first speaker. How can I help you today?" -o speaker1.aiff
say -v Daniel "Hi there, I'm the second speaker. I have a question about your product." -o speaker2.aiff

# Combine them (requires ffmpeg)
ffmpeg -i speaker1.aiff -i speaker2.aiff -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" -y multi_speaker_test.wav
```

**Step 2: Upload and transcribe**

```bash
# Upload the audio
curl -X POST "http://127.0.0.1:8000/api/recordings/upload" \
  -F "file=@/tmp/multi_speaker_test.wav"

# Start transcription (note the recording_id from above)
curl -X POST "http://127.0.0.1:8000/api/recordings/<RECORDING_ID>/transcribe"

# Poll job status until complete
curl "http://127.0.0.1:8000/api/jobs/<JOB_ID>"
```

**Step 3: Verify speakers are assigned**

```bash
# Get transcript
curl "http://127.0.0.1:8000/api/transcripts/by-recording/<RECORDING_ID>"

# Should see segments with speaker labels like "SPEAKER_00", "SPEAKER_01"

# Get speakers
curl "http://127.0.0.1:8000/api/speakers/by-transcript/<TRANSCRIPT_ID>"

# Should see speaker entries
```

**Step 4: Test speaker renaming in UI**

1. Start frontend: `cd packages/frontend && pnpm dev`
2. Open http://localhost:5173
3. Navigate to the transcribed recording
4. Click on a speaker badge
5. Type a new name and press Enter
6. Verify the name persists after refresh

**Step 5: Commit any fixes**

If all tests pass, create a final commit:
```bash
git add -A
git commit -m "test(e2e): verify speaker diarization end-to-end"
```

---

## Summary

Phase 3 adds speaker diarization with:
1. **Speaker model** - Database table for mapping speaker labels to names
2. **Diarization service** - Pyannote integration via WhisperX
3. **Job integration** - Automatic diarization after transcription
4. **Speaker API** - Endpoints for listing and updating speakers
5. **Frontend updates** - API client, SpeakerBadge component, SegmentList with speakers
6. **E2E testing** - Multi-speaker audio test

After Phase 3, users will see speaker labels on each segment and can click to rename speakers.
