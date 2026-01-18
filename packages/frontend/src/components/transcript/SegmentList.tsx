import type { Segment } from '@/lib/api';

interface SegmentListProps {
  segments: Segment[];
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function SegmentList({ segments }: SegmentListProps) {
  if (segments.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No segments found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {segments.map((segment) => (
        <div
          key={segment.id}
          className="flex gap-3 p-3 rounded-lg bg-card border hover:border-primary/50 transition-colors"
        >
          {/* Timestamp */}
          <div className="flex-shrink-0 w-14 text-sm font-mono text-muted-foreground">
            {formatTime(segment.start_time)}
          </div>

          {/* Speaker badge */}
          {segment.speaker && (
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
      ))}
    </div>
  );
}
