import { useCallback, useEffect, useState } from 'react';
import { api, type ApiInfo, type HealthStatus, type GlobalSearchResult } from '@/lib/api';
import { RecordingsPage } from '@/pages/recordings/RecordingsPage';
import { ProjectsPage } from '@/pages/projects/ProjectsPage';
import { ProjectDetailPage } from '@/pages/projects/ProjectDetailPage';
import { ProjectAnalyticsPage } from '@/pages/projects/ProjectAnalyticsPage';
import { TranscriptPage } from '@/pages/transcript/TranscriptPage';
import { SearchPage } from '@/pages/search/SearchPage';
import { LiveTranscriptionPage } from '@/pages/live/LiveTranscriptionPage';
import { SearchBox } from '@/components/search/SearchBox';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { Sidebar } from '@/components/layout/Sidebar';
import { APP_VERSION } from '@/version'; // static fallback

type NavigationState =
  | { type: 'dashboard' }
  | { type: 'recordings' }
  | { type: 'projects' }
  | { type: 'project-detail'; projectId: string }
  | { type: 'project-analytics'; projectId: string }
  | { type: 'live' }
  | { type: 'search' }
  | { type: 'settings' }
  | { type: 'transcript'; recordingId: string; initialSeekTime?: number };

// Map navigation state to URL path
function navigationToPath(nav: NavigationState): string {
  switch (nav.type) {
    case 'dashboard': return '/';
    case 'recordings': return '/recordings';
    case 'projects': return '/projects';
    case 'project-detail': return `/projects/${nav.projectId}`;
    case 'project-analytics': return `/projects/${nav.projectId}/analytics`;
    case 'live': return '/live';
    case 'search': return '/search';
    case 'settings': return '/settings';
    case 'transcript': return `/recordings/${nav.recordingId}`;
  }
}

// Parse URL path to navigation state
function pathToNavigation(path: string): NavigationState {
  // Remove trailing slash
  const cleanPath = path.replace(/\/$/, '') || '/';

  if (cleanPath === '/' || cleanPath === '') return { type: 'dashboard' };
  if (cleanPath === '/recordings') return { type: 'recordings' };
  if (cleanPath === '/projects') return { type: 'projects' };
  if (cleanPath === '/live') return { type: 'live' };
  if (cleanPath === '/search') return { type: 'search' };
  if (cleanPath === '/settings') return { type: 'settings' };

  // /recordings/:id -> transcript
  const recordingMatch = cleanPath.match(/^\/recordings\/([^/]+)$/);
  if (recordingMatch) return { type: 'transcript', recordingId: recordingMatch[1] };

  // /projects/:id/analytics -> project analytics
  const analyticsMatch = cleanPath.match(/^\/projects\/([^/]+)\/analytics$/);
  if (analyticsMatch) return { type: 'project-analytics', projectId: analyticsMatch[1] };

  // /projects/:id -> project detail
  const projectMatch = cleanPath.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) return { type: 'project-detail', projectId: projectMatch[1] };

  // Default to dashboard for unknown paths
  return { type: 'dashboard' };
}

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
  const [navigation, setNavigation] = useState<NavigationState>(() =>
    pathToNavigation(window.location.pathname)
  );
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

  const handleNavigateToSearch = useCallback(() => {
    setNavigation({ type: 'search' });
  }, []);

  const handleNavigateToLive = useCallback(() => {
    setNavigation({ type: 'live' });
  }, []);

  const handleBackToRecordings = useCallback(() => {
    setNavigation({ type: 'recordings' });
  }, []);

  const handleNavigateToProjects = useCallback(() => {
    setNavigation({ type: 'projects' });
  }, []);

  const handleNavigateToProjectDetail = useCallback((projectId: string) => {
    setNavigation({ type: 'project-detail', projectId });
  }, []);

  const handleNavigateToProjectAnalytics = useCallback((projectId: string) => {
    setNavigation({ type: 'project-analytics', projectId });
  }, []);

  // Map navigation types to sidebar tabs
  const currentTab = (() => {
    switch (navigation.type) {
      case 'transcript':
        return 'recordings';
      case 'project-detail':
      case 'project-analytics':
        return 'projects';
      default:
        return navigation.type as 'dashboard' | 'recordings' | 'projects' | 'live' | 'search' | 'settings';
    }
  })();

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

  // Sync navigation state to URL
  useEffect(() => {
    const targetPath = navigationToPath(navigation);
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, '', targetPath);
    }
  }, [navigation]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setNavigation(pathToNavigation(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
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
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onNavigate={(tab) => {
          if (tab === 'dashboard') handleNavigateToDashboard();
          else if (tab === 'recordings') handleNavigateToRecordings();
          else if (tab === 'projects') handleNavigateToProjects();
          else if (tab === 'live') handleNavigateToLive();
          else if (tab === 'search') handleNavigateToSearch();
          else if (tab === 'settings') handleNavigateToSettings();
        }}
        theme={theme}
        onCycleTheme={cycleTheme}
        version={apiInfo?.version || APP_VERSION}
        health={health}
      />

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Content header with search */}
        <header className="h-14 border-b border-border bg-card flex items-center px-4 md:px-6 gap-4 shrink-0">
          <div className="w-8 md:hidden" />
          <div className="flex-1 max-w-md">
            <SearchBox onResultClick={handleSearchResult} />
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto px-4 py-8">
            {navigation.type === 'dashboard' && (
              <Dashboard
                onNavigateToRecordings={handleNavigateToRecordings}
                onNavigateToProjects={handleNavigateToProjects}
                onViewRecording={handleViewTranscript}
              />
            )}
            {navigation.type === 'recordings' && (
              <RecordingsPage onViewTranscript={handleViewTranscript} />
            )}
            {navigation.type === 'projects' && (
              <ProjectsPage onNavigateToProject={handleNavigateToProjectDetail} />
            )}
            {navigation.type === 'project-detail' && (
              <ProjectDetailPage
                projectId={navigation.projectId}
                onBack={handleNavigateToProjects}
                onViewTranscript={handleViewTranscript}
                onNavigateToAnalytics={() => handleNavigateToProjectAnalytics(navigation.projectId)}
              />
            )}
            {navigation.type === 'project-analytics' && (
              <ProjectAnalyticsPage
                projectId={navigation.projectId}
                onBack={() => handleNavigateToProjectDetail(navigation.projectId)}
              />
            )}
            {navigation.type === 'live' && (
              <LiveTranscriptionPage
                onNavigateToRecordings={handleNavigateToRecordings}
                onViewRecording={handleViewTranscript}
              />
            )}
            {navigation.type === 'search' && (
              <SearchPage onResultClick={handleSearchResult} />
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
          </div>
        </main>
      </div>
    </div>
  );
}
