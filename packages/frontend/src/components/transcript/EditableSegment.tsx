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
  const segmentRef = useRef<HTMLDivElement>(null);

  // Update local text when segment changes externally
  useEffect(() => {
    setText(segment.text);
  }, [segment.text]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(text.length, text.length);
    }
  }, [isEditing, text.length]);

  // Scroll active segment into view
  useEffect(() => {
    if (isActive && segmentRef.current) {
      segmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [isActive]);

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
      setText(segment.text); // Revert on error
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
    // Shift+Enter allows multiline editing
  };

  return (
    <div
      ref={segmentRef}
      className={`flex gap-3 p-3 rounded-lg border transition-all ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 shadow-sm'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800'
      }`}
    >
      {/* Timestamp - clickable to seek */}
      <button
        onClick={() => onSeek(segment.start_time)}
        className="flex-shrink-0 w-14 text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
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
            className="w-full p-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
            rows={Math.max(2, text.split('\n').length)}
          />
        ) : (
          <p
            onClick={() => setIsEditing(true)}
            className={`text-sm leading-relaxed cursor-text hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded p-1 -m-1 ${
              segment.edited ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'
            }`}
            title="Click to edit"
          >
            {segment.text}
            {segment.edited && (
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-500">(edited)</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
