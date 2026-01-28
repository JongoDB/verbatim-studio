import { cn } from '@/lib/utils';
import type { Recording } from '@/lib/api';

interface RecordingCardProps {
  recording: Recording;
  onTranscribe: () => void;
  onDelete: () => void;
  onView: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  progress?: number;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return 'Unknown size';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  processing: {
    label: 'Processing',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  },
};

export function RecordingCard({
  recording,
  onTranscribe,
  onDelete,
  onView,
  onCancel,
  onRetry,
  progress,
}: RecordingCardProps) {
  const status = statusConfig[recording.status] || statusConfig.pending;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium truncate" title={recording.title}>
            {recording.title}
          </h3>
          <p
            className="text-sm text-muted-foreground truncate"
            title={recording.file_name}
          >
            {recording.file_name}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
            status.className
          )}
        >
          {status.label}
        </span>
      </div>

      {/* Progress bar for processing recordings */}
      {recording.status === 'processing' && (
        <div className="mt-3">
          <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${Math.max(progress ?? 0, 2)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {progress != null && progress > 0 ? `${Math.round(progress)}%` : 'Starting...'}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span>{formatFileSize(recording.file_size)}</span>
        <span>{formatDate(recording.created_at)}</span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {recording.status === 'pending' && (
          <button
            onClick={onTranscribe}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Transcribe
          </button>
        )}
        {recording.status === 'processing' && onCancel && (
          <button
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-md border border-orange-500/50 px-3 py-1.5 text-sm font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors"
          >
            Cancel
          </button>
        )}
        {recording.status === 'completed' && (
          <button
            onClick={onView}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            View Transcript
          </button>
        )}
        {(recording.status === 'failed' || recording.status === 'cancelled') && onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        )}
        <button
          onClick={onDelete}
          className="inline-flex items-center justify-center rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
