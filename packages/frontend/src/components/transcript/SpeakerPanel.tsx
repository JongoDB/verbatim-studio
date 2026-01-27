import { useState, useMemo } from 'react';
import { api, type Speaker, type Segment } from '@/lib/api';

interface SpeakerPanelProps {
  speakers: Speaker[];
  segments: Segment[];
  onSpeakerUpdate: (speaker: Speaker) => void;
  onSpeakerMerge?: (removedSpeaker: Speaker, targetSpeaker: Speaker, segmentsMoved: number) => void;
}

interface SpeakerStats {
  speaker: Speaker;
  segmentCount: number;
  totalDuration: number;
  wordCount: number;
  percentage: number;
}

const SPEAKER_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export function SpeakerPanel({
  speakers,
  segments,
  onSpeakerUpdate,
  onSpeakerMerge,
}: SpeakerPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [mergingSpeakerId, setMergingSpeakerId] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Calculate speaker statistics
  const speakerStats = useMemo(() => {
    const stats = new Map<string, { segmentCount: number; totalDuration: number; wordCount: number }>();

    // Initialize stats for all speakers
    speakers.forEach((s) => {
      stats.set(s.speaker_label, { segmentCount: 0, totalDuration: 0, wordCount: 0 });
    });

    // Calculate stats from segments
    segments.forEach((segment) => {
      if (segment.speaker) {
        const existing = stats.get(segment.speaker) || { segmentCount: 0, totalDuration: 0, wordCount: 0 };
        stats.set(segment.speaker, {
          segmentCount: existing.segmentCount + 1,
          totalDuration: existing.totalDuration + (segment.end_time - segment.start_time),
          wordCount: existing.wordCount + (segment.text?.split(/\s+/).filter(Boolean).length || 0),
        });
      }
    });

    // Calculate total duration for percentages
    const totalDuration = Array.from(stats.values()).reduce((sum, s) => sum + s.totalDuration, 0);

    // Build final stats array
    const result: SpeakerStats[] = speakers.map((speaker) => {
      const s = stats.get(speaker.speaker_label) || { segmentCount: 0, totalDuration: 0, wordCount: 0 };
      return {
        speaker,
        segmentCount: s.segmentCount,
        totalDuration: s.totalDuration,
        wordCount: s.wordCount,
        percentage: totalDuration > 0 ? (s.totalDuration / totalDuration) * 100 : 0,
      };
    });

    // Sort by total duration descending
    return result.sort((a, b) => b.totalDuration - a.totalDuration);
  }, [speakers, segments]);

  const handleStartEdit = (speaker: Speaker) => {
    setEditingSpeakerId(speaker.id);
    setEditingName(speaker.speaker_name || speaker.speaker_label);
  };

  const handleCancelEdit = () => {
    setEditingSpeakerId(null);
    setEditingName('');
  };

  const handleSaveEdit = async (speaker: Speaker) => {
    if (!editingName.trim()) {
      handleCancelEdit();
      return;
    }

    setIsSaving(true);
    try {
      const updated = await api.speakers.update(speaker.id, {
        speaker_name: editingName.trim(),
      });
      onSpeakerUpdate(updated);
      setEditingSpeakerId(null);
      setEditingName('');
    } catch (err) {
      console.error('Failed to update speaker:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleColorChange = async (speaker: Speaker, color: string) => {
    try {
      const updated = await api.speakers.update(speaker.id, { color });
      onSpeakerUpdate(updated);
    } catch (err) {
      console.error('Failed to update speaker color:', err);
    }
  };

  const handleMerge = async (source: Speaker, target: Speaker, sourceSegmentCount: number) => {
    const sourceName = source.speaker_name || source.speaker_label;
    const targetName = target.speaker_name || target.speaker_label;
    const confirmed = window.confirm(
      `Merge "${sourceName}" into "${targetName}"?\n\nThis will move ${sourceSegmentCount} segment${sourceSegmentCount !== 1 ? 's' : ''} and remove "${sourceName}".`
    );
    if (!confirmed) return;

    setIsMerging(true);
    try {
      const result = await api.speakers.merge(source.id, target.id);
      setMergingSpeakerId(null);
      onSpeakerMerge?.(source, result.speaker, result.segments_moved);
    } catch (err) {
      console.error('Failed to merge speakers:', err);
    } finally {
      setIsMerging(false);
    }
  };

  if (speakers.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Speakers</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No speaker diarization available for this transcript.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
      >
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Speakers ({speakers.length})
        </h3>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
      <div className="px-4 pb-4 space-y-3">
        {speakerStats.map(({ speaker, segmentCount, totalDuration, wordCount, percentage }, index) => (
          <div
            key={speaker.id}
            className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
          >
            {/* Header row with name, color, and actions */}
            <div className="flex items-center gap-3 mb-2">
              {/* Color picker */}
              <div className="relative">
                <button
                  className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
                  style={{ backgroundColor: speaker.color || SPEAKER_COLORS[index % SPEAKER_COLORS.length] }}
                  title="Change color"
                >
                  <input
                    type="color"
                    value={speaker.color || SPEAKER_COLORS[index % SPEAKER_COLORS.length]}
                    onChange={(e) => handleColorChange(speaker, e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </button>
              </div>

              {/* Name (editable) */}
              {editingSpeakerId === speaker.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(speaker);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    className="flex-1 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                    disabled={isSaving}
                  />
                  <button
                    onClick={() => handleSaveEdit(speaker)}
                    disabled={isSaving}
                    className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleStartEdit(speaker)}
                  className="flex-1 text-left text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {speaker.speaker_name || speaker.speaker_label}
                  <span className="ml-1.5 text-gray-400">
                    <svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </span>
                </button>
              )}

              {/* Merge button (only when 2+ speakers) */}
              {speakers.length >= 2 && editingSpeakerId !== speaker.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMergingSpeakerId(mergingSpeakerId === speaker.id ? null : speaker.id);
                  }}
                  disabled={isMerging}
                  className={`p-1 rounded transition-colors ${
                    mergingSpeakerId === speaker.id
                      ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  } disabled:opacity-50`}
                  title="Merge into another speaker"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3m4-4l-4 4 4 4" />
                  </svg>
                </button>
              )}
            </div>

            {/* Merge target selector */}
            {mergingSpeakerId === speaker.id && (
              <div className="mb-2 p-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                  Merge into:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {speakerStats
                    .filter((s) => s.speaker.id !== speaker.id)
                    .map((s) => (
                      <button
                        key={s.speaker.id}
                        onClick={() => handleMerge(speaker, s.speaker, segmentCount)}
                        disabled={isMerging}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors hover:opacity-80 disabled:opacity-50"
                        style={{
                          backgroundColor: `${s.speaker.color || SPEAKER_COLORS[speakerStats.indexOf(s) % SPEAKER_COLORS.length]}15`,
                          borderColor: `${s.speaker.color || SPEAKER_COLORS[speakerStats.indexOf(s) % SPEAKER_COLORS.length]}40`,
                          color: s.speaker.color || SPEAKER_COLORS[speakerStats.indexOf(s) % SPEAKER_COLORS.length],
                        }}
                      >
                        {s.speaker.speaker_name || s.speaker.speaker_label}
                      </button>
                    ))}
                  <button
                    onClick={() => setMergingSpeakerId(null)}
                    className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Stats row */}
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span>{segmentCount} segments</span>
              <span>{formatDuration(totalDuration)}</span>
              <span>{wordCount} words</span>
            </div>

            {/* Progress bar */}
            <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${percentage}%`,
                  backgroundColor: speaker.color || SPEAKER_COLORS[index % SPEAKER_COLORS.length],
                }}
              />
            </div>
            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 text-right">
              {percentage.toFixed(1)}% of talk time
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
