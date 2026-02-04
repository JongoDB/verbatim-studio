// packages/frontend/src/hooks/useConversations.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ConversationListResponse } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export function useConversations() {
  return useQuery({
    queryKey: queryKeys.conversations.list(),
    queryFn: () => api.conversations.list(),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.conversations.detail(id ?? ''),
    queryFn: () => api.conversations.get(id!),
    enabled: !!id,
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.conversations.delete(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations.all });

      const previousData = queryClient.getQueriesData<ConversationListResponse>({
        queryKey: queryKeys.conversations.all,
      });

      queryClient.setQueriesData<ConversationListResponse>(
        { queryKey: queryKeys.conversations.all },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((c) => c.id !== id),
            total: old.total - 1,
          };
        }
      );

      return { previousData };
    },

    onError: (_err, _id, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all });
    },
  });
}

export function useUpdateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.conversations.update(id, { title }),

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(variables.id) });
    },
  });
}
