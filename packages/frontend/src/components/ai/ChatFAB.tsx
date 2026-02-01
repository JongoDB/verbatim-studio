import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface ChatFABProps {
  onClick: () => void;
  isOpen: boolean;
}

export function ChatFAB({ onClick, isOpen }: ChatFABProps) {
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    api.ai.status()
      .then((s) => setAiAvailable(s.available))
      .catch(() => setAiAvailable(false));
  }, []);

  if (isOpen) return null; // Hide FAB when panel is open

  return (
    <button
      data-tour="assistant"
      onClick={onClick}
      className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
        aiAvailable
          ? 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 hover:scale-105 hover:shadow-xl'
          : 'bg-gray-400 cursor-not-allowed'
      }`}
      disabled={aiAvailable !== true}
      aria-label={aiAvailable ? 'Open Verbatim Assistant' : 'AI not available'}
      title={aiAvailable ? 'Verbatim Assistant' : 'AI not available'}
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
  );
}
