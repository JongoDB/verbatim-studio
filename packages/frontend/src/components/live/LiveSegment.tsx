import { useState, useRef, useEffect } from 'react';
import type { TranscriptSegment } from '@/hooks/useLiveTranscription';
import { formatDuration } from '@/lib/utils';

interface LiveSegmentProps {
  segment: TranscriptSegment;
  onEditText: (index: number, newText: string) => void;
  index: number;
  showTimestamps: boolean;
  showConfidence: boolean;
}

export function LiveSegment({ segment, onEditText, index, showTimestamps, showConfidence }: LiveSegmentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(segment.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync editValue when segment text changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(segment.text);
    }
  }, [segment.text, isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== segment.text) {
      onEditText(index, trimmed);
    } else {
      setEditValue(segment.text);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(segment.text);
      setIsEditing(false);
    }
  };

  // Confidence color for word-level highlighting
  const getConfidenceColor = (confidence: number | null | undefined) => {
    if (confidence == null) return '';
    if (confidence >= 0.9) return '';
    if (confidence >= 0.7) return 'bg-yellow-100 dark:bg-yellow-900/30';
    return 'bg-red-100 dark:bg-red-900/30';
  };

  return (
    <div
      className={`group flex gap-2 py-1.5 px-2 rounded-md transition-colors ${
        isEditing ? 'bg-purple-50 dark:bg-purple-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
      } ${segment.edited ? 'border-l-2 border-purple-400' : ''}`}
    >
      {/* Timestamp */}
      {showTimestamps && (
        <span className="text-xs text-gray-400 dark:text-gray-500 font-mono shrink-0 pt-0.5 w-10">
          {formatDuration(segment.start, false)}
        </span>
      )}

      {/* Speaker badge */}
      {segment.speaker && (
        <span className="text-xs font-medium text-purple-600 dark:text-purple-400 shrink-0 pt-0.5 min-w-[60px]">
          {segment.speaker}
        </span>
      )}

      {/* Text / Edit area */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <textarea
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            rows={2}
            className="w-full text-sm bg-white dark:bg-gray-900 border border-purple-300 dark:border-purple-700 rounded px-2 py-1 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
          />
        ) : (
          <p
            onClick={() => setIsEditing(true)}
            className="text-sm text-gray-900 dark:text-gray-100 cursor-text leading-relaxed"
            title="Click to edit"
          >
            {showConfidence && segment.words ? (
              segment.words.map((w, wi) => (
                <span
                  key={wi}
                  className={`${getConfidenceColor(w.confidence)} rounded-sm`}
                  title={w.confidence != null ? `Confidence: ${Math.round(w.confidence * 100)}%` : undefined}
                >
                  {w.word}
                </span>
              ))
            ) : (
              segment.text
            )}
          </p>
        )}
      </div>

      {/* Edit indicator (pencil icon on hover) */}
      {!isEditing && (
        <button
          onClick={() => setIsEditing(true)}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-opacity shrink-0 pt-0.5"
          title="Edit segment"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      )}
    </div>
  );
}
