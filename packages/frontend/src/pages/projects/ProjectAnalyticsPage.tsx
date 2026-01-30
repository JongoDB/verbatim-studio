import { useState, useEffect, useCallback } from 'react';
import { api, type Project, type ProjectAnalytics } from '@/lib/api';

interface ProjectAnalyticsPageProps {
  projectId: string;
  onBack: () => void;
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours.toFixed(1);
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export function ProjectAnalyticsPage({ projectId, onBack }: ProjectAnalyticsPageProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [projectRes, analyticsRes] = await Promise.all([
        api.projects.get(projectId),
        api.projects.analytics(projectId),
      ]);
      setProject(projectRes);
      setAnalytics(analyticsRes);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg
          className="h-8 w-8 animate-spin text-primary"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  if (!project || !analytics) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Failed to load analytics</p>
        <button
          onClick={onBack}
          className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const stats = analytics.recording_stats;
  const totalDuration = analytics.total_duration_seconds;
  const maxWordCount = analytics.word_frequency[0]?.count || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{project.name} - Analytics</h1>
          {project.project_type && (
            <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded bg-primary/10 text-primary">
              {project.project_type.name}
            </span>
          )}
        </div>
      </div>

      {/* Stats Cards - Row 1 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Total Recordings</p>
          <p className="text-2xl font-bold text-foreground mt-1">{stats.total}</p>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Total Hours</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatHours(totalDuration)}</p>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{stats.completed}</p>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Failed</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{stats.failed}</p>
        </div>
      </div>

      {/* Stats Cards - Row 2 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Avg Duration</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {analytics.avg_duration_seconds ? formatDuration(analytics.avg_duration_seconds) : '--:--'}
          </p>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Total Words</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatNumber(analytics.total_word_count)}</p>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Avg Confidence</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {analytics.avg_confidence ? `${(analytics.avg_confidence * 100).toFixed(0)}%` : 'N/A'}
          </p>
        </div>
        <div className="border border-border rounded-lg p-4 bg-card">
          <p className="text-sm text-muted-foreground">Pending/Processing</p>
          <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">
            {stats.pending + stats.processing}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recording Timeline */}
        <div className="border border-border rounded-lg p-4 bg-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Recording Timeline</h2>
          {analytics.recording_timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recordings yet</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {analytics.recording_timeline.map((entry) => (
                <div key={entry.date} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{entry.date}</span>
                  <span className="text-sm text-muted-foreground">
                    {entry.count} recording{entry.count !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Words with Blue Bars */}
        <div className="border border-border rounded-lg p-4 bg-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Top Words</h2>
          {analytics.word_frequency.length === 0 ? (
            <p className="text-sm text-muted-foreground">No word data available</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {analytics.word_frequency.slice(0, 20).map((word, index) => {
                const barWidth = (word.count / maxWordCount) * 100;
                return (
                  <div
                    key={index}
                    className="relative flex items-center gap-3 py-1 px-2 rounded"
                  >
                    {/* Blue bar background */}
                    <div
                      className="absolute inset-y-0 left-0 bg-blue-500/20 rounded"
                      style={{ width: `${barWidth}%` }}
                    />
                    {/* Content */}
                    <span className="relative w-6 text-sm text-muted-foreground text-right">
                      {index + 1}.
                    </span>
                    <span className="relative flex-1 text-sm font-medium text-foreground">
                      {word.word}
                    </span>
                    <span className="relative text-sm text-muted-foreground tabular-nums">
                      {word.count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Status Breakdown */}
      {stats.total > 0 && (
        <div className="border border-border rounded-lg p-4 bg-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Status Breakdown</h2>
          <div className="flex h-4 rounded-full overflow-hidden bg-muted">
            {stats.completed > 0 && (
              <div
                className="bg-green-500 transition-all"
                style={{ width: `${(stats.completed / stats.total) * 100}%` }}
                title={`Completed: ${stats.completed}`}
              />
            )}
            {stats.processing > 0 && (
              <div
                className="bg-blue-500 transition-all"
                style={{ width: `${(stats.processing / stats.total) * 100}%` }}
                title={`Processing: ${stats.processing}`}
              />
            )}
            {stats.pending > 0 && (
              <div
                className="bg-yellow-500 transition-all"
                style={{ width: `${(stats.pending / stats.total) * 100}%` }}
                title={`Pending: ${stats.pending}`}
              />
            )}
            {stats.failed > 0 && (
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${(stats.failed / stats.total) * 100}%` }}
                title={`Failed: ${stats.failed}`}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-green-500" />
              Completed ({stats.completed})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-blue-500" />
              Processing ({stats.processing})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-yellow-500" />
              Pending ({stats.pending})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              Failed ({stats.failed})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
