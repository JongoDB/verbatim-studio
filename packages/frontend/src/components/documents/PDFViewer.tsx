import { useState, useCallback, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { MessageSquarePlus, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PDFViewerProps {
  url: string;
  onSelectionNote?: (selection: { text: string; page: number }) => void;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  highlightText?: string | null;
  onHighlightCleared?: () => void;
}

// Highlight overlay position type
interface HighlightOverlay {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function PDFViewer({ url, onSelectionNote, currentPage = 1, onPageChange, highlightText, onHighlightCleared }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(currentPage);
  const [scale, setScale] = useState(1.0);
  const [selection, setSelection] = useState<{ text: string; page: number } | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightOverlay, setHighlightOverlay] = useState<HighlightOverlay | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastHighlightRef = useRef<string | null>(null);

  // Sync with external currentPage prop
  useEffect(() => {
    if (currentPage !== pageNumber) {
      setPageNumber(currentPage);
    }
  }, [currentPage]);

  // Handle highlight text - search and create overlay for highlight in PDF
  useEffect(() => {
    // Skip if no highlight text or already processing this highlight
    if (!highlightText || highlightText === lastHighlightRef.current) {
      return;
    }

    lastHighlightRef.current = highlightText;

    // Small delay to ensure text layer is rendered
    const timer = setTimeout(() => {
      const textLayer = containerRef.current?.querySelector('.react-pdf__Page__textContent');
      if (textLayer) {
        // Search for the text (use first 50 chars for matching)
        const searchText = highlightText.substring(0, 50).toLowerCase();
        const spans = textLayer.querySelectorAll('span');
        let found = false;

        for (const span of spans) {
          const spanText = span.textContent?.toLowerCase() || '';
          const match1 = spanText.includes(searchText);
          const match2 = searchText.includes(spanText.substring(0, 20));
          if (match1 || match2) {
            // Get the span's position relative to the container
            const spanRect = span.getBoundingClientRect();
            const containerRect = containerRef.current?.getBoundingClientRect();

            if (containerRect) {
              // Create overlay at span's position
              setHighlightOverlay({
                left: spanRect.left - containerRect.left + containerRef.current!.scrollLeft,
                top: spanRect.top - containerRect.top + containerRef.current!.scrollTop,
                width: spanRect.width,
                height: spanRect.height,
              });

              // Scroll the span into view
              span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            found = true;
            break;
          }
        }

        // Clear highlight after 3 seconds
        if (found) {
          setTimeout(() => {
            setHighlightOverlay(null);
            lastHighlightRef.current = null;
            onHighlightCleared?.();
          }, 3000);
        } else {
          // Reset ref if not found so we can try again
          lastHighlightRef.current = null;
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [highlightText, onHighlightCleared]);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  }, []);

  const goToPrevPage = () => {
    const newPage = Math.max(1, pageNumber - 1);
    setPageNumber(newPage);
    onPageChange?.(newPage);
  };

  const goToNextPage = () => {
    const newPage = Math.min(numPages, pageNumber + 1);
    setPageNumber(newPage);
    onPageChange?.(newPage);
  };

  const zoomIn = () => setScale(s => Math.min(2.0, s + 0.1));
  const zoomOut = () => setScale(s => Math.max(0.5, s - 0.1));

  // Handle text selection
  const handleMouseUp = useCallback(() => {
    const selectedText = window.getSelection()?.toString().trim();

    if (selectedText && selectedText.length > 0) {
      // Get selection position for the floating button
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();

        if (containerRect) {
          setSelection({ text: selectedText, page: pageNumber });
          setSelectionPosition({
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top - 40,
          });
        }
      }
    } else {
      setSelection(null);
      setSelectionPosition(null);
    }
  }, [pageNumber]);

  // Clear selection when clicking outside
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.selection-note-button')) {
      // Small delay to allow text selection to complete
      setTimeout(() => {
        const selectedText = window.getSelection()?.toString().trim();
        if (!selectedText) {
          setSelection(null);
          setSelectionPosition(null);
        }
      }, 10);
    }
  }, []);

  const handleAddNote = () => {
    if (selection && onSelectionNote) {
      onSelectionNote(selection);
      // Clear selection
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      setSelectionPosition(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Highlight overlay styles */}
      <style>{`
        .highlight-overlay {
          background-color: rgba(251, 191, 36, 0.5);
          border-radius: 2px;
          pointer-events: none;
          animation: highlight-pulse 1s ease-in-out 3;
        }
        @keyframes highlight-pulse {
          0%, 100% { background-color: rgba(251, 191, 36, 0.5); }
          50% { background-color: rgba(251, 191, 36, 0.8); }
        }
      `}</style>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevPage}
            disabled={pageNumber <= 1}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {pageNumber} / {numPages}
          </span>
          <button
            onClick={goToNextPage}
            disabled={pageNumber >= numPages}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* PDF Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900 relative"
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      >
        <div className="flex justify-center p-4">
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center p-8">
                <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            }
            error={
              <div className="p-8 text-center text-red-500">
                Failed to load PDF
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              className="shadow-lg"
              renderTextLayer={true}
              renderAnnotationLayer={true}
            />
          </Document>
        </div>

        {/* Floating "Add Note" button on selection */}
        {selection && selectionPosition && onSelectionNote && (
          <button
            className="selection-note-button absolute z-20 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg shadow-lg hover:bg-blue-700 transition-colors"
            style={{
              left: selectionPosition.x,
              top: selectionPosition.y,
              transform: 'translateX(-50%)',
            }}
            onClick={handleAddNote}
          >
            <MessageSquarePlus className="h-4 w-4" />
            Add Note
          </button>
        )}

        {/* Highlight overlay for jump-to-anchor */}
        {highlightOverlay && (
          <div
            className="highlight-overlay absolute z-10"
            style={{
              left: highlightOverlay.left,
              top: highlightOverlay.top,
              width: highlightOverlay.width,
              height: highlightOverlay.height,
            }}
          />
        )}
      </div>
    </div>
  );
}
