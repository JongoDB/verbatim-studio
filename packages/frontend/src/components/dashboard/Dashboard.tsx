import { useEffect, useState } from 'react';
import { api, type DashboardStats, type Recording, type Project } from '@/lib/api';

interface DashboardProps {
  onNavigateToRecordings?: () => void;
  onNavigateToProjects?: () => void;
  onViewRecording?: (recordingId: string) => void;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds === 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatShortDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color = 'blue',
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'purple' | 'amber';
  onClick?: () => void;
}) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
  };

  const content = (
    <div className="flex items-center gap-4">
      <div className={`p-3 rounded-lg ${colorClasses[color]}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      {content}
    </div>
  );
}

export function Dashboard({ onNavigateToRecordings, onNavigateToProjects, onViewRecording }: DashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentRecordings, setRecentRecordings] = useState<Recording[]>([]);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [statsData, recordingsData, projectsData] = await Promise.all([
          api.stats.dashboard(),
          api.recordings.list({ sortBy: 'created_at', sortOrder: 'desc', pageSize: 5 }),
          api.projects.list(),
        ]);
        setStats(statsData);
        setRecentRecordings(recordingsData.items.slice(0, 5));
        // Sort projects by updated_at desc and take first 5
        const sortedProjects = [...projectsData.items].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        setRecentProjects(sortedProjects.slice(0, 5));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      } finally {
        setIsLoading(false);
      }
    }
    loadDashboardData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg
          className="h-8 w-8 animate-spin text-blue-600"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  const { recordings, transcriptions, projects, processing } = stats;

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Recordings"
          value={recordings.total_recordings}
          subtitle={`${formatDuration(recordings.total_duration_seconds)} total`}
          color="blue"
          onClick={onNavigateToRecordings}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          }
        />
        <StatCard
          title="Transcripts"
          value={transcriptions.total_transcripts}
          subtitle={`${transcriptions.total_segments.toLocaleString()} segments`}
          color="green"
          onClick={onNavigateToRecordings}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <StatCard
          title="Projects"
          value={projects.total_projects}
          subtitle={projects.last_updated ? `Updated ${formatRelativeTime(projects.last_updated)}` : 'No activity'}
          color="purple"
          onClick={onNavigateToProjects}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          }
        />
        <StatCard
          title="Processing"
          value={processing.active_count}
          subtitle={processing.active_count === 0 ? 'All caught up' : `${processing.running_count} running, ${processing.queued_count} queued`}
          color={processing.active_count > 0 ? 'amber' : 'green'}
          onClick={onNavigateToRecordings}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        />
      </div>

      {/* Status Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recording Status */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Recordings by Status</h3>
          <div className="space-y-3">
            {Object.entries(recordings.by_status).map(([status, count]) => {
              const percentage = recordings.total_recordings > 0
                ? (count / recordings.total_recordings) * 100
                : 0;
              const statusColors: Record<string, string> = {
                pending: 'bg-yellow-500',
                processing: 'bg-blue-500',
                completed: 'bg-green-500',
                failed: 'bg-red-500',
              };
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="capitalize text-gray-700 dark:text-gray-300">{status}</span>
                    <span className="text-gray-500 dark:text-gray-400">{count}</span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${statusColors[status] || 'bg-gray-500'} rounded-full transition-all`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {Object.keys(recordings.by_status).length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No recordings yet</p>
            )}
          </div>
        </div>

        {/* Languages */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Languages Detected</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(transcriptions.languages).map(([lang, count]) => (
              <span
                key={lang}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-sm"
              >
                <span className="uppercase font-medium text-gray-700 dark:text-gray-300">{lang}</span>
                <span className="text-gray-500 dark:text-gray-400">({count})</span>
              </span>
            ))}
            {Object.keys(transcriptions.languages).length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No transcriptions yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Recordings & Projects */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Recordings */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Recent Recordings</h3>
            {onNavigateToRecordings && (
              <button
                onClick={onNavigateToRecordings}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View All →
              </button>
            )}
          </div>
          {recentRecordings.length > 0 ? (
            <div className="space-y-2">
              {recentRecordings.map((recording) => {
                const statusColors: Record<string, string> = {
                  pending: 'text-yellow-600 dark:text-yellow-400',
                  processing: 'text-blue-600 dark:text-blue-400',
                  completed: 'text-green-600 dark:text-green-400',
                  failed: 'text-red-600 dark:text-red-400',
                  cancelled: 'text-gray-600 dark:text-gray-400',
                };
                const statusIcons: Record<string, string> = {
                  pending: '○',
                  processing: '◐',
                  completed: '✓',
                  failed: '✕',
                  cancelled: '–',
                };
                return (
                  <button
                    key={recording.id}
                    onClick={() => {
                      if (recording.status === 'completed') {
                        onViewRecording?.(recording.id);
                      } else {
                        onNavigateToRecordings?.();
                      }
                    }}
                    className="w-full flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors text-left"
                  >
                    <svg className="w-4 h-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{recording.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatRelativeTime(recording.created_at)}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                      {formatShortDuration(recording.duration_seconds)}
                    </span>
                    <span className={`text-sm shrink-0 ${statusColors[recording.status] || ''}`}>
                      {statusIcons[recording.status] || '?'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6">
              <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No recordings yet</p>
              {onNavigateToRecordings && (
                <button
                  onClick={onNavigateToRecordings}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Upload your first recording
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recent Projects */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Recent Projects</h3>
            {onNavigateToProjects && (
              <button
                onClick={onNavigateToProjects}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View All →
              </button>
            )}
          </div>
          {recentProjects.length > 0 ? (
            <div className="space-y-2">
              {recentProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onNavigateToProjects?.()}
                  className="w-full flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors text-left"
                >
                  <svg className="w-4 h-4 shrink-0 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{project.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Updated {formatRelativeTime(project.updated_at)}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    {project.recording_count} {project.recording_count === 1 ? 'rec' : 'recs'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No projects yet</p>
              {onNavigateToProjects && (
                <button
                  onClick={onNavigateToProjects}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Create your first project
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Action */}
      {onNavigateToRecordings && recordings.total_recordings === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto text-gray-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            Get Started
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Upload your first recording to begin transcribing
          </p>
          <button
            onClick={onNavigateToRecordings}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Recording
          </button>
        </div>
      )}
    </div>
  );
}
