# Live Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time updates to all dynamic pages using React Query + WebSocket invalidation.

**Architecture:** React Query manages caching and data fetching state. A single WebSocket connection (`/api/ws/sync`) receives broadcast messages when data changes. The `useDataSync` hook listens to these messages and invalidates relevant React Query caches, triggering automatic refetches.

**Tech Stack:** React Query v5, FastAPI WebSocket, TypeScript

---

## Task 1: Create Query Keys Module

**Files:**
- Create: `packages/frontend/src/lib/queryKeys.ts`

**Step 1: Create the query keys file**

```typescript
// packages/frontend/src/lib/queryKeys.ts

import type { Recording } from './api';

// Filter types for query keys
export interface RecordingFilters {
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  tagIds?: string[];
  speaker?: string;
  templateId?: string;
}

export interface ProjectFilters {
  search?: string;
  projectTypeId?: string;
  tag?: string;
}

export const queryKeys = {
  // Recordings
  recordings: {
    all: ['recordings'] as const,
    list: (filters?: RecordingFilters) => ['recordings', 'list', filters] as const,
    detail: (id: string) => ['recordings', 'detail', id] as const,
  },

  // Projects
  projects: {
    all: ['projects'] as const,
    list: (filters?: ProjectFilters) => ['projects', 'list', filters] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    recordings: (id: string) => ['projects', id, 'recordings'] as const,
    analytics: (id: string) => ['projects', id, 'analytics'] as const,
  },

  // Conversations (Chats)
  conversations: {
    all: ['conversations'] as const,
    list: () => ['conversations', 'list'] as const,
    detail: (id: string) => ['conversations', 'detail', id] as const,
  },

  // Dashboard
  dashboard: {
    stats: ['dashboard', 'stats'] as const,
  },

  // Search
  search: {
    history: ['search', 'history'] as const,
    global: (query: string) => ['search', 'global', query] as const,
  },

  // Documents
  documents: {
    all: ['documents'] as const,
    list: (filters?: { project_id?: string; status?: string; search?: string }) =>
      ['documents', 'list', filters] as const,
    detail: (id: string) => ['documents', 'detail', id] as const,
  },

  // Jobs (for progress tracking)
  jobs: {
    all: ['jobs'] as const,
    running: () => ['jobs', 'running'] as const,
  },
};
```

**Step 2: Verify the file compiles**

Run: `cd /Users/JonWFH/jondev/verbatim-studio/.worktrees/live-updates && pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/lib/queryKeys.ts
git commit -m "feat: add React Query key definitions for live updates"
```

---

## Task 2: Add React Query Provider to App

**Files:**
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Add QueryClient and QueryClientProvider imports and setup**

At the top of App.tsx, add import:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
```

Before the `App` function, add:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // Data considered fresh for 30s
      gcTime: 5 * 60_000,       // Cache garbage collected after 5 min
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
```

**Step 2: Wrap the app content with QueryClientProvider**

In the `App` function return statement, wrap the outermost `<div>` with `<QueryClientProvider>`:

```typescript
return (
  <QueryClientProvider client={queryClient}>
    <div className="min-h-screen bg-background flex">
      {/* ... existing content ... */}
    </div>
  </QueryClientProvider>
);
```

**Step 3: Also wrap the loading and error states**

The early returns for loading/error states should also be wrapped:

```typescript
if (isConnecting) {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background flex items-center justify-center">
        {/* ... */}
      </div>
    </QueryClientProvider>
  );
}

if (error && !apiInfo) {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background flex items-center justify-center">
        {/* ... */}
      </div>
    </QueryClientProvider>
  );
}
```

**Step 4: Verify build passes**

Run: `pnpm --filter @verbatim/frontend build`
Expected: Build completes successfully

**Step 5: Commit**

```bash
git add packages/frontend/src/app/App.tsx
git commit -m "feat: add React Query provider to App"
```

---

## Task 3: Create Backend WebSocket Sync Endpoint

**Files:**
- Create: `packages/backend/api/routes/sync.py`
- Modify: `packages/backend/api/main.py`

**Step 1: Create the sync.py WebSocket endpoint**

