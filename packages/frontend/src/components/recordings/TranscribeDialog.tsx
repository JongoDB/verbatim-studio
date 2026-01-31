import { useState, useRef, useEffect } from 'react';

interface TranscribeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onTranscribe: (language: string | undefined) => void;
  recordingTitle: string;
}

// Common languages supported by WhisperX
const LANGUAGES = [
  { code: '', label: 'Auto-detect (Recommended)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'cs', label: 'Czech' },
  { code: 'ro', label: 'Romanian' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'el', label: 'Greek' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'fi', label: 'Finnish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'sk', label: 'Slovak' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'he', label: 'Hebrew' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
];

export function TranscribeDialog({
  isOpen,
  onClose,
  onTranscribe,
  recordingTitle,
}: TranscribeDialogProps) {
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleTranscribe = async () => {
    setIsProcessing(true);
    try {
      await onTranscribe(selectedLanguage || undefined);
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2
          id="dialog-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1"
        >
          Transcribe Recording
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 truncate">
          {recordingTitle}
        </p>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="language-select"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Audio Language
            </label>
            <select
              id="language-select"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2.5 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Select the language spoken in the audio for best results, or let the system auto-detect.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleTranscribe}
            disabled={isProcessing}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? (
              <>
                <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Starting...
              </>
            ) : (
              'Start Transcription'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
