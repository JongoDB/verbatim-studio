import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Recording } from '@/lib/api';
import { UploadDropzone } from '@/components/recordings/UploadDropzone';
import { RecordingCard } from '@/components/recordings/RecordingCard';
import { RecordingsTable } from '@/components/recordings/RecordingsTable';
import { RecordingFilters, type FilterState, type ViewMode } from '@/components/recordings/RecordingFilters';
import { TranscribeDialog } from '@/components/recordings/TranscribeDialog';
import { EditRecordingDialog } from '@/components/recordings/EditRecordingDialog';
import { AudioRecorder } from '@/components/recordings/AudioRecorder';
import { RecordingSetupPanel, type RecordingSettings } from '@/components/recordings/RecordingSetupPanel';
import { ProjectSelector } from '@/components/projects/ProjectSelector';

interface RecordingsPageProps {
  onViewTranscript: (recordingId: string) => void;
}

const STORAGE_KEY = 'verbatim-recording-filters';
const VIEW_MODE_KEY = 'verbatim-view-mode';

const DEFAULT_FILTERS: FilterState = {
  search: '',
  status: '',
  sortBy: 'created_at',
  sortOrder: 'desc',
  dateFrom: '',
  dateTo: '',
  tagIds: [],
  speaker: '',
};

function filtersFromUrlParams(): Partial<FilterState> {
  const params = new URLSearchParams(window.location.search);
  const result: Partial<FilterState> = {};

  if (params.has('search')) result.search = params.get('search')!;
  if (params.has('status')) result.status = params.get('status')!;
  if (params.has('sortBy')) result.sortBy = params.get('sortBy') as FilterState['sortBy'];
  if (params.has('sortOrder')) result.sortOrder = params.get('sortOrder') as 'asc' | 'desc';
  if (params.has('dateFrom')) result.dateFrom = params.get('dateFrom')!;
  if (params.has('dateTo')) result.dateTo = params.get('dateTo')!;
  if (params.has('tagIds')) result.tagIds = params.get('tagIds')!.split(',').filter(Boolean);
  if (params.has('speaker')) result.speaker = params.get('speaker')!;

  return result;
}

function filtersToUrlParams(filters: FilterState): string {
  const params = new URLSearchParams();

  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.sortBy !== 'created_at') params.set('sortBy', filters.sortBy);
  if (filters.sortOrder !== 'desc') params.set('sortOrder', filters.sortOrder);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.tagIds.length > 0) params.set('tagIds', filters.tagIds.join(','));
  if (filters.speaker) params.set('speaker', filters.speaker);

  return params.toString();
}

function loadSavedFilters(): FilterState {
  // URL params take priority, then localStorage, then defaults
  const urlOverrides = filtersFromUrlParams();
  if (Object.keys(urlOverrides).length > 0) {
    return { ...DEFAULT_FILTERS, ...urlOverrides };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_FILTERS;
}

function loadSavedViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === 'grid' || saved === 'list') return saved;
  } catch {
    // ignore
  }
  return 'grid';
}