```python
# packages/backend/api/routes/sync.py
"""WebSocket endpoint for real-time data sync."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["sync"])

# Connected WebSocket clients
_clients: Set[WebSocket] = set()


@router.websocket("/sync")
async def sync_websocket(websocket: WebSocket):
    """WebSocket endpoint for data change notifications."""
    await websocket.accept()
    _clients.add(websocket)
    logger.info(f"WebSocket client connected. Total clients: {len(_clients)}")

    try:
        while True:
            # Keep connection alive - client can send ping messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        _clients.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(_clients)}")


async def broadcast(resource: str, action: str, id: str | None = None):
    """
    Broadcast a data change notification to all connected clients.

    Args:
        resource: The resource type (e.g., 'recordings', 'projects', 'conversations')
        action: The action performed (e.g., 'created', 'updated', 'deleted', 'status_changed')
        id: Optional ID of the affected resource
    """
    if not _clients:
        return

    message = {
        "type": "invalidate",
        "resource": resource,
        "action": action,
    }
    if id:
        message["id"] = id

    disconnected = set()
    for client in _clients.copy():
        try:
            await client.send_json(message)
        except Exception:
            disconnected.add(client)

    # Clean up disconnected clients
    for client in disconnected:
        _clients.discard(client)
```

**Step 2: Register the sync router in main.py**

In `packages/backend/api/main.py`, add import:

```python
from api.routes.sync import router as sync_router
```

Add after other router includes (around line 152):

```python
app.include_router(sync_router)  # WebSocket sync endpoint
```

**Step 3: Verify backend starts**

Run: `cd packages/backend && python -c "from api.main import app; print('OK')"`
Expected: Prints "OK"

**Step 4: Commit**

```bash
git add packages/backend/api/routes/sync.py packages/backend/api/main.py
git commit -m "feat: add WebSocket sync endpoint for data change broadcasts"
```

---

## Task 4: Create useDataSync Hook

**Files:**
- Create: `packages/frontend/src/hooks/useDataSync.tsx`

**Step 1: Create the data sync hook and provider**

```typescript
// packages/frontend/src/hooks/useDataSync.tsx
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getWebSocketUrl } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

interface DataSyncContextValue {
  connected: boolean;
}

const DataSyncContext = createContext<DataSyncContextValue>({ connected: false });

export function useDataSyncStatus() {
  return useContext(DataSyncContext);
}

interface InvalidationMessage {
  type: 'invalidate';
  resource: string;
  action: string;
  id?: string;
}

function handleInvalidation(
  queryClient: QueryClient,
  resource: string,
  action: string,
  id?: string
) {
  console.log(`[DataSync] Invalidating ${resource} (${action})${id ? ` id=${id}` : ''}`);

  switch (resource) {
    case 'recordings':
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      break;

    case 'projects':
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
      break;

    case 'conversations':
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all });
      break;

    case 'search_history':
      queryClient.invalidateQueries({ queryKey: queryKeys.search.history });
      break;

    case 'documents':
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
      break;

    default:
      console.warn(`[DataSync] Unknown resource: ${resource}`);
  }
}

interface DataSyncProviderProps {
  children: ReactNode;
}

export function DataSyncProvider({ children }: DataSyncProviderProps) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxReconnectAttempts = 10;

  useEffect(() => {
    function connect() {
      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      const wsUrl = getWebSocketUrl('/api/ws/sync');
      console.log('[DataSync] Connecting to', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[DataSync] Connected');
        setConnected(true);
        reconnectAttempts.current = 0;

        // Invalidate all queries to ensure fresh data after reconnect
        queryClient.invalidateQueries();
      };

      ws.onclose = (event) => {
        console.log('[DataSync] Disconnected', event.code, event.reason);
        setConnected(false);
        wsRef.current = null;

        // Attempt reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`[DataSync] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          console.error('[DataSync] Max reconnect attempts reached');
        }
      };

      ws.onerror = (error) => {
        console.error('[DataSync] WebSocket error', error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as InvalidationMessage;
          if (data.type === 'invalidate') {
            handleInvalidation(queryClient, data.resource, data.action, data.id);
          }
        } catch (err) {
          console.error('[DataSync] Failed to parse message', err);
        }
      };
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [queryClient]);

  return (
    <DataSyncContext.Provider value={{ connected }}>
      {children}
    </DataSyncContext.Provider>
  );
}
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useDataSync.tsx
git commit -m "feat: add useDataSync hook for WebSocket-based cache invalidation"
```

---

## Task 5: Integrate DataSyncProvider into App

**Files:**
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Import DataSyncProvider**

Add import at top:

```typescript
import { DataSyncProvider } from '@/hooks/useDataSync';
```

**Step 2: Wrap content with DataSyncProvider inside QueryClientProvider**

Update the main return to nest DataSyncProvider inside QueryClientProvider:

```typescript
return (
  <QueryClientProvider client={queryClient}>
    <DataSyncProvider>
      <div className="min-h-screen bg-background flex">
        {/* ... existing content ... */}
      </div>
    </DataSyncProvider>
  </QueryClientProvider>
);
```

**Step 3: Verify build passes**

Run: `pnpm --filter @verbatim/frontend build`
Expected: Build completes successfully

**Step 4: Commit**

```bash
git add packages/frontend/src/app/App.tsx
git commit -m "feat: integrate DataSyncProvider into App"
```

---

## Task 6: Create useRecordings Hook

**Files:**
- Create: `packages/frontend/src/hooks/useRecordings.ts`

**Step 1: Create the recordings query hooks**

```typescript
// packages/frontend/src/hooks/useRecordings.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Recording, type RecordingListResponse, type MessageResponse } from '@/lib/api';
import { queryKeys, type RecordingFilters } from '@/lib/queryKeys';

