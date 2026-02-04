# Live Updates Design

**Issue**: #95 - Add live updates for all pages with dynamic content
**Date**: 2026-02-03
**Status**: Approved

## Summary

Implement real-time updates across all dynamic pages (Dashboard, Recordings, Projects, Chats, Searches) using a hybrid approach: React Query for state management and caching, plus WebSocket for instant invalidation notifications.

## Architecture Overview

```
┌─────────────┐     mutations      ┌─────────────┐
│   Frontend  │ ──────────────────▶│   Backend   │
│  (React +   │                    │  (FastAPI)  │
│ React Query)│◀───────────────────│             │
└─────────────┘   HTTP responses   └──────┬──────┘
       │                                  │
       │         WebSocket                │
       │    ┌─────────────────────────────┘
       │    │  { "type": "invalidate",
       │    │    "resource": "recordings",
       │    │    "action": "created" }
       │    ▼
┌──────┴────────┐
│  useDataSync  │  ←── Custom hook listens to WS
│     hook      │      and calls queryClient.invalidateQueries()
└───────────────┘
```

### Key Components

1. **React Query Provider** - Wraps app, provides `queryClient` instance
2. **WebSocket Connection** - Single persistent connection at `/api/ws/sync`
3. **`useDataSync` hook** - Listens to WebSocket, invalidates React Query caches
4. **Per-page query hooks** - `useRecordings()`, `useProjects()`, etc.
5. **Backend broadcast** - After any mutation, broadcasts invalidation message

### Data Flow

1. User performs action (e.g., deletes recording)
2. React Query mutation fires → optimistic update removes item from UI
3. Backend processes deletion, broadcasts `{ resource: "recordings", action: "deleted", id: "..." }`
4. `useDataSync` receives message → calls `queryClient.invalidateQueries(["recordings"])`
5. React Query refetches in background, confirms deletion (or rolls back on error)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Update mechanism | Hybrid (React Query + WebSocket) | Best UX: caching + instant invalidation |
| WebSocket architecture | Single global channel | Simple for desktop app with one user |
| Rollout strategy | Incremental page-by-page | Lower risk, easier debugging |
| Optimistic updates | With rollback | Snappy UX with graceful error handling |
| Scope | All dynamic pages | Consistent behavior everywhere |

## Backend Changes

### New WebSocket Endpoint

Create `/api/ws/sync` for broadcasting data changes:

```python
# packages/backend/api/routes/sync.py

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set
import json

router = APIRouter(prefix="/ws", tags=["sync"])

# Connected clients
clients: Set[WebSocket] = set()

@router.websocket("/sync")
async def sync_websocket(websocket: WebSocket):
    await websocket.accept()
    clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # Keep-alive
    except WebSocketDisconnect:
        clients.discard(websocket)

async def broadcast(resource: str, action: str, id: str | None = None):
    """Broadcast invalidation to all connected clients."""
    message = {"type": "invalidate", "resource": resource, "action": action}
    if id:
        message["id"] = id
    for client in clients.copy():
        try:
            await client.send_json(message)
        except:
            clients.discard(client)
```

### Broadcast Integration

Add broadcasts after mutations in existing routes:

```python
# In recordings.py, after successful delete:
from api.routes.sync import broadcast
await broadcast("recordings", "deleted", recording_id)

# In projects.py, after successful create:
await broadcast("projects", "created", project.id)
```

### Resources to Broadcast

| Resource | Actions |
|----------|---------|
| `recordings` | created, updated, deleted, status_changed |
| `projects` | created, updated, deleted |
| `conversations` | created, updated, deleted |
| `search_history` | created, deleted |

## Frontend Changes

### React Query Setup

```typescript
// packages/frontend/src/app/App.tsx

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // Data fresh for 30s
      gcTime: 5 * 60_000,       // Cache for 5 min
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DataSyncProvider>
        {/* existing app content */}
      </DataSyncProvider>
    </QueryClientProvider>
  );
}
```

### Query Key Convention

```typescript
// packages/frontend/src/lib/queryKeys.ts

export const queryKeys = {
  recordings: {
    all: ['recordings'] as const,
    list: (filters?: RecordingFilters) => ['recordings', 'list', filters] as const,
    detail: (id: string) => ['recordings', 'detail', id] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (filters?: ProjectFilters) => ['projects', 'list', filters] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
  },
  conversations: {
    all: ['conversations'] as const,
    list: () => ['conversations', 'list'] as const,
  },
  dashboard: {
    stats: ['dashboard', 'stats'] as const,
  },
  search: {
    history: ['search', 'history'] as const,
  },
};
```

### Data Sync Hook

```typescript
// packages/frontend/src/hooks/useDataSync.tsx

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

interface DataSyncContextValue {
  connected: boolean;
}

const DataSyncContext = createContext<DataSyncContextValue>({ connected: false });

export function useDataSyncStatus() {
  return useContext(DataSyncContext);
}

export function DataSyncProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    function connect() {
      const wsUrl = api.getWebSocketUrl('/api/ws/sync');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;
        // Refetch all stale data after reconnect
        queryClient.invalidateQueries();
      };

      ws.onclose = () => {
        setConnected(false);
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
          reconnectAttempts.current++;
          setTimeout(connect, delay);
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'invalidate') {
          handleInvalidation(queryClient, data.resource, data.action, data.id);
        }
      };
    }

    connect();

    return () => wsRef.current?.close();
  }, [queryClient]);

  return (
    <DataSyncContext.Provider value={{ connected }}>
      {children}
    </DataSyncContext.Provider>
  );
}

function handleInvalidation(
  queryClient: QueryClient,
  resource: string,
  action: string,
  id?: string
) {
  switch (resource) {
    case 'recordings':
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
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
  }
}
```

