import { TOUR_STORAGE_KEYS } from './tourSteps';

interface TourSectionProps {
  onStartTour: () => void;
}

export function TourSection({ onStartTour }: TourSectionProps) {
  const hasCompletedOrSkipped =
    localStorage.getItem(TOUR_STORAGE_KEYS.completed) === 'true' ||
    localStorage.getItem(TOUR_STORAGE_KEYS.skipped) === 'true';

  if (hasCompletedOrSkipped) {
    // Show subtle "Retake tour" link
    return (
      <div className="text-center py-2">
        <button
          onClick={onStartTour}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Retake the tour
        </button>
      </div>
    );
  }

  // Show full "New to Verbatim Studio?" section
  return (
    <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
      <div className="text-3xl mb-4">
        <span role="img" aria-label="Sparkles">✨</span>
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
        New to Verbatim Studio?
      </h3>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Take a quick guided tour to discover all the features
      </p>
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onStartTour}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          Start Tour
        </button>
        <button
          onClick={() => {
            localStorage.setItem(TOUR_STORAGE_KEYS.skipped, 'true');
            // Force re-render by dispatching a storage event
            window.dispatchEvent(new Event('storage'));
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
