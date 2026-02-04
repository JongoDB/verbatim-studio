import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface ChatFABProps {
  onClick: () => void;
  isOpen: boolean;
}

export function ChatFAB({ onClick, isOpen }: ChatFABProps) {
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const checkAiStatus = useCallback(() => {
    api.ai.status()
      .then((s) => setAiAvailable(s.available))
      .catch(() => setAiAvailable(false));
  }, []);

  // Check on mount
  useEffect(() => {
    checkAiStatus();
  }, [checkAiStatus]);

  // Re-check when page becomes visible (e.g., returning from settings after downloading a model)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAiStatus();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [checkAiStatus]);

  // Listen for custom event when AI status changes (e.g., after model activation)
  useEffect(() => {
    const handleAiStatusChange = () => checkAiStatus();
    window.addEventListener('ai-status-changed', handleAiStatusChange);
    return () => window.removeEventListener('ai-status-changed', handleAiStatusChange);
  }, [checkAiStatus]);

  if (isOpen) return null; // Hide FAB when panel is open

  return (
    <div
      className="fixed bottom-6 right-6 z-40"
      onMouseEnter={() => !aiAvailable && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Tooltip when AI unavailable */}
      {showTooltip && !aiAvailable && (
        <div className="absolute bottom-full right-0 mb-2 w-64 px-3 py-2 text-sm bg-gray-900 dark:bg-gray-700 text-white rounded-lg shadow-lg pointer-events-none">
          <div className="font-medium mb-1">AI Assistant Unavailable</div>
          <div className="text-gray-300 text-xs">Download an AI model in Settings → AI to use the assistant</div>
          <div className="absolute bottom-0 right-6 translate-y-1/2 rotate-45 w-2 h-2 bg-gray-900 dark:bg-gray-700"></div>
        </div>
      )}
      <button
        data-tour="assistant"
        onClick={onClick}
        className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          aiAvailable
            ? 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 hover:scale-105 hover:shadow-xl'
            : 'bg-gray-400 cursor-not-allowed'
        }`}
        disabled={aiAvailable !== true}
        aria-label={aiAvailable ? 'Open Verbatim Assistant' : 'AI not available - download model in Settings'}
      >
      {/* Chat bubble with sparkle */}
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        {/* Chat bubble */}
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
        />
        {/* Small sparkle accent */}
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.5 4l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5.5-1z"
          fill="currentColor"
          strokeWidth="0"
        />
      </svg>
    </button>
    </div>
  );
}
