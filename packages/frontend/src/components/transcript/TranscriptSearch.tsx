import { useState, useEffect, useRef, useCallback } from 'react';

interface Match {
  segmentId: string;
  segmentIndex: number;
  startIndex: number;
  endIndex: number;
}

interface TranscriptSearchProps {
  segments: Array<{ id: string; text: string }>;
  onClose: () => void;
  onMatchChange: (matches: Match[], currentIndex: number) => void;
  onScrollToSegment: (segmentIndex: number) => void;
}

export function TranscriptSearch({
  segments,
  onClose,
  onMatchChange,
  onScrollToSegment,
}: TranscriptSearchProps) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Find matches when query changes (debounced)
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      setCurrentIndex(0);
      onMatchChange([], -1);
      return;
    }

    const timer = setTimeout(() => {
      const newMatches: Match[] = [];
      const searchTerm = query.toLowerCase();

      segments.forEach((segment, segmentIndex) => {
        const text = segment.text.toLowerCase();
        let startIdx = 0;
        let foundIdx = text.indexOf(searchTerm, startIdx);

        while (foundIdx !== -1) {
          newMatches.push({
            segmentId: segment.id,
            segmentIndex,
            startIndex: foundIdx,
            endIndex: foundIdx + query.length,
          });
          startIdx = foundIdx + 1;
          foundIdx = text.indexOf(searchTerm, startIdx);
        }
      });

      setMatches(newMatches);
      setCurrentIndex(newMatches.length > 0 ? 0 : -1);
      onMatchChange(newMatches, newMatches.length > 0 ? 0 : -1);

      // Scroll to first match
      if (newMatches.length > 0) {
        onScrollToSegment(newMatches[0].segmentIndex);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, segments, onMatchChange, onScrollToSegment]);

  const goToMatch = useCallback((index: number) => {
    if (matches.length === 0) return;
    const newIndex = ((index % matches.length) + matches.length) % matches.length;
    setCurrentIndex(newIndex);
    onMatchChange(matches, newIndex);
    onScrollToSegment(matches[newIndex].segmentIndex);
  }, [matches, onMatchChange, onScrollToSegment]);

  const handleNext = useCallback(() => {
    goToMatch(currentIndex + 1);
  }, [currentIndex, goToMatch]);

  const handlePrev = useCallback(() => {
    goToMatch(currentIndex - 1);
  }, [currentIndex, goToMatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    } else if (e.key === 'g' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-lg shadow-lg">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in transcript..."
          className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Match counter */}
      <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[70px] text-center">
        {query.trim() ? (
          matches.length > 0 ? (
            `${currentIndex + 1} of ${matches.length}`
          ) : (
            'No matches'
          )
        ) : (
          ''
        )}
      </span>

      {/* Navigation buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handlePrev}
          disabled={matches.length === 0}
          className="min-w-touch min-h-touch flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Previous match (Shift+Enter)"
        >
          <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={handleNext}
          disabled={matches.length === 0}
          className="min-w-touch min-h-touch flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Next match (Enter)"
        >
          <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="min-w-touch min-h-touch flex items-center justify-center rounded hover:bg-muted transition-colors"
        title="Close (Esc)"
      >
        <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// Helper function to highlight text with search matches
export function highlightSearchMatches(
  text: string,
  segmentId: string,
  matches: Match[],
  currentMatchIndex: number
): React.ReactNode {
  const segmentMatches = matches.filter(m => m.segmentId === segmentId);

  if (segmentMatches.length === 0) {
    return text;
  }

  // Sort matches by start index
  const sortedMatches = [...segmentMatches].sort((a, b) => a.startIndex - b.startIndex);

  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  sortedMatches.forEach((match) => {
    // Add text before this match
    if (match.startIndex > lastEnd) {
      parts.push(text.slice(lastEnd, match.startIndex));
    }

    // Determine if this is the current match
    const globalIndex = matches.findIndex(
      m => m.segmentId === match.segmentId && m.startIndex === match.startIndex
    );
    const isCurrent = globalIndex === currentMatchIndex;

    // Add the highlighted match
    parts.push(
      <mark
        key={`${match.segmentId}-${match.startIndex}`}
        className={isCurrent
          ? 'bg-orange-400 dark:bg-orange-600 rounded px-0.5'
          : 'bg-yellow-200 dark:bg-yellow-700 rounded px-0.5'
        }
      >
        {text.slice(match.startIndex, match.endIndex)}
      </mark>
    );

    lastEnd = match.endIndex;
  });

  // Add remaining text
  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }

  return <>{parts}</>;
}
