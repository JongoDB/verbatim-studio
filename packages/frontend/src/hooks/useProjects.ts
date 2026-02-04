// packages/frontend/src/hooks/useProjects.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ProjectListResponse, type ProjectCreateRequest, type ProjectUpdateRequest } from '@/lib/api';
import { queryKeys, type ProjectFilters } from '@/lib/queryKeys';

export function useProjects(filters: ProjectFilters = {}) {
  return useQuery({
    queryKey: queryKeys.projects.list(filters),
    queryFn: () => api.projects.list(filters),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id ?? ''),
    queryFn: () => api.projects.get(id!),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProjectCreateRequest) => api.projects.create(data),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ProjectUpdateRequest }) =>
      api.projects.update(id, data),

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(variables.id) });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, deleteFiles }: { id: string; deleteFiles?: boolean }) =>
      api.projects.delete(id, { deleteFiles }),

    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all });

      const previousData = queryClient.getQueriesData<ProjectListResponse>({
        queryKey: queryKeys.projects.all,
      });

      // Note: queryKeys.projects.all matches both list and detail queries,
      // so we need to check for the items array before filtering
      queryClient.setQueriesData<ProjectListResponse>(
        { queryKey: queryKeys.projects.all },
        (old) => {
          if (!old || !('items' in old)) return old;
          return {
            ...old,
            items: old.items.filter((p) => p.id !== id),
            total: old.total - 1,
          };
        }
      );

      return { previousData };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
}
