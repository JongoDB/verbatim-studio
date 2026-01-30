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
      onClick={onClick}
      className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
        aiAvailable
          ? 'bg-blue-600 hover:bg-blue-700 hover:scale-105'
          : 'bg-gray-400 cursor-not-allowed'
      }`}
      disabled={aiAvailable !== true}
      aria-label={aiAvailable ? 'Open Verbatim Assistant' : 'AI not available'}
      title={aiAvailable ? 'Verbatim Assistant' : 'AI not available'}
    >
      {/* Sparkle icon */}
      <svg
        className="w-7 h-7 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      {/* Pulse animation when available */}
      {aiAvailable && (
        <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-25" />
      )}
    </button>
  );
}