### Page Hook Example - Recordings

```typescript
// packages/frontend/src/hooks/useRecordings.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { Recording, RecordingFilters } from '@/types';
import { toast } from 'sonner';

export function useRecordings(filters: RecordingFilters) {
  return useQuery({
    queryKey: queryKeys.recordings.list(filters),
    queryFn: () => api.recordings.list(filters),
  });
}

export function useDeleteRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.recordings.delete(id),

    // Optimistic update
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.recordings.all });

      const previousData = queryClient.getQueriesData({
        queryKey: queryKeys.recordings.all
      });

      // Remove from cache immediately
      queryClient.setQueriesData(
        { queryKey: queryKeys.recordings.all },
        (old: any) => old ? {
          ...old,
          items: old.items.filter((r: Recording) => r.id !== id),
        } : old
      );

      return { previousData };
    },

    // Rollback on error
    onError: (err, id, context) => {
      context?.previousData.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      toast.error('Failed to delete recording');
    },

    onSuccess: () => toast.success('Recording deleted'),
  });
}
```

### Migrated Page Component Example

```typescript
// RecordingsPage.tsx - key changes

function RecordingsPage() {
  const [filters, setFilters] = useState<RecordingFilters>(loadSavedFilters);

  // Replace useState + useEffect + polling with single hook
  const { data, isLoading, error } = useRecordings(filters);
  const deleteRecording = useDeleteRecording();

  // No more setInterval polling - WebSocket handles updates!

  const handleDelete = (id: string) => {
    deleteRecording.mutate(id);
  };

  return (/* render using data?.items instead of local state */);
}
```

## Error Handling

| Scenario | Solution |
|----------|----------|
| WebSocket disconnects | Exponential backoff reconnect, full invalidation on reconnect |
| User views deleted item | React Query removes from cache; if on detail page, redirect to list |
| Mutation fails | Rollback optimistic update, show toast error |
| Stale tab returns | `refetchOnWindowFocus: true` refreshes data |
| Rapid mutations | `cancelQueries` before optimistic update prevents race conditions |
| Large datasets | Pagination stays in query key; only affected page invalidated |

### Connection Status Indicator (Optional)

```typescript
function ConnectionStatus() {
  const { connected } = useDataSyncStatus();

  if (connected) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-yellow-500 text-black px-3 py-1 rounded text-sm">
      Reconnecting...
    </div>
  );
}
```

## Implementation Order

### Phase 1: Infrastructure
1. Create `queryKeys.ts` with key structure
2. Add `QueryClientProvider` to App.tsx
3. Create backend `/api/ws/sync` endpoint
4. Create `useDataSync` hook and `DataSyncProvider`

### Phase 2: RecordingsPage Migration
5. Create `useRecordings` and `useDeleteRecording` hooks
6. Add broadcasts to recordings routes (create, update, delete, status_changed)
7. Migrate RecordingsPage to use hooks
8. Remove polling logic

### Phase 3: Remaining Pages
9. Dashboard - `useDashboardStats` hook
10. ProjectsPage - `useProjects`, `useCreateProject`, `useDeleteProject`
11. ChatsPage - `useConversations`, `useDeleteConversation`
12. SearchPage - `useSearchHistory`

### Phase 4: Polish
13. Add connection status indicator
14. Add optimistic updates to create/update mutations
15. Test edge cases (reconnection, concurrent edits)

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/frontend/src/lib/queryKeys.ts` | Create |
| `packages/frontend/src/hooks/useDataSync.tsx` | Create |
| `packages/frontend/src/hooks/useRecordings.ts` | Create |
| `packages/frontend/src/hooks/useProjects.ts` | Create |
| `packages/frontend/src/hooks/useConversations.ts` | Create |
| `packages/frontend/src/hooks/useDashboard.ts` | Create |
| `packages/frontend/src/hooks/useSearchHistory.ts` | Create |
| `packages/frontend/src/app/App.tsx` | Modify |
| `packages/frontend/src/pages/recordings/RecordingsPage.tsx` | Modify |
| `packages/frontend/src/pages/dashboard/Dashboard.tsx` | Modify |
| `packages/frontend/src/pages/projects/ProjectsPage.tsx` | Modify |
| `packages/frontend/src/pages/chats/ChatsPage.tsx` | Modify |
| `packages/frontend/src/pages/search/SearchPage.tsx` | Modify |
| `packages/backend/api/routes/sync.py` | Create |
| `packages/backend/api/routes/recordings.py` | Modify |
| `packages/backend/api/routes/projects.py` | Modify |
| `packages/backend/api/routes/conversations.py` | Modify |
| `packages/backend/api/routes/search.py` | Modify |
| `packages/backend/api/main.py` | Modify (add sync router) |
