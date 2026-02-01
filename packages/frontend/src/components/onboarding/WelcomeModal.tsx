import { createPortal } from 'react-dom';

interface WelcomeModalProps {
  isOpen: boolean;
  onStartTour: () => void;
  onSkip: () => void;
}

export function WelcomeModal({ isOpen, onStartTour, onSkip }: WelcomeModalProps) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-description"
      >
        <div className="p-8 text-center">
          {/* Wave emoji */}
          <div className="text-5xl mb-4">
            <span role="img" aria-label="Wave">👋</span>
          </div>

          {/* Title */}
          <h2 id="welcome-title" className="text-2xl font-bold text-foreground mb-3">
            Welcome to Verbatim Studio
          </h2>

          {/* Description */}
          <p id="welcome-description" className="text-muted-foreground mb-2">
            Your AI-powered workspace for transcription, documents, and intelligent search.
          </p>
          <p className="text-muted-foreground mb-8">
            Would you like a quick tour of the features?
          </p>

          {/* Actions */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={onStartTour}
              className="px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Start Tour
            </button>
            <button
              onClick={onSkip}
              className="px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
