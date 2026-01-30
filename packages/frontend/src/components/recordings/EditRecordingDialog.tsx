import { useState, useRef, useEffect } from 'react';
import { api, type Recording } from '@/lib/api';

interface EditRecordingDialogProps {
  isOpen: boolean;
  recording: Recording | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditRecordingDialog({
  isOpen,
  recording,
  onClose,
  onSaved,
}: EditRecordingDialogProps) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Load recording data when dialog opens
  useEffect(() => {
    if (isOpen && recording) {
      setTitle(recording.title);
      setError(null);
      setSaving(false);
    }
  }, [isOpen, recording]);

  // Focus title input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.select(), 50);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !saving) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, saving, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node) && !saving) {
      onClose();
    }
  };

  const handleSave = async () => {
    if (!recording) return;

    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (trimmed !== recording.title) {
        await api.recordings.update(recording.id, { title: trimmed });
      }

      onSaved();
      onClose();
    } catch {
      setError('Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !recording) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit Recording</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="edit-title" className="block text-sm font-medium text-foreground mb-1">
              Title
            </label>
            <input
              ref={titleRef}
              id="edit-title"
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              disabled={saving}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
