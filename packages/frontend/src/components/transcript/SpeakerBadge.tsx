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
  onReassign?: (newName: string) => void;
}

export function SpeakerBadge({ speaker, speakerIndex, onUpdate, onReassign }: SpeakerBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(speaker.speaker_name || '');
  const [isLoading, setIsLoading] = useState(false);

  const color = speaker.color || DEFAULT_COLORS[speakerIndex % DEFAULT_COLORS.length];
  const displayName = speaker.speaker_name || speaker.speaker_label;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed === (speaker.speaker_name || '') || trimmed === speaker.speaker_label) {
      setIsEditing(false);
      return;
    }

    if (!trimmed) {
      setName(speaker.speaker_name || '');
      setIsEditing(false);
      return;
    }

    setIsLoading(true);
    try {
      if (onReassign) {
        // Per-segment reassignment: emit callback, let parent handle API call
        onReassign(trimmed);
        setIsEditing(false);
      } else {
        // Fallback: global rename via direct API call
        const updated = await api.speakers.update(speaker.id, {
          speaker_name: trimmed || null,
        });
        onUpdate?.(updated);
        setIsEditing(false);
      }
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
        className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
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
      title="Click to reassign speaker"
    >
      {displayName}
    </button>
  );
}
