import { useCallback, useEffect, useState } from 'react';
import { api, type Recording } from '@/lib/api';
import { UploadDropzone } from '@/components/recordings/UploadDropzone';
import { RecordingCard } from '@/components/recordings/RecordingCard';

export function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const response = await api.recordings.list();
      setRecordings(response.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recordings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    loadRecordings();

    // Poll every 5 seconds for updates
    const interval = setInterval(loadRecordings, 5000);
    return () => clearInterval(interval);
  }, [loadRecordings]);

  const handleUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setError(null);

      try {
        await api.recordings.upload(file);
        // Reload recordings to show the new one
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload file');
      } finally {
        setIsUploading(false);
      }
    },
    [loadRecordings]
  );

  const handleTranscribe = useCallback(
    async (recordingId: string) => {
      try {
        await api.recordings.transcribe(recordingId);
        // Reload to update status
        await loadRecordings();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start transcription');
      }
    },
    [loadRecordings]
  );

  const handleDelete = useCallback(
    async (recordingId: string) => {
      try {
        await api.recordings.delete(recordingId);
        // Remove from local state immediately
        setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete recording');
      }
    },
    []
  );

  const handleView = useCallback((recordingId: string) => {
    // TODO: Navigate to transcript view or open modal
    console.log('View transcript for recording:', recordingId);
    alert(`Transcript viewer coming soon for recording: ${recordingId}`);
  }, []);

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
      <UploadDropzone onUpload={handleUpload} isUploading={isUploading} />

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {recordings.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No recordings yet. Upload a file to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recordings.map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              onTranscribe={() => handleTranscribe(recording.id)}
              onDelete={() => handleDelete(recording.id)}
              onView={() => handleView(recording.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
