import { cn } from '@/lib/utils';
import type { Recording, Tag, Project } from '@/lib/api';

interface RecordingCardProps {
  recording: Recording;
  onTranscribe: () => void;
  onDelete: () => void;
  onView: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  progress?: number;
  isSelected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  /** All available tags for display */
  allTags?: Tag[];
  /** All available projects for display */
  allProjects?: Project[];
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return 'Unknown size';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isVideo(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith('video/');
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
  onEdit,
  progress,
  isSelected,
  onSelectChange,
  allTags = [],
  allProjects = [],
}: RecordingCardProps) {
  const status = statusConfig[recording.status] || statusConfig.pending;

  // Get tags for this recording
  const recordingTags = allTags.filter(t => recording.tag_ids?.includes(t.id));

  // Get projects for this recording
  const recordingProjects = allProjects.filter(p => recording.project_ids?.includes(p.id));

  // Clickable: completed -> view, pending -> transcribe
  const isClickable = recording.status === 'completed' || recording.status === 'pending';
  const handleCardClick = () => {
    if (recording.status === 'completed') {
      onView();
    } else if (recording.status === 'pending') {
      onTranscribe();
    }
  };

  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-sm", isSelected && "ring-2 ring-primary")}>
      {/* Clickable header area - clicking goes to transcript for completed, transcribe for pending */}
      <div
        className={cn(
          "flex items-start justify-between gap-4",
          isClickable && "cursor-pointer hover:opacity-80 transition-opacity"
        )}
        onClick={isClickable ? handleCardClick : undefined}
      >
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          {onSelectChange && (
            <input
              type="checkbox"
              checked={isSelected ?? false}
              onChange={(e) => onSelectChange(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 mt-1 rounded border-gray-300 text-primary focus:ring-primary shrink-0"
            />
          )}
          {isVideo(recording.mime_type) ? (
            <svg className="w-5 h-5 shrink-0 mt-0.5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0 mt-0.5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
          <div className="min-w-0">
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
        <span>{formatDuration(recording.duration_seconds)}</span>
        <span>{formatFileSize(recording.file_size)}</span>
        <span>{formatDate(recording.created_at)}</span>
      </div>

      {/* Template Type Badge */}
      {recording.template && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
            <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {recording.template.name}
          </span>
        </div>
      )}

      {/* Tags */}
      {recordingTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {recordingTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary"
            >
              {tag.color && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
              )}
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Projects */}
      {recordingProjects.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {recordingProjects.map((project) => (
            <span
              key={project.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
            >
              <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              {project.name}
            </span>
          ))}
        </div>
      )}

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
        {onEdit && (
          <button
            onClick={onEdit}
            className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Edit recording"
          >
            <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
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
