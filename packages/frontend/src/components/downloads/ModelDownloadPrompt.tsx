/**
 * First-launch prompt asking users if they want to download models.
 * Shows when models are not cached and prompt hasn't been dismissed.
 */
import { useDownloadStore } from '@/stores/downloadStore';

interface ModelDownloadPromptProps {
  onDownloadNow: () => void;
  missingModels: {
    whisper: boolean;
    ai: boolean;
  };
}

export function ModelDownloadPrompt({ onDownloadNow, missingModels }: ModelDownloadPromptProps) {
  const dismissPrompt = useDownloadStore((state) => state.dismissPrompt);
  const promptDismissed = useDownloadStore((state) => state.promptDismissed);

  // Don't show if already dismissed
  if (promptDismissed) return null;

  // Don't show if no models are missing
  if (!missingModels.whisper && !missingModels.ai) return null;

  const modelList = [];
  if (missingModels.whisper) modelList.push('Whisper (transcription)');
  if (missingModels.ai) modelList.push('AI Assistant');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Download AI Models</h2>
              <p className="text-sm text-white/80">Enhance your experience</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-foreground mb-4">
            For the best experience, Verbatim Studio needs to download some AI models. These run
            locally on your device for privacy and speed.
          </p>

          <div className="bg-muted rounded-lg p-3 mb-4">
            <div className="text-sm font-medium text-foreground mb-2">Models to download:</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              {modelList.map((model) => (
                <li key={model} className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-blue-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {model}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground mb-6">
            Downloads happen in the background. You can continue using the app while they complete.
          </p>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={onDownloadNow}
              className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Download Now
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => dismissPrompt(false)}
                className="flex-1 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Maybe Later
              </button>
              <button
                onClick={() => dismissPrompt(true)}
                className="flex-1 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Don't Ask Again
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
