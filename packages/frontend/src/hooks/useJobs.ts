// packages/frontend/src/hooks/useJobs.ts
import { useQuery } from '@tanstack/react-query';
import { api, type JobListResponse } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export function useRunningJobs() {
  return useQuery({
    queryKey: queryKeys.jobs.running(),
    queryFn: async (): Promise<JobListResponse> => {
      // Query both running AND queued jobs to catch jobs in all active states
      // Jobs start as 'queued' before becoming 'running', so we need both
      const [running, queued] = await Promise.all([
        api.jobs.list('running', 100),
        api.jobs.list('queued', 100),
      ]);

      // Combine items, running jobs take precedence
      const runningIds = new Set(running.items.map(j => j.id));
      const combinedItems = [
        ...running.items,
        ...queued.items.filter(j => !runningIds.has(j.id)),
      ];

      return {
        items: combinedItems,
        total: combinedItems.length,
      };
    },
    // Always poll every 2 seconds to catch newly created jobs
    refetchInterval: 2000,
    // Only refetch when window is focused to save resources
    refetchIntervalInBackground: false,
  });
}
