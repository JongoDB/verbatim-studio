import { useCallback, useEffect, useState } from 'react';
import { api, type ApiInfo, type HealthStatus, type GlobalSearchResult } from '@/lib/api';
import { RecordingsPage } from '@/pages/recordings/RecordingsPage';
import { TranscriptPage } from '@/pages/transcript/TranscriptPage';
import { SearchBox } from '@/components/search/SearchBox';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { APP_VERSION } from '@/version'; // static fallback

type NavigationState =
  | { type: 'dashboard' }
  | { type: 'recordings' }
  | { type: 'settings' }
  | { type: 'transcript'; recordingId: string; initialSeekTime?: number };

type Theme = 'light' | 'dark' | 'system';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function getEffectiveDarkMode(theme: Theme): boolean {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return theme === 'dark';
}

export function App() {
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [navigation, setNavigation] = useState<NavigationState>({ type: 'dashboard' });
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const handleViewTranscript = useCallback((recordingId: string) => {
    setNavigation({ type: 'transcript', recordingId });
  }, []);

  const handleNavigateToDashboard = useCallback(() => {
    setNavigation({ type: 'dashboard' });
  }, []);

  const handleNavigateToRecordings = useCallback(() => {
    setNavigation({ type: 'recordings' });
  }, []);

  const handleNavigateToSettings = useCallback(() => {
    setNavigation({ type: 'settings' });
  }, []);

  const handleBackToRecordings = useCallback(() => {
    setNavigation({ type: 'recordings' });
  }, []);

  const currentTab = navigation.type === 'transcript' ? 'recordings' : navigation.type as 'dashboard' | 'recordings' | 'settings';

  const handleSearchResult = useCallback((result: GlobalSearchResult) => {
    // Navigate to the recording's transcript, seeking to the segment time if available
    setNavigation({
      type: 'transcript',
      recordingId: result.recording_id,
      initialSeekTime: result.start_time ?? undefined,
    });
  }, []);

  // Sync theme to document and localStorage
  useEffect(() => {
    const effectiveDark = getEffectiveDarkMode(theme);

    if (effectiveDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    localStorage.setItem('theme', theme);
  }, [theme]);

  // Listen for system theme changes when using 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (mediaQuery.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme(current => {
      if (current === 'light') return 'dark';
      if (current === 'dark') return 'system';
      return 'light';
    });
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
          <div className="flex items-center gap-6">
            <div className="flex-shrink-0">
              <h1 className="text-xl font-bold text-foreground">Verbatim Studio</h1>
              <p className="text-sm text-muted-foreground">
                Privacy-first transcription for professionals
              </p>
            </div>
            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1">
              <button
                onClick={handleNavigateToDashboard}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  currentTab === 'dashboard'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={handleNavigateToRecordings}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  currentTab === 'recordings'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Recordings
              </button>
              <button
                onClick={handleNavigateToSettings}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  currentTab === 'settings'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>
          <div className="flex-1 max-w-md">
            <SearchBox onResultClick={handleSearchResult} />
          </div>
          <div className="flex items-center gap-4 text-sm flex-shrink-0">
            {/* Theme Toggle */}
            <button
              onClick={cycleTheme}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title={`Theme: ${theme} (click to change)`}
            >
              {theme === 'light' ? (
                <svg className="w-5 h-5 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : theme === 'dark' ? (
                <svg className="w-5 h-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
            </button>
            <span className="text-muted-foreground font-mono">
              {apiInfo?.version || APP_VERSION}
            </span>
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
        {navigation.type === 'dashboard' && (
          <Dashboard onNavigateToRecordings={handleNavigateToRecordings} />
        )}
        {navigation.type === 'recordings' && (
          <RecordingsPage onViewTranscript={handleViewTranscript} />
        )}
        {navigation.type === 'transcript' && (
          <TranscriptPage
            recordingId={navigation.recordingId}
            onBack={handleBackToRecordings}
            initialSeekTime={navigation.initialSeekTime}
          />
        )}
        {navigation.type === 'settings' && (
          <SettingsPage theme={theme} onThemeChange={setTheme} />
        )}
      </main>
    </div>
  );
}
