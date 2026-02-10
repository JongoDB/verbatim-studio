import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type OAuthStatusResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

interface OAuthConnectButtonProps {
  provider: 'gdrive' | 'onedrive' | 'dropbox';
  onSuccess: (tokens: OAuthStatusResponse['tokens']) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  className?: string;
}

const PROVIDER_CONFIG = {
  gdrive: {
    name: 'Google',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
    bgColor: 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600',
    textColor: 'text-gray-700 dark:text-gray-200',
  },
  onedrive: {
    name: 'Microsoft',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 23 23" fill="none">
        <rect width="11" height="11" fill="#F25022"/>
        <rect x="12" width="11" height="11" fill="#7FBA00"/>
        <rect y="12" width="11" height="11" fill="#00A4EF"/>
        <rect x="12" y="12" width="11" height="11" fill="#FFB900"/>
      </svg>
    ),
    bgColor: 'bg-[#2F2F2F] hover:bg-[#3F3F3F]',
    textColor: 'text-white',
  },
  dropbox: {
    name: 'Dropbox',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="white">
        <path d="M12 6.134L6.069 9.797 12 13.459l5.931-3.662L12 6.134zm-5.931 9.795l5.931 3.662 5.931-3.662-5.931-3.662-5.931 3.662zM12 2.471L6.069 6.134 12 9.797l5.931-3.663L12 2.471zM6.069 10.33L.138 6.669 6.069 3 12 6.663 6.069 10.33zm11.862 0L12 6.663 17.931 3l5.931 3.669-5.931 3.661z"/>
      </svg>
    ),
    bgColor: 'bg-[#0061FF] hover:bg-[#0052D9]',
    textColor: 'text-white',
  },
};

export function OAuthConnectButton({
  provider,
  onSuccess,
  onError,
  disabled = false,
  className,
}: OAuthConnectButtonProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [pollState, setPollState] = useState<string | null>(null);

  const config = PROVIDER_CONFIG[provider];

  // Cancel OAuth flow and release port
  const cancelOAuth = useCallback(async (state: string) => {
    try {
      await api.oauth.cancel(state);
    } catch {
      // Ignore errors - flow may already be complete
    }
  }, []);

  // Track the active state so we can cancel on true unmount only
  const activeStateRef = useRef<string | null>(null);
  activeStateRef.current = pollState;

  // Cancel OAuth on true component unmount only (not on effect re-runs)
  useEffect(() => {
    return () => {
      if (activeStateRef.current) {
        cancelOAuth(activeStateRef.current);
      }
    };
  }, [cancelOAuth]);

  // Poll for OAuth completion
  useEffect(() => {
    if (!pollState) return;

    const pollInterval = setInterval(async () => {
      try {
        const status = await api.oauth.status(pollState);

        if (status.status === 'complete' && status.tokens) {
          clearInterval(pollInterval);
          setIsConnecting(false);
          setPollState(null);
          onSuccess(status.tokens);
        } else if (status.status === 'error') {
          clearInterval(pollInterval);
          setIsConnecting(false);
          setPollState(null);
          onError?.(status.error || 'Authentication failed');
        } else if (status.status === 'cancelled' || status.status === 'timeout') {
          clearInterval(pollInterval);
          setIsConnecting(false);
          setPollState(null);
          onError?.(status.error || 'Authentication was cancelled');
        }
      } catch {
        // Continue polling - state might not be ready yet
      }
    }, 1000);

    // Stop polling after 5 minutes
    const timeout = setTimeout(async () => {
      clearInterval(pollInterval);
      await cancelOAuth(pollState);
      setIsConnecting(false);
      setPollState(null);
      onError?.('Authentication timed out');
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [pollState, onSuccess, onError, cancelOAuth]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);

    try {
      const response = await api.oauth.start({ provider });

      // Open auth URL in new window
      const authWindow = window.open(
        response.auth_url,
        'oauth',
        'width=600,height=700,menubar=no,toolbar=no,location=no,status=no'
      );

      // Check if window was blocked
      if (!authWindow) {
        // Cancel OAuth to release backend resources (callback server, state)
        await api.oauth.cancel(response.state);
        setIsConnecting(false);
        onError?.('Pop-up blocked. Please allow pop-ups and try again.');
        return;
      }

      // Only start polling AFTER confirming window opened successfully
      setPollState(response.state);

      // Monitor window close — use ref to avoid stale closure over isConnecting
      const checkClosed = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(checkClosed);
          // Give polling a brief chance to catch the result, then cancel
          setTimeout(async () => {
            // activeStateRef tracks current pollState without stale closure issues
            if (activeStateRef.current) {
              try {
                const status = await api.oauth.status(response.state);
                if (status.status === 'pending') {
                  // User closed without completing - cancel to release port
                  await api.oauth.cancel(response.state);
                  setIsConnecting(false);
                  setPollState(null);
                }
              } catch {
                // State may be gone, that's fine
                setIsConnecting(false);
                setPollState(null);
              }
            }
          }, 1500);
        }
      }, 500);
    } catch (err) {
      setIsConnecting(false);
      onError?.(err instanceof Error ? err.message : 'Failed to start authentication');
    }
  }, [provider, onError]);

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={disabled || isConnecting}
      className={cn(
        'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors',
        config.bgColor,
        config.textColor,
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {isConnecting ? (
        <>
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Connecting...</span>
        </>
      ) : (
        <>
          {config.icon}
          <span>Connect with {config.name}</span>
        </>
      )}
    </button>
  );
}
