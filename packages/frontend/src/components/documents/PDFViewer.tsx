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
}

export function PDFViewer({ url, onSelectionNote, currentPage = 1, onPageChange }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(currentPage);
  const [scale, setScale] = useState(1.0);
  const [selection, setSelection] = useState<{ text: string; page: number } | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with external currentPage prop
  useEffect(() => {
    if (currentPage !== pageNumber) {
      setPageNumber(currentPage);
    }
  }, [currentPage]);

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
      </div>
    </div>
  );
}
