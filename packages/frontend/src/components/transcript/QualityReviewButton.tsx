import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface QualityReviewButtonProps {
  transcriptId: string;
  onJobStarted: (jobId: string) => void;
}

type Aggressiveness = 'conservative' | 'moderate' | 'aggressive';

export function QualityReviewButton({ transcriptId, onJobStarted }: QualityReviewButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [contextHint, setContextHint] = useState('');
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>('moderate');
  const popoverRef = useRef<HTMLDivElement>(null);

  const checkAiStatus = useCallback(() => {
    api.ai.status()
      .then((s) => setAiAvailable(s.available))
      .catch(() => setAiAvailable(false));
  }, []);

  useEffect(() => {
    if (isOpen && aiAvailable === null) {
      checkAiStatus();
    }
  }, [isOpen, aiAvailable, checkAiStatus]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const result = await api.qualityReview.start(transcriptId, {
        context_hint: contextHint || undefined,
        aggressiveness,
      });
      setIsOpen(false);
      onJobStarted(result.job_id);
    } catch (err) {
      console.error('Failed to start quality review:', err);
    } finally {
      setIsStarting(false);
    }
  };

  const levels: { value: Aggressiveness; label: string; desc: string }[] = [
    { value: 'conservative', label: 'Conservative', desc: 'Only obvious errors' },
    { value: 'moderate', label: 'Moderate', desc: 'Errors + merges + misheard words' },
    { value: 'aggressive', label: 'Aggressive', desc: 'Full cleanup including fillers' },
  ];

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        title="AI Quality Review"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span className="hidden sm:inline">Review</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
            AI Quality Review
          </h3>

          {aiAvailable === false && (
            <p className="text-sm text-red-500 mb-3">
              AI model not loaded. Configure one in Settings.
            </p>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Context hint (optional)
              </label>
              <input
                type="text"
                value={contextHint}
                onChange={(e) => setContextHint(e.target.value)}
                placeholder="e.g. Medical interview, legal deposition..."
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                Aggressiveness
              </label>
              <div className="flex gap-1">
                {levels.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => setAggressiveness(level.value)}
                    className={`flex-1 px-2 py-1.5 text-xs rounded border transition-colors ${
                      aggressiveness === level.value
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    title={level.desc}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {levels.find(l => l.value === aggressiveness)?.desc}
              </p>
            </div>

            <button
              onClick={handleStart}
              disabled={isStarting || aiAvailable === false}
              className="w-full px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-md transition-colors"
            >
              {isStarting ? 'Starting...' : 'Start Review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
