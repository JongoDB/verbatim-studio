// packages/frontend/src/hooks/useDocuments.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type DocumentListResponse } from '@/lib/api';
import { queryKeys, type DocumentFilters } from '@/lib/queryKeys';

export function useDocuments(filters: DocumentFilters = {}) {
  return useQuery({
    queryKey: queryKeys.documents.list(filters),
    queryFn: async (): Promise<DocumentListResponse> => {
      return api.documents.list({
        search: filters.search || undefined,
        status: filters.status || undefined,
        sort_by: filters.sortBy || undefined,
        sort_order: filters.sortOrder || undefined,
        project_id: filters.projectId || undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        tag_ids: filters.tagIds?.length ? filters.tagIds.join(',') : undefined,
        mime_type: filters.mimeType || undefined,
      });
    },
  });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: queryKeys.documents.detail(id ?? ''),
    queryFn: () => api.documents.get(id!),
    enabled: !!id,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      file,
      title,
      projectId,
      enableOcr,
    }: {
      file: File;
      title?: string;
      projectId?: string;
      enableOcr?: boolean;
    }) => api.documents.upload(file, title, projectId, enableOcr),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { title?: string; project_id?: string | null };
    }) => api.documents.update(id, data),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.documents.delete(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documents.all });

      const previousData = queryClient.getQueriesData<DocumentListResponse>({
        queryKey: queryKeys.documents.all,
      });

      queryClient.setQueriesData<DocumentListResponse>(
        { queryKey: queryKeys.documents.all },
        (old) => {
          if (!old || !('items' in old)) return old;
          const remaining = old.items.filter((d) => d.id !== id);
          return {
            ...old,
            items: remaining,
            total: old.total - (old.items.length - remaining.length),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
}

export function useBulkDeleteDocuments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => api.documents.bulkDelete(ids),

    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documents.all });

      const previousData = queryClient.getQueriesData<DocumentListResponse>({
        queryKey: queryKeys.documents.all,
      });

      const idsSet = new Set(ids);
      queryClient.setQueriesData<DocumentListResponse>(
        { queryKey: queryKeys.documents.all },
        (old) => {
          if (!old || !('items' in old)) return old;
          const remaining = old.items.filter((d) => !idsSet.has(d.id));
          return {
            ...old,
            items: remaining,
            total: old.total - (old.items.length - remaining.length),
          };
        }
      );

      return { previousData };
    },

    onError: (_err, _ids, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
}

export function useBulkAssignDocuments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ids,
      projectId,
    }: {
      ids: string[];
      projectId: string | null;
    }) => api.documents.bulkAssign(ids, projectId),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function useRunDocumentOcr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.documents.runOcr(id),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useCancelDocumentProcessing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.documents.cancelProcessing(id),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useReprocessDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.documents.reprocess(id),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}
