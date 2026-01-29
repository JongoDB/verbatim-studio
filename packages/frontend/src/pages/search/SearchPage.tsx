import { useState, useEffect, useCallback } from 'react';
import { api, type GlobalSearchResult } from '@/lib/api';

interface SearchPageProps {
  onResultClick: (result: GlobalSearchResult) => void;
  initialQuery?: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

type FilterType = 'all' | 'recording' | 'segment';
type MatchType = 'all' | 'keyword' | 'semantic';

export function SearchPage({ onResultClick, initialQuery = '' }: SearchPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [matchType, setMatchType] = useState<MatchType>('all');

  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    try {
      const response = await api.search.global(searchQuery);
      setResults(response.results);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Search on initial query
  useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery);
    }
  }, [initialQuery, performSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query);
  };

  // Filter results
  const filteredResults = results.filter((result) => {
    if (filterType !== 'all' && result.type !== filterType) return false;
    if (matchType !== 'all' && result.match_type !== matchType) return false;
    return true;
  });

  // Group results by recording
  const groupedResults = filteredResults.reduce((acc, result) => {
    const key = result.recording_id;
    if (!acc[key]) {
      acc[key] = {
        recordingTitle: result.recording_title,
        recordingId: result.recording_id,
        items: [],
      };
    }
    acc[key].items.push(result);
    return acc;
  }, {} as Record<string, { recordingTitle: string; recordingId: string; items: GlobalSearchResult[] }>);

  const recordingCount = Object.keys(groupedResults).length;
  const segmentCount = filteredResults.filter(r => r.type === 'segment').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Search</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Search across all your recordings and transcripts
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for keywords or phrases..."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-3 pl-12 pr-4 text-base text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading || query.trim().length < 2}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              'Search'
            )}
          </button>
        </div>

        {/* Filters */}
        {hasSearched && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Type:</span>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
                {(['all', 'recording', 'segment'] as FilterType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFilterType(type)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      filterType === type
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {type === 'all' ? 'All' : type === 'recording' ? 'Recordings' : 'Segments'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">Match:</span>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
                {(['all', 'keyword', 'semantic'] as MatchType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setMatchType(type)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      matchType === type
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {type === 'all' ? 'All' : type === 'keyword' ? 'Keyword' : 'Semantic'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </form>

      {/* Results */}
      {hasSearched && (
        <div className="space-y-4">
          {/* Results summary */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {filteredResults.length === 0 ? (
                'No results found'
              ) : (
                <>
                  Found {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''} in{' '}
                  {recordingCount} recording{recordingCount !== 1 ? 's' : ''}
                  {segmentCount > 0 && ` (${segmentCount} segment match${segmentCount !== 1 ? 'es' : ''})`}
                </>
              )}
            </p>
          </div>

          {/* Results list grouped by recording */}
          {filteredResults.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">No results found</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Try different keywords or check the spelling
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.values(groupedResults).map((group) => (
                <div
                  key={group.recordingId}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
                >
                  {/* Recording header */}
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">
                        {highlightMatch(group.recordingTitle, query)}
                      </h3>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        ({group.items.length} match{group.items.length !== 1 ? 'es' : ''})
                      </span>
                    </div>
                  </div>

                  {/* Results in this recording */}
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {group.items.map((result, index) => (
                      <li key={`${result.type}-${result.id}-${index}`}>
                        <button
                          onClick={() => onResultClick(result)}
                          className="w-full px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <div className="flex items-start gap-3">
                            {/* Icon */}
                            <div className={`flex-shrink-0 mt-0.5 ${
                              result.type === 'recording' ? 'text-blue-500' : 'text-green-500'
                            }`}>
                              {result.type === 'recording' ? (
                                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                </svg>
                              ) : (
                                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                </svg>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              {/* Segment text */}
                              {result.type === 'segment' && result.text ? (
                                <p className="text-sm text-gray-900 dark:text-gray-100">
                                  {highlightMatch(result.text, query)}
                                </p>
                              ) : (
                                <p className="text-sm text-gray-900 dark:text-gray-100">
                                  Recording title match
                                </p>
                              )}

                              {/* Meta info */}
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                <span className={`px-2 py-0.5 rounded-full ${
                                  result.type === 'recording'
                                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                }`}>
                                  {result.type === 'recording' ? 'Recording' : 'Segment'}
                                </span>
                                {result.match_type === 'semantic' && (
                                  <span className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                                    Semantic match
                                  </span>
                                )}
                                {result.match_type === 'keyword' && (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                                    Keyword match
                                  </span>
                                )}
                                {result.start_time !== null && (
                                  <span className="text-gray-500 dark:text-gray-400">
                                    at {formatTime(result.start_time)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Arrow */}
                            <div className="flex-shrink-0 text-gray-400">
                              <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Initial state */}
      {!hasSearched && (
        <div className="text-center py-12">
          <svg className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">Search your transcripts</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Enter keywords to find matching recordings and transcript segments.
            Semantic search finds related content even without exact keyword matches.
          </p>
        </div>
      )}
    </div>
  );
}
