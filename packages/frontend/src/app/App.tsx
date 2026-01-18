import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ApiInfo {
  name: string;
  version: string;
  mode: string;
}

interface HealthStatus {
  status: string;
  services: Record<string, string>;
}

export function App() {
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkBackend() {
      try {
        const [info, healthStatus] = await Promise.all([
          api.info(),
          api.health.ready(),
        ]);
        setApiInfo(info);
        setHealth(healthStatus);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to backend');
      }
    }

    checkBackend();
    const interval = setInterval(checkBackend, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold text-foreground">Verbatim Studio</h1>
        <p className="text-muted-foreground">
          Privacy-first transcription for professionals
        </p>

        <div className="mt-8 p-6 rounded-lg border bg-card">
          <h2 className="text-lg font-semibold mb-4">Backend Status</h2>

          {error ? (
            <div className="text-destructive">
              <p className="font-medium">Connection Error</p>
              <p className="text-sm">{error}</p>
              <p className="text-sm mt-2 text-muted-foreground">
                Make sure the backend is running on port 8000
              </p>
            </div>
          ) : apiInfo ? (
            <div className="space-y-2 text-left">
              <div className="flex justify-between">
                <span className="text-muted-foreground">API:</span>
                <span className="font-mono">{apiInfo.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version:</span>
                <span className="font-mono">{apiInfo.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode:</span>
                <span className="font-mono">{apiInfo.mode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span
                  className={`font-mono ${health?.status === 'ready' ? 'text-green-600' : 'text-yellow-600'}`}
                >
                  {health?.status || 'checking...'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Connecting...</p>
          )}
        </div>
      </div>
    </div>
  );
}
