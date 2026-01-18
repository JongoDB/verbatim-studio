import { useEffect, useState } from 'react';
import type { Segment, Speaker } from '@/lib/api';
import { api } from '@/lib/api';
import { SpeakerBadge } from './SpeakerBadge';

interface SegmentListProps {
  segments: Segment[];
  transcriptId: string;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
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
      <div className="text-center py-8">
        <p className="text-muted-foreground">No segments found.</p>
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
            className="flex gap-3 p-3 rounded-lg bg-card border hover:border-primary/50 transition-colors"
          >
            {/* Timestamp */}
            <div className="flex-shrink-0 w-14 text-sm font-mono text-muted-foreground">
              {formatTime(segment.start_time)}
            </div>

            {/* Speaker badge */}
            {speaker && (
              <div className="flex-shrink-0">
                <SpeakerBadge
                  speaker={speaker}
                  speakerIndex={speakerIndex}
                  onUpdate={handleSpeakerUpdate}
                />
              </div>
            )}

            {/* Fallback for segments with speaker label but no Speaker record */}
            {segment.speaker && !speaker && (
              <div className="flex-shrink-0">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {segment.speaker}
                </span>
              </div>
            )}

            {/* Segment text */}
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm text-foreground leading-relaxed ${
                  segment.edited ? 'italic' : ''
                }`}
              >
                {segment.text}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
