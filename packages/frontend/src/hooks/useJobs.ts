// packages/frontend/src/hooks/useJobs.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export function useRunningJobs() {
  return useQuery({
    queryKey: queryKeys.jobs.running(),
    queryFn: () => api.jobs.list('running', 100),
    // Always poll every 2 seconds to catch newly created jobs
    // This ensures we detect jobs started after the initial query
    refetchInterval: 2000,
    // Only refetch when window is focused to save resources
    refetchIntervalInBackground: false,
  });
}
