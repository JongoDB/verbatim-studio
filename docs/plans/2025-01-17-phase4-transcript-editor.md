# Phase 4: Transcript Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to edit transcript segments, sync with audio playback, and visualize audio waveforms

**Architecture:** Add segment editing API, audio player component, waveform visualization, and keyboard navigation

**Tech Stack:** React, WaveSurfer.js (waveform), FastAPI, HTML5 Audio API

---

## Task 1: Add Segment Update API Endpoint

**Files:**
- Modify: `packages/backend/api/routes/transcripts.py`

**Step 1: Add segment update endpoint**

In `packages/backend/api/routes/transcripts.py`, add:
```python
class SegmentUpdateRequest(BaseModel):
    """Segment update request."""
    text: str | None = None
    speaker: str | None = None


@router.patch("/{transcript_id}/segments/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    transcript_id: str,
    segment_id: str,
    request: SegmentUpdateRequest,
) -> SegmentResponse:
    """Update a segment's text or speaker.

    Args:
        transcript_id: The transcript ID.
        segment_id: The segment ID.
        request: Update data.

    Returns:
        Updated segment.
    """
    async with async_session() as session:
        # Verify segment belongs to transcript
        result = await session.execute(
            select(Segment)
            .where(Segment.id == segment_id)
            .where(Segment.transcript_id == transcript_id)
        )
        segment = result.scalar_one_or_none()

        if segment is None:
            raise HTTPException(status_code=404, detail="Segment not found")

        # Update fields
        update_data = {}
        if request.text is not None:
            update_data["text"] = request.text
            update_data["edited"] = True
        if request.speaker is not None:
            update_data["speaker"] = request.speaker

        if update_data:
            await session.execute(
                update(Segment).where(Segment.id == segment_id).values(**update_data)
            )
            await session.commit()

            # Refresh
            result = await session.execute(select(Segment).where(Segment.id == segment_id))
            segment = result.scalar_one()

        return SegmentResponse(
            id=segment.id,
            segment_index=segment.segment_index,
            speaker=segment.speaker,
            start_time=segment.start_time,
            end_time=segment.end_time,
            text=segment.text,
            confidence=segment.confidence,
            edited=segment.edited,
            created_at=segment.created_at.isoformat(),
            updated_at=segment.updated_at.isoformat(),
        )
```

**Step 2: Commit**

```bash
git add packages/backend/api/routes/transcripts.py
git commit -m "feat(backend): add segment update API endpoint"
```

---

## Task 2: Add Audio Streaming Endpoint

**Files:**
- Modify: `packages/backend/api/routes/recordings.py`

**Step 1: Add audio stream endpoint**

In `packages/backend/api/routes/recordings.py`, add:
```python
from fastapi.responses import FileResponse, StreamingResponse
from pathlib import Path
import mimetypes


@router.get("/{recording_id}/audio")
async def stream_audio(recording_id: str):
    """Stream the audio file for a recording.

    Args:
        recording_id: The recording ID.

    Returns:
        Audio file stream.
    """
    async with async_session() as session:
        result = await session.execute(
            select(Recording).where(Recording.id == recording_id)
        )
        recording = result.scalar_one_or_none()

        if recording is None:
            raise HTTPException(status_code=404, detail="Recording not found")

        file_path = Path(recording.file_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Audio file not found")

        mime_type = recording.mime_type or mimetypes.guess_type(str(file_path))[0] or "audio/mpeg"

        return FileResponse(
            path=file_path,
            media_type=mime_type,
            filename=recording.file_name,
        )
```

**Step 2: Commit**

```bash
git add packages/backend/api/routes/recordings.py
git commit -m "feat(backend): add audio streaming endpoint"
```

---

## Task 3: Update Frontend API Client

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add segment update and audio URL methods**

In `packages/frontend/src/lib/api.ts`, add to the ApiClient class:
```typescript
// In transcripts section, add:
updateSegment: (transcriptId: string, segmentId: string, data: { text?: string; speaker?: string }) =>
  this.request<Segment>(`/api/transcripts/${transcriptId}/segments/${segmentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),

// In recordings section, add:
getAudioUrl: (recordingId: string) => `${this.baseUrl}/api/recordings/${recordingId}/audio`,
```

**Step 2: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat(frontend): add segment update and audio URL methods"
```

