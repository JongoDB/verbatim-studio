import { useState, useCallback, useRef, useEffect } from 'react';
import { renderAsync } from 'docx-preview';
import { MessageSquarePlus } from 'lucide-react';
import { api } from '@/lib/api';

interface DOCXViewerProps {
  documentId: string;
  onSelectionNote?: (selection: { text: string; page: number }) => void;
  highlightText?: string | null;
  onHighlightCleared?: () => void;
}

interface HighlightOverlay {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function DOCXViewer({ documentId, onSelectionNote, highlightText, onHighlightCleared }: DOCXViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ text: string; page: number } | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightOverlay, setHighlightOverlay] = useState<HighlightOverlay | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastHighlightRef = useRef<string | null>(null);

  // Render DOCX into DOM and post-process with data-page-index attributes
  useEffect(() => {
    async function render() {
      if (!contentRef.current) return;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(api.documents.getFileUrl(documentId));
        const blob = await response.blob();

        const target = contentRef.current;
        while (target.firstChild) {
          target.removeChild(target.firstChild);
        }

        await renderAsync(blob, target, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: true,
          trimXmlDeclaration: true,
          useBase64URL: true,
        });

        // Post-process: add data-page-index to each section.docx element
        const sections = target.querySelectorAll('section.docx');
        sections.forEach((section, idx) => {
          section.setAttribute('data-page-index', String(idx + 1));
        });
      } catch (err) {
        console.error('Failed to render DOCX:', err);
        setError('Failed to render document');
      } finally {
        setLoading(false);
      }
    }

    render();
  }, [documentId]);

  // Find which page (section) contains a given node
  const getPageForNode = useCallback((node: Node): number => {
    let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
    while (el && el !== contentRef.current) {
      if (el.tagName === 'SECTION' && el.hasAttribute('data-page-index')) {
        return parseInt(el.getAttribute('data-page-index')!, 10);
      }
      el = el.parentElement;
    }
    return 1;
  }, []);

  // Handle text selection for notes
  const handleMouseUp = useCallback(() => {
    const selectedText = window.getSelection()?.toString().trim();

    if (selectedText && selectedText.length > 0) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();

        if (containerRect) {
          const page = getPageForNode(range.startContainer);
          setSelection({ text: selectedText, page });
          setSelectionPosition({
            x: rect.left - containerRect.left + rect.width / 2 + (containerRef.current?.scrollLeft || 0),
            y: rect.top - containerRect.top - 40 + (containerRef.current?.scrollTop || 0),
          });
        }
      }
    } else {
      setSelection(null);
      setSelectionPosition(null);
    }
  }, [getPageForNode]);

  // Clear selection when clicking outside the button
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.selection-note-button')) {
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
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      setSelectionPosition(null);
    }
  };

  // Handle highlight text — search rendered DOM and create overlay
  useEffect(() => {
    if (!highlightText || highlightText === lastHighlightRef.current || !contentRef.current) {
      return;
    }

    lastHighlightRef.current = highlightText;

    let clearTimer: ReturnType<typeof setTimeout>;

    const timer = setTimeout(() => {
      const searchText = highlightText.substring(0, 50).toLowerCase();

      // Walk all text-containing elements in the rendered DOCX
      const walker = document.createTreeWalker(
        contentRef.current!,
        NodeFilter.SHOW_TEXT,
        null,
      );

      let found = false;
      let textNode: Node | null;
      while ((textNode = walker.nextNode())) {
        const nodeText = textNode.textContent?.toLowerCase() || '';
        if (nodeText.includes(searchText) || (nodeText.length >= 20 && searchText.includes(nodeText.substring(0, 20)))) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          const rect = range.getBoundingClientRect();
          const containerRect = containerRef.current?.getBoundingClientRect();

          if (containerRect && rect.width > 0) {
            setHighlightOverlay({
              left: rect.left - containerRect.left + containerRef.current!.scrollLeft,
              top: rect.top - containerRect.top + containerRef.current!.scrollTop,
              width: rect.width,
              height: rect.height,
            });

            // Scroll into view
            (textNode.parentElement as HTMLElement)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            found = true;
            break;
          }
        }
      }

      if (found) {
        clearTimer = setTimeout(() => {
          setHighlightOverlay(null);
          lastHighlightRef.current = null;
          onHighlightCleared?.();
        }, 3000);
      } else {
        lastHighlightRef.current = null;
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [highlightText, onHighlightCleared]);

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
        .docx-container .docx-wrapper {
          background: white;
          padding: 20px;
        }
        .docx-container .docx-wrapper > section.docx {
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          margin-bottom: 20px;
        }
      `}</style>

      {/* DOCX Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900 relative"
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-800 z-10">
            <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {error && (
          <div className="p-8 text-center text-red-500">{error}</div>
        )}

        <div
          ref={contentRef}
          className="docx-container"
        />

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