export function RecordingsPage({ onViewTranscript }: RecordingsPageProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [totalRecordings, setTotalRecordings] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(loadSavedFilters);
  const [viewMode, setViewMode] = useState<ViewMode>(loadSavedViewMode);
  const [transcribeDialogRecording, setTranscribeDialogRecording] = useState<Recording | null>(null);
  const [editDialogRecording, setEditDialogRecording] = useState<Recording | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<'none' | 'setup' | 'recording'>('none');
  const [recordingSettings, setRecordingSettings] = useState<RecordingSettings | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const response = await api.recordings.list({
        search: filters.search || undefined,
        status: filters.status || undefined,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        projectId: selectedProjectId || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
        speaker: filters.speaker || undefined,
      });
      setRecordings(response.items);
      setTotalRecordings(response.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recordings');
    } finally {
      setIsLoading(false);
    }
  }, [filters, selectedProjectId]);

  // Initial load and polling
  useEffect(() => {
    loadRecordings();

    // Poll every 5 seconds for updates
    const interval = setInterval(loadRecordings, 5000);
    return () => clearInterval(interval);
  }, [loadRecordings]);

  // Poll job progress for processing recordings
  useEffect(() => {
    const processingIds = recordings
      .filter((r) => r.status === 'processing')
      .map((r) => r.id);

    if (processingIds.length === 0) {
      setJobProgress({});
      return;
    }

    let cancelled = false;

    const pollProgress = async () => {
      try {
        const response = await api.jobs.list('running');
        if (cancelled) return;
        const progressMap: Record<string, number> = {};
        for (const job of response.items) {
          const recId = (job.payload as Record<string, unknown>)?.recording_id;
          if (typeof recId === 'string' && processingIds.includes(recId)) {
            progressMap[recId] = job.progress;
          }
        }
        // Also check queued jobs (they have 0 progress but should show "Starting...")
        const queuedResponse = await api.jobs.list('queued');
        if (cancelled) return;
        for (const job of queuedResponse.items) {
          const recId = (job.payload as Record<string, unknown>)?.recording_id;
          if (typeof recId === 'string' && processingIds.includes(recId) && !(recId in progressMap)) {
            progressMap[recId] = 0;
          }
        }
        setJobProgress(progressMap);
      } catch {
        // Ignore progress polling errors
      }
    };

    pollProgress();
    const interval = setInterval(pollProgress, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [recordings]);

  // Sync filters to URL and localStorage
  useEffect(() => {
    const queryString = filtersToUrlParams(filters);
    const newUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;
    window.history.replaceState(null, '', newUrl);

    // Persist to localStorage (exclude search to avoid stale text)
    const { search: _, ...persistable } = filters;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  }, [filters]);

  // Persist view mode
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  const handleUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setError(null);

      try {
        await api.recordings.upload(file);
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload file');
      } finally {
        setIsUploading(false);
      }
    },
    [loadRecordings]
  );

  const handleBatchImport = useCallback(
    async (files: FileList) => {
      setIsUploading(true);
      setError(null);

      try {
        for (const file of Array.from(files)) {
          await api.recordings.upload(file);
        }
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import files');
      } finally {
        setIsUploading(false);
      }
    },
    [loadRecordings]
  );

  const handleOpenTranscribeDialog = useCallback((recording: Recording) => {
    setTranscribeDialogRecording(recording);
  }, []);

  const handleCloseTranscribeDialog = useCallback(() => {
    setTranscribeDialogRecording(null);
  }, []);

  const handleTranscribe = useCallback(
    async (language: string | undefined) => {
      if (!transcribeDialogRecording) return;

      try {
        await api.recordings.transcribe(transcribeDialogRecording.id, language);
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start transcription');
      }
    },
    [loadRecordings, transcribeDialogRecording]
  );

  const handleDelete = useCallback(
    async (recordingId: string) => {
      try {
        await api.recordings.delete(recordingId);
        setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete recording');
      }
    },
    []
  );

  const handleCancel = useCallback(
    async (recordingId: string) => {
      try {
        await api.recordings.cancel(recordingId);
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to cancel transcription');
      }
    },
    [loadRecordings]
  );

  const handleRetry = useCallback(
    async (recordingId: string) => {
      try {
        await api.recordings.retry(recordingId);
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to retry transcription');
      }
    },
    [loadRecordings]
  );

  const handleView = useCallback((recordingId: string) => {
    onViewTranscript(recordingId);
  }, [onViewTranscript]);

  const handleRecordingComplete = useCallback(
    async (blob: Blob, filename: string) => {
      setRecordingPhase('none');
      setIsUploading(true);
      setError(null);

      try {
        const file = new File([blob], filename, { type: blob.type });
        const meta = recordingSettings?.metadata;
        await api.recordings.upload(file, {
          title: meta?.title || undefined,
          description: meta?.description || undefined,
          tags: meta?.tags?.length ? meta.tags : undefined,
          participants: meta?.participants?.length ? meta.participants : undefined,
          location: meta?.location || undefined,
          recordedDate: meta?.recordedDate || undefined,
          quality: recordingSettings?.quality,
        });
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload recording');
      } finally {
        setIsUploading(false);
        setRecordingSettings(null);
      }
    },
    [loadRecordings, recordingSettings]
  );

  const handleRecordingCancel = useCallback(() => {
    setRecordingPhase('none');
    setRecordingSettings(null);
  }, []);

  const handleFiltersChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  const handleSortChange = useCallback(
    (sortBy: 'created_at' | 'title' | 'duration', sortOrder: 'asc' | 'desc') => {
      setFilters(prev => ({ ...prev, sortBy, sortOrder }));
    },
    []
  );

  const handleEdit = useCallback((recording: Recording) => {
    setEditDialogRecording(recording);
  }, []);

  const handleEditSaved = useCallback(() => {
    loadRecordings();
  }, [loadRecordings]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg
          className="h-8 w-8 animate-spin text-primary"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload and Record Section */}
      <div className="grid gap-4 md:grid-cols-2">
        <UploadDropzone onUpload={handleUpload} isUploading={isUploading} />

        {/* Record Button, Setup Panel, or Recorder */}
        {recordingPhase === 'recording' ? (
          <AudioRecorder
            onRecordingComplete={handleRecordingComplete}
            onCancel={handleRecordingCancel}
            audioBitsPerSecond={recordingSettings?.audioBitsPerSecond}
            autoStart
          />
        ) : recordingPhase === 'setup' ? (
          <RecordingSetupPanel
            onStartRecording={(settings) => {
              setRecordingSettings(settings);
              setRecordingPhase('recording');
            }}
            onCancel={handleRecordingCancel}
          />
        ) : (
          <button
            onClick={() => setRecordingPhase('setup')}
            disabled={isUploading}
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-8 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-600 dark:text-red-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Record Audio
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Click to start recording from your microphone
              </p>
            </div>
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Project Selector, Filters, and Import */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <ProjectSelector
            selectedProjectId={selectedProjectId}
            onProjectChange={setSelectedProjectId}
          />
          {/* Batch Import */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleBatchImport(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import Files
          </button>
        </div>
        <RecordingFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          totalResults={totalRecordings}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />
      </div>

      {recordings.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {filters.search || filters.status || filters.dateFrom || filters.dateTo || filters.tagIds.length > 0 || filters.speaker
              ? 'No recordings match your filters.'
              : 'No recordings yet. Upload a file to get started.'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recordings.map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              onTranscribe={() => handleOpenTranscribeDialog(recording)}
              onDelete={() => handleDelete(recording.id)}
              onView={() => handleView(recording.id)}
              onCancel={() => handleCancel(recording.id)}
              onRetry={() => handleRetry(recording.id)}
              onEdit={() => handleEdit(recording)}
              progress={jobProgress[recording.id]}
            />
          ))}
        </div>
      ) : (
        <RecordingsTable
          recordings={recordings}
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder}
          onSortChange={handleSortChange}
          onTranscribe={handleOpenTranscribeDialog}
          onDelete={(id) => handleDelete(id)}
          onView={(id) => handleView(id)}
          onCancel={(id) => handleCancel(id)}
          onRetry={(id) => handleRetry(id)}
          onEdit={handleEdit}
          jobProgress={jobProgress}
        />
      )}

      {/* Transcribe Dialog */}
      <TranscribeDialog
        isOpen={transcribeDialogRecording !== null}
        onClose={handleCloseTranscribeDialog}
        onTranscribe={handleTranscribe}
        recordingTitle={transcribeDialogRecording?.title ?? ''}
      />

      {/* Edit Recording Dialog */}
      <EditRecordingDialog
        isOpen={editDialogRecording !== null}
        recording={editDialogRecording}
        onClose={() => setEditDialogRecording(null)}
        onSaved={handleEditSaved}
      />
    </div>
  );
}