---

## Task 4: Create Audio Player Component

**Files:**
- Create: `packages/frontend/src/components/audio/AudioPlayer.tsx`

**Step 1: Create AudioPlayer component**

```tsx
import { useEffect, useRef, useState } from 'react';

interface AudioPlayerProps {
  src: string;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
}

export function AudioPlayer({ src, onTimeUpdate, onDurationChange }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    };

    const handleDurationChange = () => {
      setDuration(audio.duration);
      onDurationChange?.(audio.duration);
    };

    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [onTimeUpdate, onDurationChange]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
  };

  const changePlaybackRate = (rate: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-4 p-4 bg-card border rounded-lg">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {isPlaying ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Time display */}
      <span className="text-sm font-mono text-muted-foreground w-20">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* Progress bar */}
      <div
        className="flex-1 h-2 bg-muted rounded-full cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const percentage = x / rect.width;
          seek(percentage * duration);
        }}
      >
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Playback rate */}
      <select
        value={playbackRate}
        onChange={(e) => changePlaybackRate(parseFloat(e.target.value))}
        className="text-sm bg-background border rounded px-2 py-1"
      >
        <option value="0.5">0.5x</option>
        <option value="0.75">0.75x</option>
        <option value="1">1x</option>
        <option value="1.25">1.25x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
    </div>
  );
}

// Export seek function for external control
export function useAudioPlayerRef() {
  const audioRef = useRef<HTMLAudioElement>(null);

  const seekTo = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  return { audioRef, seekTo };
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/audio/AudioPlayer.tsx
git commit -m "feat(frontend): add AudioPlayer component"
```

---

## Task 5: Create Editable Segment Component

**Files:**
- Create: `packages/frontend/src/components/transcript/EditableSegment.tsx`

**Step 1: Create EditableSegment component**

```tsx
import { useState, useRef, useEffect } from 'react';
import { Segment, Speaker, api } from '../../lib/api';
import { SpeakerBadge } from './SpeakerBadge';

interface EditableSegmentProps {
  segment: Segment;
  transcriptId: string;
  speaker: Speaker | null;
  speakerIndex: number;
  isActive: boolean;
  onSegmentUpdate: (segment: Segment) => void;
  onSpeakerUpdate: (speaker: Speaker) => void;
  onSeek: (time: number) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function EditableSegment({
  segment,
  transcriptId,
  speaker,
  speakerIndex,
  isActive,
  onSegmentUpdate,
  onSpeakerUpdate,
  onSeek,
}: EditableSegmentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(segment.text);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(segment.text);
  }, [segment.text]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(text.length, text.length);
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (text === segment.text) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const updated = await api.transcripts.updateSegment(transcriptId, segment.id, { text });
      onSegmentUpdate(updated);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save segment:', error);
      setText(segment.text); // Revert
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setText(segment.text);
      setIsEditing(false);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div
      className={`flex gap-3 p-3 rounded-lg border transition-all ${
        isActive
          ? 'bg-primary/5 border-primary/50 shadow-sm'
          : 'bg-card hover:border-primary/30'
      }`}
    >
      {/* Timestamp - clickable to seek */}
      <button
        onClick={() => onSeek(segment.start_time)}
        className="flex-shrink-0 w-14 text-sm font-mono text-primary hover:underline"
        title="Click to seek to this time"
      >
        {formatTime(segment.start_time)}
      </button>

      {/* Speaker badge */}
      {speaker && (
        <div className="flex-shrink-0">
          <SpeakerBadge
            speaker={speaker}
            speakerIndex={speakerIndex}
            onUpdate={onSpeakerUpdate}
          />
        </div>
      )}

      {/* Segment text */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            className="w-full p-2 text-sm bg-background border rounded resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            rows={Math.max(2, text.split('\n').length)}
          />
        ) : (
          <p
            onClick={() => setIsEditing(true)}
            className={`text-sm leading-relaxed cursor-text hover:bg-muted/50 rounded p-1 -m-1 ${
              segment.edited ? 'italic text-muted-foreground' : 'text-foreground'
            }`}
            title="Click to edit"
          >
            {segment.text}
            {segment.edited && (
              <span className="ml-2 text-xs text-muted-foreground">(edited)</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/components/transcript/EditableSegment.tsx
git commit -m "feat(frontend): add EditableSegment component"
```

