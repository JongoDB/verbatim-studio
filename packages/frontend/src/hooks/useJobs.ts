// packages/frontend/src/hooks/useJobs.ts
import { useQuery } from '@tanstack/react-query';
import { api, type JobListResponse } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export function useRunningJobs() {
  return useQuery({
    queryKey: queryKeys.jobs.running(),
    queryFn: () => api.jobs.list('running', 100),
    // Poll for progress while jobs are running
    refetchInterval: (query) => {
      const data = query.state.data as JobListResponse | undefined;
      // Keep polling if there are running jobs
      return data?.items && data.items.length > 0 ? 2000 : false;
    },
  });
}
