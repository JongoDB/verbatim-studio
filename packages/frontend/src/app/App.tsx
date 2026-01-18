import { useCallback, useEffect, useState } from 'react';
import { api, type ApiInfo, type HealthStatus, type GlobalSearchResult } from '@/lib/api';
import { RecordingsPage } from '@/pages/recordings/RecordingsPage';
import { TranscriptPage } from '@/pages/transcript/TranscriptPage';
import { SearchBox } from '@/components/search/SearchBox';

type NavigationState =
  | { type: 'recordings' }
  | { type: 'transcript'; recordingId: string };

export function App() {
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [navigation, setNavigation] = useState<NavigationState>({ type: 'recordings' });

  const handleViewTranscript = useCallback((recordingId: string) => {
    setNavigation({ type: 'transcript', recordingId });
  }, []);

  const handleBackToRecordings = useCallback(() => {
    setNavigation({ type: 'recordings' });
  }, []);

  const handleSearchResult = useCallback((result: GlobalSearchResult) => {
    // Navigate to the recording's transcript
    setNavigation({ type: 'transcript', recordingId: result.recording_id });
  }, []);

  useEffect(() => {
    async function checkBackend() {
      try {
        const [info, healthStatus] = await Promise.all([
          api.info(),
          api.health.ready(),
        ]);
        setApiInfo(info);
        setHealth(healthStatus);
        setError(null);
        setIsConnecting(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to backend');
        setIsConnecting(false);
      }
    }

    checkBackend();
    const interval = setInterval(checkBackend, 15000);
    return () => clearInterval(interval);
  }, []);

  // Show loading state while connecting
  if (isConnecting) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <svg
            className="h-12 w-12 animate-spin text-primary mx-auto"
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
          <p className="text-muted-foreground">Connecting to backend...</p>
        </div>
      </div>
    );
  }

  // Show error state if connection failed
  if (error && !apiInfo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md p-6">
          <div className="rounded-full bg-destructive/10 p-4 w-16 h-16 mx-auto flex items-center justify-center">
            <svg
              className="h-8 w-8 text-destructive"
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
          </div>
          <h1 className="text-xl font-semibold text-foreground">Connection Error</h1>
          <p className="text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground">
            Make sure the backend is running on port 8000
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex-shrink-0">
            <h1 className="text-xl font-bold text-foreground">Verbatim Studio</h1>
            <p className="text-sm text-muted-foreground">
              Privacy-first transcription for professionals
            </p>
          </div>
          <div className="flex-1 max-w-md">
            <SearchBox onResultClick={handleSearchResult} />
          </div>
          <div className="flex items-center gap-4 text-sm flex-shrink-0">
            {apiInfo && (
              <span className="text-muted-foreground font-mono">
                v{apiInfo.version}
              </span>
            )}
            {health && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  health.status === 'ready'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    health.status === 'ready' ? 'bg-green-500' : 'bg-yellow-500'
                  }`}
                />
                {health.status === 'ready' ? 'Connected' : 'Connecting'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {navigation.type === 'recordings' ? (
          <RecordingsPage onViewTranscript={handleViewTranscript} />
        ) : (
          <TranscriptPage
            recordingId={navigation.recordingId}
            onBack={handleBackToRecordings}
          />
        )}
      </main>
    </div>
  );
}