---

## Task 6: Update TranscriptPage with Editor

**Files:**
- Modify: `packages/frontend/src/pages/transcript/TranscriptPage.tsx`

**Step 1: Add audio player and editable segments**

Integrate the AudioPlayer and EditableSegment components, add current time tracking for segment highlighting.

```tsx
import { useCallback, useEffect, useState, useRef } from 'react';
import { api, type TranscriptWithSegments, type Segment, type Speaker, type Recording } from '@/lib/api';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { EditableSegment } from '@/components/transcript/EditableSegment';

interface TranscriptPageProps {
  recordingId: string;
  onBack: () => void;
}

export function TranscriptPage({ recordingId, onBack }: TranscriptPageProps) {
  const [transcript, setTranscript] = useState<TranscriptWithSegments | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [transcriptData, recordingData] = await Promise.all([
        api.transcripts.byRecording(recordingId),
        api.recordings.get(recordingId),
      ]);

      setTranscript(transcriptData);
      setRecording(recordingData);

      // Load speakers
      const speakersData = await api.speakers.byTranscript(transcriptData.id);
      setSpeakers(speakersData.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transcript');
    } finally {
      setIsLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSegmentUpdate = (updated: Segment) => {
    setTranscript((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        segments: prev.segments.map((s) => (s.id === updated.id ? updated : s)),
      };
    });
  };

  const handleSpeakerUpdate = (updated: Speaker) => {
    setSpeakers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const seekTo = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      audioRef.current.play();
    }
  };

  // Find active segment based on current time
  const activeSegmentId = transcript?.segments.find(
    (s) => currentTime >= s.start_time && currentTime < s.end_time
  )?.id;

  // Create speaker maps
  const speakerMap = new Map<string, Speaker>();
  const speakerIndexMap = new Map<string, number>();
  speakers.forEach((s, idx) => {
    speakerMap.set(s.speaker_label, s);
    speakerIndexMap.set(s.speaker_label, idx);
  });

  // Loading/error states handled here...
  // (keep existing loading/error JSX)

  if (isLoading || !transcript || !recording) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="...">Back</button>

      {/* Audio Player */}
      <AudioPlayer
        ref={audioRef}
        src={api.recordings.getAudioUrl(recordingId)}
        onTimeUpdate={setCurrentTime}
      />

      {/* Transcript info */}
      <div className="...">
        <h2>{recording.title}</h2>
        {/* ... transcript details ... */}
      </div>

      {/* Editable Segments */}
      <div className="space-y-2">
        {transcript.segments.map((segment) => {
          const speaker = segment.speaker ? speakerMap.get(segment.speaker) : null;
          const speakerIndex = segment.speaker ? (speakerIndexMap.get(segment.speaker) ?? 0) : 0;

          return (
            <EditableSegment
              key={segment.id}
              segment={segment}
              transcriptId={transcript.id}
              speaker={speaker}
              speakerIndex={speakerIndex}
              isActive={segment.id === activeSegmentId}
              onSegmentUpdate={handleSegmentUpdate}
              onSpeakerUpdate={handleSpeakerUpdate}
              onSeek={seekTo}
            />
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/pages/transcript/TranscriptPage.tsx
git commit -m "feat(frontend): integrate audio player and editable segments"
```

---

## Task 7: End-to-End Test

**Step 1: Test audio playback and segment editing**

1. Start backend and frontend
2. Navigate to a transcript
3. Test audio player controls (play, pause, seek, speed)
4. Click a timestamp to seek to that time
5. Click segment text to edit, make changes, save
6. Verify the segment is marked as "edited"
7. Verify audio time syncs with active segment highlight

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "test(e2e): verify transcript editor functionality"
```

---

## Summary

Phase 4 adds transcript editing capabilities:
1. **Segment update API** - PATCH endpoint for editing segment text/speaker
2. **Audio streaming** - Stream audio files for playback
3. **AudioPlayer component** - Play/pause, seek, playback speed
4. **EditableSegment component** - Click-to-edit segments with save
5. **Integrated TranscriptPage** - Audio synced with segment highlighting

After Phase 4, users can:
- Play audio and see which segment is currently active
- Click timestamps to jump to specific times
- Click segment text to edit inline
- Adjust playback speed for transcription review
