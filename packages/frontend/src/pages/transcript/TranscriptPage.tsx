import { useCallback, useEffect, useState } from 'react';
import { api, type TranscriptWithSegments } from '@/lib/api';
import { SegmentList } from '@/components/transcript/SegmentList';

interface TranscriptPageProps {
  recordingId: string;
  onBack: () => void;
}

export function TranscriptPage({ recordingId, onBack }: TranscriptPageProps) {
  const [transcript, setTranscript] = useState<TranscriptWithSegments | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTranscript = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // First get transcript by recording ID, which returns TranscriptWithSegments
      const transcriptData = await api.transcripts.byRecording(recordingId);
      setTranscript(transcriptData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transcript');
    } finally {
      setIsLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    loadTranscript();
  }, [loadTranscript]);

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Back button */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to Recordings
        </button>

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
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        {/* Back button */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to Recordings
        </button>

        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <svg
            className="h-12 w-12 text-destructive mx-auto mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-destructive mb-2">
            Failed to Load Transcript
          </h3>
          <p className="text-sm text-destructive/80">{error}</p>
          <button
            onClick={loadTranscript}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // No transcript found
  if (!transcript) {
    return (
      <div className="space-y-6">
        {/* Back button */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to Recordings
        </button>

        <div className="text-center py-12">
          <p className="text-muted-foreground">No transcript found for this recording.</p>
        </div>
      </div>
    );
  }

  // Transcript loaded successfully
  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        Back to Recordings
      </button>

      {/* Transcript info header */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Transcript Details
        </h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {transcript.language && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Language:</span>
              <span className="font-medium text-foreground">
                {transcript.language}
              </span>
            </div>
          )}
          {transcript.word_count !== null && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Words:</span>
              <span className="font-medium text-foreground">
                {transcript.word_count.toLocaleString()}
              </span>
            </div>
          )}
          {transcript.model_used && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Model:</span>
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                {transcript.model_used}
              </span>
            </div>
          )}
          {transcript.confidence_avg !== null && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Confidence:</span>
              <span className="font-medium text-foreground">
                {(transcript.confidence_avg * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Segments list */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">
          {transcript.segments.length} segment{transcript.segments.length !== 1 ? 's' : ''}
        </h3>
        <SegmentList segments={transcript.segments} transcriptId={transcript.id} />
      </div>
    </div>
  );
}
