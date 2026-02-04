import { createPortal } from 'react-dom';

export interface Release {
  version: string;
  notes: string;
}

export interface WhatsNewDialogProps {
  releases: Release[];
  onDismiss: () => void;
}

/**
 * Simple markdown renderer for release notes.
 * Supports:
 * - ### Header -> h4
 * - ## Header -> h3
 * - - item or * item -> list items
 * - **text** -> bold
 * - Empty lines -> br
 */
function renderMarkdown(notes: string): React.ReactNode[] {
  const lines = notes.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="list-disc list-inside space-y-1 mb-3">
          {listItems}
        </ul>
      );
      listItems = [];
    }
  };

  const renderBold = (text: string): React.ReactNode => {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-semibold">
          {part}
        </strong>
      ) : (
        part
      )
    );
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Empty line
    if (trimmed === '') {
      flushList();
      elements.push(<br key={`br-${index}`} />);
      return;
    }

    // h3: ## Header
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h3
          key={`h3-${index}`}
          className="text-base font-semibold text-foreground mb-2"
        >
          {renderBold(trimmed.slice(3))}
        </h3>
      );
      return;
    }

    // h4: ### Header
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h4
          key={`h4-${index}`}
          className="text-sm font-semibold text-foreground mb-2"
        >
          {renderBold(trimmed.slice(4))}
        </h4>
      );
      return;
    }

    // List item: - item or * item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listItems.push(
        <li key={`li-${index}`} className="text-sm text-muted-foreground">
          {renderBold(trimmed.slice(2))}
        </li>
      );
      return;
    }

    // Regular text
    flushList();
    elements.push(
      <p key={`p-${index}`} className="text-sm text-muted-foreground mb-2">
        {renderBold(trimmed)}
      </p>
    );
  });

  // Flush any remaining list items
  flushList();

  return elements;
}

export function WhatsNewDialog({ releases, onDismiss }: WhatsNewDialogProps) {
  const handleGotIt = () => {
    if (window.electronAPI && releases.length > 0) {
      window.electronAPI.whatsNewSeen(releases[0].version);
    }
    onDismiss();
  };

  const handleClose = () => {
    handleGotIt();
  };

  if (releases.length === 0) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-lg mx-4 bg-card border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col"
        style={{ maxHeight: '80vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2
            id="whats-new-title"
            className="text-lg font-semibold text-foreground"
          >
            What's New
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4">
          {releases.map((release, index) => (
            <div
              key={release.version}
              className={
                index < releases.length - 1
                  ? 'pb-4 mb-4 border-b border-border'
                  : ''
              }
            >
              <div className="text-sm font-medium text-foreground mb-2">
                v{release.version}
              </div>
              <div>{renderMarkdown(release.notes)}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border shrink-0">
          <div className="flex justify-center">
            <button
              onClick={handleGotIt}
              className="px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
