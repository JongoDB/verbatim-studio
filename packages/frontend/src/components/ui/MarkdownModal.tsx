import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface MarkdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

export function MarkdownModal({ isOpen, onClose, title, content }: MarkdownModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4 text-sm">
            <ReactMarkdown
              components={{
                h2: ({ children }) => (
                  <h3 className="text-base font-semibold text-foreground mt-6 mb-3 first:mt-0">{children}</h3>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-outside ml-5 space-y-2 text-muted-foreground">{children}</ol>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-outside ml-5 space-y-1.5 text-muted-foreground">{children}</ul>
                ),
                li: ({ children }) => (
                  <li className="text-muted-foreground">{children}</li>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline hover:text-blue-300"
                  >
                    {children}
                  </a>
                ),
                p: ({ children }) => (
                  <p className="text-muted-foreground my-2">{children}</p>
                ),
                strong: ({ children }) => (
                  <strong className="text-foreground font-semibold">{children}</strong>
                ),
                code: ({ children, className }) => {
                  // Check if it's a code block (has language class) vs inline code
                  const isBlock = className?.includes('language-') || (typeof children === 'string' && children.includes('\n'));
                  if (isBlock) {
                    return (
                      <code className="block text-amber-400 text-xs font-mono whitespace-pre">{children}</code>
                    );
                  }
                  return (
                    <code className="text-amber-400 bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-muted rounded-lg p-3 overflow-x-auto my-2">{children}</pre>
                ),
                hr: () => (
                  <hr className="border-border my-5" />
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