export function useRecordings(filters: RecordingFilters = {}) {
  return useQuery({
    queryKey: queryKeys.recordings.list(filters),
    queryFn: async (): Promise<RecordingListResponse> => {
      return api.recordings.list({
        search: filters.search || undefined,
        status: filters.status || undefined,
        sortBy: filters.sortBy as 'created_at' | 'title' | 'duration' | undefined,
        sortOrder: filters.sortOrder as 'asc' | 'desc' | undefined,
        projectId: filters.projectId || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        tagIds: filters.tagIds?.length ? filters.tagIds : undefined,
        speaker: filters.speaker || undefined,
        templateId: filters.templateId || undefined,
      });
    },
  });
}

export function useRecording(id: string | null) {
  return useQuery({
    queryKey: queryKeys.recordings.detail(id ?? ''),
    queryFn: () => api.recordings.get(id!),
    enabled: !!id,
  });
}

export function useDeleteRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.recordings.delete(id),

    onMutate: async (id) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.recordings.all });

      // Snapshot previous value for rollback
      const previousData = queryClient.getQueriesData<RecordingListResponse>({
        queryKey: queryKeys.recordings.all,
      });

      // Optimistically remove from all recording lists
      queryClient.setQueriesData<RecordingListResponse>(
        { queryKey: queryKeys.recordings.all },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((r) => r.id !== id),
            total: old.total - 1,
          };
        }
      );

      return { previousData };
    },

    onError: (_err, _id, context) => {
      // Rollback on error
      if (context?.previousData) {
        context.previousData.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },

    onSettled: () => {
      // Refetch to ensure consistency (WebSocket will also trigger this)
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
}

export function useBulkDeleteRecordings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => api.recordings.bulkDelete(ids),

    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.recordings.all });

      const previousData = queryClient.getQueriesData<RecordingListResponse>({
        queryKey: queryKeys.recordings.all,
      });

      const idsSet = new Set(ids);
      queryClient.setQueriesData<RecordingListResponse>(
        { queryKey: queryKeys.recordings.all },
        (old) => {
          if (!old) return old;
          const remaining = old.items.filter((r) => !idsSet.has(r.id));
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
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
    },
  });
}

export function useTranscribeRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, language }: { id: string; language?: string }) =>
      api.recordings.transcribe(id, language),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useCancelRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.recordings.cancel(id),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useRetryRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.recordings.retry(id),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useRecordings.ts
