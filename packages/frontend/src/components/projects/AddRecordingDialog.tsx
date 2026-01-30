import { useState, useEffect } from 'react';
import { api, type Recording } from '@/lib/api';

interface AddRecordingDialogProps {
  projectId: string;
  existingRecordingIds: string[];
  open: boolean;
  onClose: () => void;
  onRecordingsAdded: () => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AddRecordingDialog({
  projectId,
  existingRecordingIds,
  open,
  onClose,
  onRecordingsAdded,
}: AddRecordingDialogProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      loadRecordings();
    }
  }, [open]);

  const loadRecordings = async () => {
    try {
      setLoading(true);
      const response = await api.recordings.list({ pageSize: 1000 });
      setRecordings(response.items);
      // Pre-select existing recordings
      setSelectedIds(new Set(existingRecordingIds));
    } catch (error) {
      console.error('Failed to load recordings:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleRecording = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(recordings.map(r => r.id)));
  };

  const clearAll = () => {
    setSelectedIds(new Set());
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const toAdd = [...selectedIds].filter(id => !existingRecordingIds.includes(id));
      const toRemove = existingRecordingIds.filter(id => !selectedIds.has(id));

      // Add new recordings
      for (const id of toAdd) {
        await api.projects.addRecording(projectId, id);
      }

      // Remove unchecked recordings
      for (const id of toRemove) {
        await api.projects.removeRecording(projectId, id);
      }

      onRecordingsAdded();
      onClose();
    } catch (error) {
      console.error('Failed to update recordings:', error);
    } finally {
      setSaving(false);
    }
  };

  const changedCount = (() => {
    const toAdd = [...selectedIds].filter(id => !existingRecordingIds.includes(id)).length;
    const toRemove = existingRecordingIds.filter(id => !selectedIds.has(id)).length;
    return toAdd + toRemove;
  })();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains('bg-black/50')) {
          onClose();
        }
      }}
    >
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Add Recordings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <button
            onClick={selectAll}
            className="px-3 py-1.5 text-xs font-medium rounded border border-border hover:bg-muted transition-colors"
          >
            Select All
          </button>
          <button
            onClick={clearAll}
            className="px-3 py-1.5 text-xs font-medium rounded border border-border hover:bg-muted transition-colors"
          >
            Clear
          </button>
          <span className="text-sm text-muted-foreground ml-auto">
            {selectedIds.size} selected
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg
                className="h-8 w-8 animate-spin text-primary"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : recordings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No recordings available
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recordings.map((recording) => (
                <label
                  key={recording.id}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(recording.id)}
                    onChange={() => toggleRecording(recording.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{recording.title}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          recording.status === 'completed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : recording.status === 'failed'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : recording.status === 'processing'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                        }`}
                      >
                        {recording.status}
                      </span>
                      <span>{formatDuration(recording.duration_seconds)}</span>
                    </div>
                  </div>
                  {existingRecordingIds.includes(recording.id) && (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      In project
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || changedCount === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : changedCount > 0 ? `Save (${changedCount} changes)` : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
