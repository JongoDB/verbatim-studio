// packages/frontend/src/hooks/useDashboard.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.dashboard.stats,
    queryFn: () => api.stats.dashboard(),
  });
}

export function useRecentRecordings(limit = 5) {
  return useQuery({
    queryKey: [...queryKeys.recordings.list({}), 'recent', limit] as const,
    queryFn: async () => {
      const response = await api.recordings.list({
        pageSize: limit,
        sortBy: 'created_at',
        sortOrder: 'desc',
      });
      return response.items;
    },
  });
}

export function useRecentProjects(limit = 5) {
  return useQuery({
    queryKey: [...queryKeys.projects.list({}), 'recent', limit] as const,
    queryFn: async () => {
      const response = await api.projects.list({});
      // Sort by updated_at descending and take first `limit`
      const sorted = [...response.items].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      return sorted.slice(0, limit);
    },
  });
}
