import { cn } from '@/lib/utils';
import type { Recording, Tag, Project } from '@/lib/api';

type SortKey = 'created_at' | 'title' | 'duration';

interface RecordingsTableProps {
  recordings: Recording[];
  sortBy: SortKey;
  sortOrder: 'asc' | 'desc';
  onSortChange: (sortBy: SortKey, sortOrder: 'asc' | 'desc') => void;
  onTranscribe: (recording: Recording) => void;
  onDelete: (recordingId: string) => void;
  onView: (recordingId: string) => void;
  onCancel: (recordingId: string) => void;
  onRetry: (recordingId: string) => void;
  onEdit: (recording: Recording) => void;
  jobProgress: Record<string, number>;
  selectedIds: Set<string>;
  onSelectRecording: (id: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  allTags?: Tag[];
  allProjects?: Project[];
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return 'Unknown';
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

const COLUMNS: Array<{
  key: string;
  label: string;
  sortKey?: SortKey;
  className: string;
  headerClass?: string;
}> = [
  { key: 'checkbox', label: '', className: 'w-10', headerClass: 'w-10' },
  { key: 'title', label: 'Title', sortKey: 'title', className: '', headerClass: '' },
  { key: 'duration', label: 'Duration', sortKey: 'duration', className: 'hidden sm:table-cell w-24', headerClass: 'hidden sm:table-cell w-24' },
  { key: 'size', label: 'Size', className: 'hidden md:table-cell w-24', headerClass: 'hidden md:table-cell w-24' },
  { key: 'status', label: 'Status', className: 'w-28', headerClass: 'w-28' },
  { key: 'created_at', label: 'Date', sortKey: 'created_at', className: 'hidden lg:table-cell w-44', headerClass: 'hidden lg:table-cell w-44' },
  { key: 'actions', label: '', className: '', headerClass: '' },
];

const TOTAL_COLUMNS = COLUMNS.length;

function SortIcon({ direction }: { direction: 'asc' | 'desc' }) {
  return (
    <svg
      className="w-3.5 h-3.5 inline-block ml-1"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      {direction === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      )}
    </svg>
  );
}

export function RecordingsTable({
  recordings,
  sortBy,
  sortOrder,
  onSortChange,
  onTranscribe,
  onDelete,
  onView,
  onCancel,
  onRetry,
  onEdit,
  jobProgress,
  selectedIds,
  onSelectRecording,
  onSelectAll,
  allTags = [],
  allProjects = [],
}: RecordingsTableProps) {
  const handleHeaderClick = (key: SortKey) => {
    if (sortBy === key) {
      onSortChange(key, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(key, 'asc');
    }
  };

  const allSelected = recordings.length > 0 && recordings.every(r => selectedIds.has(r.id));
  const someSelected = recordings.some(r => selectedIds.has(r.id)) && !allSelected;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider',
                  col.headerClass
                )}
              >
                {col.key === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) => onSelectAll(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                ) : col.sortKey ? (
                  <button
                    onClick={() => handleHeaderClick(col.sortKey!)}
                    className="inline-flex items-center hover:text-foreground transition-colors"
                  >
                    {col.label}
                    {sortBy === col.sortKey && <SortIcon direction={sortOrder} />}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recordings.map((recording) => {
            const status = statusConfig[recording.status] || statusConfig.pending;
            const progress = jobProgress[recording.id];

            return (
              <RecordingRow
                key={recording.id}
                recording={recording}
                status={status}
                progress={progress}
                onTranscribe={onTranscribe}
                onDelete={onDelete}
                onView={onView}
                onCancel={onCancel}
                onRetry={onRetry}
                onEdit={onEdit}
                isSelected={selectedIds.has(recording.id)}
                onSelectChange={(selected) => onSelectRecording(recording.id, selected)}
                allTags={allTags}
                allProjects={allProjects}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecordingRow({
  recording,
  status,
  progress,
  onTranscribe,
  onDelete,
  onView,
  onCancel,
  onRetry,
  onEdit,
  isSelected,
  onSelectChange,
  allTags,
  allProjects,
}: {
  recording: Recording;
  status: { label: string; className: string };
  progress?: number;
  onTranscribe: (recording: Recording) => void;
  onDelete: (recordingId: string) => void;
  onView: (recordingId: string) => void;
  onCancel: (recordingId: string) => void;
  onRetry: (recordingId: string) => void;
  onEdit: (recording: Recording) => void;
  isSelected: boolean;
  onSelectChange: (selected: boolean) => void;
  allTags: Tag[];
  allProjects: Project[];
}) {
  // Get tags and projects for this recording
  const recordingTags = allTags.filter(t => recording.tag_ids?.includes(t.id));
  const recordingProjects = allProjects.filter(p => recording.project_ids?.includes(p.id));
  return (
    <>
      <tr className={cn("hover:bg-muted/30 transition-colors border-b border-border", isSelected && "bg-primary/5")}>
        {/* Checkbox */}
        <td className="px-3 py-2.5 w-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelectChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
        </td>
        {/* Title */}
        <td className="px-3 py-2.5 min-w-0">
          <div className="flex items-center gap-2">
            {isVideo(recording.mime_type) ? (
              <svg className="w-4 h-4 shrink-0 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 shrink-0 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate" title={recording.title}>
                {recording.title}
              </h3>
              <p className="text-xs text-muted-foreground truncate" title={recording.file_name}>
                {recording.file_name}
              </p>
              {/* Tags and Projects */}
              {(recordingTags.length > 0 || recordingProjects.length > 0) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {recordingTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary"
                    >
                      {tag.color && (
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                      )}
                      {tag.name}
                    </span>
                  ))}
                  {recordingProjects.map((project) => (
                    <span
                      key={project.id}
                      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
                    >
                      <svg className="w-2.5 h-2.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      {project.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </td>

        {/* Duration */}
        <td className="hidden sm:table-cell px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
          {formatDuration(recording.duration_seconds)}
        </td>

        {/* Size */}
        <td className="hidden md:table-cell px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
          {formatFileSize(recording.file_size)}
        </td>

        {/* Status */}
        <td className="px-3 py-2.5">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
              status.className
            )}
          >
            {status.label}
          </span>
        </td>

        {/* Date */}
        <td className="hidden lg:table-cell px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(recording.created_at)}
        </td>

        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 justify-end">
            {recording.status === 'pending' && (
              <button
                onClick={() => onTranscribe(recording)}
                className="inline-flex items-center justify-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Transcribe
              </button>
            )}
            {recording.status === 'processing' && (
              <button
                onClick={() => onCancel(recording.id)}
                className="inline-flex items-center justify-center rounded-md border border-orange-500/50 px-2.5 py-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors"
              >
                Cancel
              </button>
            )}
            {recording.status === 'completed' && (
              <button
                onClick={() => onView(recording.id)}
                className="inline-flex items-center justify-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                View
              </button>
            )}
            {(recording.status === 'failed' || recording.status === 'cancelled') && (
              <button
                onClick={() => onRetry(recording.id)}
                className="inline-flex items-center justify-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Retry
              </button>
            )}
            <button
              onClick={() => onEdit(recording)}
              className="inline-flex items-center justify-center rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Edit recording"
            >
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(recording.id)}
              className="inline-flex items-center justify-center rounded-md border border-destructive/50 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>

      {/* Progress bar row for processing recordings */}
      {recording.status === 'processing' && (
        <tr className="border-b border-border">
          <td colSpan={TOTAL_COLUMNS} className="px-3 pb-2 pt-0">
            <div className="h-1 w-full rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-1 rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${Math.max(progress ?? 0, 2)}%` }}
              />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {progress != null && progress > 0 ? `${Math.round(progress)}%` : 'Starting...'}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
