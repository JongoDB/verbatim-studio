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

  // Use refetchType: 'active' to force immediate refetch of active queries
  // This overrides staleTime and ensures UI updates immediately
  const refetchOptions = { refetchType: 'active' as const };

  switch (resource) {
    case 'recordings':
      queryClient.invalidateQueries({ queryKey: queryKeys.recordings.all, ...refetchOptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats, ...refetchOptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all, ...refetchOptions });
      break;

    case 'projects':
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all, ...refetchOptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats, ...refetchOptions });
      break;

    case 'conversations':
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all, ...refetchOptions });
      break;

    case 'search_history':
      queryClient.invalidateQueries({ queryKey: queryKeys.search.history, ...refetchOptions });
      break;

    case 'documents':
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all, ...refetchOptions });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats, ...refetchOptions });
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
