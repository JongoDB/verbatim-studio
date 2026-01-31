import { useState, useEffect, useRef } from 'react';
import { api, type Recording } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export interface AttachedTranscript {
  id: string;
  title: string;
}

interface TranscriptPickerProps {
  attached: AttachedTranscript[];
  onAttach: (transcript: AttachedTranscript) => void;
  onDetach: (id: string) => void;
  onClose: () => void;
}

export function TranscriptPicker({ attached, onAttach, onDetach, onClose }: TranscriptPickerProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.recordings.list({ status: 'completed', pageSize: 50 })
      .then((r) => setRecordings(r.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const attachedIds = new Set(attached.map((t) => t.id));
  const filtered = recordings.filter(
    (r) => r.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = (recording: Recording) => {
    if (attachedIds.has(recording.id)) {
      onDetach(recording.id);
    } else {
      if (attached.length >= 5) {
        alert('Maximum 5 transcripts can be attached. Adding more may reduce response quality.');
        return;
      }
      onAttach({ id: recording.id, title: recording.title });
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Select transcripts"
      className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-hidden flex flex-col"
    >
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transcripts..."
          aria-label="Search transcripts"
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">No transcripts found</div>
        ) : (
          filtered.slice(0, 20).map((recording) => (
            <label
              key={recording.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={attachedIds.has(recording.id)}
                onChange={() => handleToggle(recording)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {recording.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(recording.created_at)}
                </p>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
