import { useState, useEffect, useRef } from 'react';
import { useSearchHistory, useClearSearchHistory, useDeleteSearchHistoryEntry } from '@/hooks';

interface SearchHistoryProps {
  onSelectQuery: (query: string) => void;
  compact?: boolean;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function SearchHistory({ onSelectQuery, compact = false }: SearchHistoryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: historyData, isLoading } = useSearchHistory(10);
  const history = historyData?.items ?? [];
  const clearHistory = useClearSearchHistory();
  const deleteEntry = useDeleteSearchHistoryEntry();

  // Close dropdown on click outside
  useEffect(() => {
    if (!compact || !isExpanded) return;

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [compact, isExpanded]);

  const handleClear = () => {
    clearHistory.mutate();
  };

  const handleDelete = (entryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteEntry.mutate(entryId);
  };

  const handleSelect = (query: string) => {
    setIsExpanded(false);
    onSelectQuery(query);
  };

  if (isLoading) {
    return null;
  }

  if (history.length === 0) {
    return null;
  }

  // Compact dropdown mode (shown when results are displayed)
  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <svg
            className="w-4 h-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Recent searches
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isExpanded && (
          <div className="absolute z-10 mt-2 w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
            <ul className="py-1">
              {history.slice(0, 5).map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => handleSelect(entry.query)}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between group"
                  >
                    <span className="truncate text-gray-900 dark:text-gray-100">
                      {entry.query}
                    </span>
                    <button
                      onClick={(e) => handleDelete(entry.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
                      title="Remove from history"
                    >
                      <svg
                        className="w-3 h-3 text-red-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Full grid display mode (shown before first search)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <svg
            className="w-4 h-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Recent Searches
        </h3>
        <button
          onClick={handleClear}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        >
          Clear all
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {history.map((entry) => (
          <button
            key={entry.id}
            onClick={() => handleSelect(entry.query)}
            className="group flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-300 dark:hover:border-gray-600 transition-colors text-left"
          >
            <svg
              className="w-4 h-4 text-gray-400 shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {entry.query}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {entry.result_count} result{entry.result_count !== 1 ? 's' : ''} ·{' '}
                {formatTimeAgo(entry.updated_at)}
              </p>
            </div>
            <button
              onClick={(e) => handleDelete(entry.id, e)}
              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
              title="Remove from history"
            >
              <svg
                className="w-4 h-4 text-red-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </button>
        ))}
      </div>
    </div>
  );
}
