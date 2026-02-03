import { useState, useRef, useEffect } from 'react';
import { api, type GlobalSearchResult } from '@/lib/api';

interface SearchBoxProps {
  onResultClick?: (result: GlobalSearchResult) => void;
  placeholder?: string;
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function highlightMatch(text: string | null | undefined, query: string): React.ReactNode {
  if (!text) return text;
  if (!query.trim()) return text;

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function SearchBox({ onResultClick, placeholder = 'Search files and content...' }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  // Search when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim().length < 2) {
      setResults([]);
      return;
    }

    const search = async () => {
      setIsLoading(true);
      try {
        const response = await api.search.global(debouncedQuery);
        setResults(response.results);
        setSelectedIndex(-1);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    search();
  }, [debouncedQuery]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const handleSelect = (result: GlobalSearchResult) => {
    setIsOpen(false);
    setQuery('');
    onResultClick?.(result);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 pl-10 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          {isLoading ? (
            <svg className="h-5 w-5 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </div>
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
          >
            <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {isOpen && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-2 w-full max-h-96 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {results.length === 0 && !isLoading ? (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No results found for "{query}"
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {results.map((result, index) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    onClick={() => handleSelect(result)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      index === selectedIndex
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon based on type */}
                      <div className={`flex-shrink-0 mt-0.5 ${
                        result.type === 'recording'
                          ? 'text-blue-500'
                          : result.type === 'document'
                          ? 'text-purple-500'
                          : result.type === 'note'
                          ? 'text-amber-500'
                          : result.type === 'conversation'
                          ? 'text-cyan-500'
                          : 'text-green-500'
                      }`}>
                        {result.type === 'recording' ? (
                          <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        ) : result.type === 'document' ? (
                          <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        ) : result.type === 'note' ? (
                          <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                          </svg>
                        ) : result.type === 'conversation' ? (
                          <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        ) : (
                          <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Title */}
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {result.type === 'recording'
                            ? highlightMatch(result.recording_title, query)
                            : result.type === 'document'
                            ? highlightMatch(result.document_title || result.title, query)
                            : result.type === 'note'
                            ? (result.document_title || result.recording_title || 'Note')
                            : result.type === 'conversation'
                            ? highlightMatch(result.conversation_title || result.title || 'Untitled Chat', query)
                            : result.recording_title
                          }
                        </div>

                        {/* Text preview (for segment, document, note, or conversation) */}
                        {(result.type === 'segment' || result.type === 'document' || result.type === 'note' || result.type === 'conversation') && result.text && (
                          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                            {highlightMatch(result.text, query)}
                          </div>
                        )}

                        {/* Meta info */}
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className={`px-1.5 py-0.5 rounded ${
                            result.type === 'recording'
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : result.type === 'document'
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                              : result.type === 'note'
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : result.type === 'conversation'
                              ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                              : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          }`}>
                            {result.type === 'recording' ? 'Recording' : result.type === 'document' ? 'Document' : result.type === 'note' ? 'Note' : result.type === 'conversation' ? 'Chat' : 'Segment'}
                          </span>
                          {result.type === 'conversation' && result.message_role && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                              {result.message_role === 'user' ? 'You' : 'Assistant'}
                            </span>
                          )}
                          {result.match_type === 'semantic' && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                              semantic
                            </span>
                          )}
                          {result.start_time !== null && (
                            <span>at {formatTime(result.start_time)}</span>
                          )}
                          {result.type === 'note' && result.anchor_type && (
                            <span>
                              {result.anchor_type === 'page' ? `Page ${(result.anchor_data as Record<string, unknown>)?.page || ''}` :
                               result.anchor_type === 'selection' ? 'Selection' :
                               result.anchor_type}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
