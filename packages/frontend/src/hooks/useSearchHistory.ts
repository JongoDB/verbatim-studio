// packages/frontend/src/hooks/useSearchHistory.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type SearchHistoryListResponse } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export function useSearchHistory(limit = 20) {
  return useQuery({
    queryKey: queryKeys.search.history,
    queryFn: () => api.search.history(limit),
  });
}

export function useClearSearchHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.search.clearHistory(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.search.history });

      const previousData = queryClient.getQueryData<SearchHistoryListResponse>(
        queryKeys.search.history
      );

      queryClient.setQueryData<SearchHistoryListResponse>(
        queryKeys.search.history,
        { items: [], total: 0 }
      );

      return { previousData };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.search.history, context.previousData);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.search.history });
    },
  });
}

export function useDeleteSearchHistoryEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId: string) => api.search.deleteHistoryEntry(entryId),

    onMutate: async (entryId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.search.history });

      const previousData = queryClient.getQueryData<SearchHistoryListResponse>(
        queryKeys.search.history
      );

      queryClient.setQueryData<SearchHistoryListResponse>(
        queryKeys.search.history,
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== entryId),
            total: old.total - 1,
          };
        }
      );

      return { previousData };
    },

    onError: (_err, _id, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.search.history, context.previousData);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.search.history });
    },
  });
}