git commit -m "feat: add useRecordings hooks with React Query and optimistic updates"
```

---

## Task 7: Add Broadcast Calls to Recordings Routes

**Files:**
- Modify: `packages/backend/api/routes/recordings.py`

**Step 1: Import broadcast function**

At the top of recordings.py, add:

```python
from api.routes.sync import broadcast
```

**Step 2: Add broadcast after recording upload (create)**

Find the `upload_recording` function. After the recording is created and committed, add:

```python
await broadcast("recordings", "created", str(recording.id))
```

**Step 3: Add broadcast after recording delete**

Find the `delete_recording` function. After the recording is deleted, add:

```python
await broadcast("recordings", "deleted", recording_id)
```

**Step 4: Add broadcast after recording update**

Find the `update_recording` function. After the recording is updated, add:

```python
await broadcast("recordings", "updated", recording_id)
```

**Step 5: Add broadcast after transcription starts**

Find the `transcribe_recording` function. After the job is queued, add:

```python
await broadcast("recordings", "status_changed", recording_id)
```

**Step 6: Add broadcast after bulk delete**

Find the `bulk_delete_recordings` function. After recordings are deleted, add:

```python
await broadcast("recordings", "deleted")
```

**Step 7: Verify backend starts**

Run: `cd packages/backend && python -c "from api.main import app; print('OK')"`
Expected: Prints "OK"

**Step 8: Commit**

```bash
git add packages/backend/api/routes/recordings.py
git commit -m "feat: add WebSocket broadcasts for recording mutations"
```

---

## Task 8: Create useDashboard Hook

**Files:**
- Create: `packages/frontend/src/hooks/useDashboard.ts`

**Step 1: Create the dashboard query hook**

```typescript
// packages/frontend/src/hooks/useDashboard.ts
import { useQuery } from '@tanstack/react-query';
import { api, type DashboardStats, type RecordingListResponse, type ProjectListResponse } from '@/lib/api';
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
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useDashboard.ts
git commit -m "feat: add useDashboard hooks for dashboard data"
```

---

## Task 9: Create useProjects Hook

**Files:**
- Create: `packages/frontend/src/hooks/useProjects.ts`

**Step 1: Create the projects query hooks**

```typescript
// packages/frontend/src/hooks/useProjects.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Project, type ProjectListResponse, type ProjectCreateRequest, type ProjectUpdateRequest } from '@/lib/api';
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

      queryClient.setQueriesData<ProjectListResponse>(
        { queryKey: queryKeys.projects.all },
        (old) => {
          if (!old) return old;
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
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useProjects.ts
git commit -m "feat: add useProjects hooks with React Query"
```

---

## Task 10: Add Broadcast Calls to Projects Routes

**Files:**
- Modify: `packages/backend/api/routes/projects.py`

**Step 1: Import broadcast function**

At the top of projects.py, add:

```python
from api.routes.sync import broadcast
```

**Step 2: Add broadcast after project create**

Find the function that creates a project. After commit, add:

```python
await broadcast("projects", "created", str(project.id))
```

**Step 3: Add broadcast after project update**

Find the function that updates a project. After commit, add:

```python
await broadcast("projects", "updated", project_id)
```

**Step 4: Add broadcast after project delete**

Find the function that deletes a project. After deletion, add:

```python
await broadcast("projects", "deleted", project_id)
```

**Step 5: Verify backend starts**

Run: `cd packages/backend && python -c "from api.main import app; print('OK')"`
Expected: Prints "OK"

**Step 6: Commit**

```bash
git add packages/backend/api/routes/projects.py
git commit -m "feat: add WebSocket broadcasts for project mutations"
```

---

## Task 11: Create useConversations Hook

**Files:**
- Create: `packages/frontend/src/hooks/useConversations.ts`

**Step 1: Create the conversations query hooks**

```typescript
// packages/frontend/src/hooks/useConversations.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Conversation, type ConversationDetail, type ConversationListResponse } from '@/lib/api';
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
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useConversations.ts
git commit -m "feat: add useConversations hooks with React Query"
```

---

## Task 12: Add Broadcast Calls to Conversations Routes

**Files:**
- Modify: `packages/backend/api/routes/conversations.py`

**Step 1: Import broadcast function**

At the top of conversations.py, add:

```python
from api.routes.sync import broadcast
```

**Step 2: Add broadcast after conversation create**

Find the create conversation function. After commit, add:

```python
await broadcast("conversations", "created", str(conversation.id))
```

**Step 3: Add broadcast after conversation update**

Find the update conversation function. After commit, add:

```python
await broadcast("conversations", "updated", conversation_id)
```

**Step 4: Add broadcast after conversation delete**

Find the delete conversation function. After deletion, add:

```python
await broadcast("conversations", "deleted", conversation_id)
```

**Step 5: Add broadcast after adding message**

Find the add message function. After commit, add:

```python
await broadcast("conversations", "updated", conversation_id)
```

**Step 6: Verify backend starts**

Run: `cd packages/backend && python -c "from api.main import app; print('OK')"`
Expected: Prints "OK"

**Step 7: Commit**

```bash
git add packages/backend/api/routes/conversations.py
git commit -m "feat: add WebSocket broadcasts for conversation mutations"
```

---

## Task 13: Create useSearchHistory Hook

**Files:**
- Create: `packages/frontend/src/hooks/useSearchHistory.ts`

**Step 1: Create the search history query hooks**

```typescript
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
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useSearchHistory.ts
git commit -m "feat: add useSearchHistory hooks with React Query"
```

---

## Task 14: Add Broadcast Calls to Search Routes

**Files:**
- Modify: `packages/backend/api/routes/search.py`

**Step 1: Import broadcast function**

At the top of search.py, add:

```python
from api.routes.sync import broadcast
```

**Step 2: Add broadcast when search history is saved**

Find the global search function where history is saved. After saving, add:

```python
await broadcast("search_history", "created")
```

**Step 3: Add broadcast when history is cleared**

Find the clear history function. After clearing, add:

```python
await broadcast("search_history", "deleted")
```

**Step 4: Add broadcast when single entry is deleted**

Find the delete history entry function. After deletion, add:

```python
await broadcast("search_history", "deleted", entry_id)
```

**Step 5: Verify backend starts**

Run: `cd packages/backend && python -c "from api.main import app; print('OK')"`
Expected: Prints "OK"

**Step 6: Commit**

```bash
git add packages/backend/api/routes/search.py
git commit -m "feat: add WebSocket broadcasts for search history mutations"
```

---

## Task 15: Create useJobs Hook for Progress Tracking

**Files:**
- Create: `packages/frontend/src/hooks/useJobs.ts`

**Step 1: Create the jobs query hook**

```typescript
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
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useJobs.ts
git commit -m "feat: add useJobs hook for job progress tracking"
```

---

## Task 16: Verify Full Build

**Step 1: Run full frontend build**

Run: `pnpm --filter @verbatim/frontend build`
Expected: Build completes successfully

**Step 2: Run backend syntax check**

Run: `cd packages/backend && python -m py_compile api/main.py api/routes/sync.py api/routes/recordings.py api/routes/projects.py api/routes/conversations.py api/routes/search.py`
Expected: No errors

**Step 3: Commit summary**

```bash
git log --oneline -15
```

Expected: ~14 commits for infrastructure setup

---

## Task 17: Create Index Export for Hooks

**Files:**
- Create: `packages/frontend/src/hooks/index.ts`

**Step 1: Create hooks index file**

```typescript
// packages/frontend/src/hooks/index.ts
export * from './useRecordings';
export * from './useProjects';
export * from './useConversations';
export * from './useDashboard';
export * from './useSearchHistory';
export * from './useJobs';
export { DataSyncProvider, useDataSyncStatus } from './useDataSync';
```

**Step 2: Verify the file compiles**

Run: `pnpm --filter @verbatim/frontend exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/index.ts
git commit -m "feat: add hooks index for convenient imports"
```

---

## Summary

This plan creates the infrastructure for live updates:

1. **Tasks 1-5**: React Query setup (query keys, provider, DataSync hook)
2. **Tasks 6-7**: Recordings hooks and backend broadcasts
3. **Tasks 8**: Dashboard hooks
4. **Tasks 9-10**: Projects hooks and backend broadcasts
5. **Tasks 11-12**: Conversations hooks and backend broadcasts
6. **Tasks 13-14**: Search history hooks and backend broadcasts
7. **Tasks 15-17**: Jobs hook, build verification, exports

After completing these tasks, the infrastructure is ready. Page migration (using the new hooks) would be a follow-up phase.
