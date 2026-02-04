export interface TourStep {
  id: string;
  target: string; // data-tour attribute selector
  title: string;
  description: string;
  position: 'right' | 'left' | 'top' | 'bottom';
  navigateTo?: string; // optional navigation target (page or settings tab)
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'recordings',
    target: '[data-tour="recordings"]',
    title: 'Recordings',
    description: 'Upload audio or video files for AI-powered transcription',
    position: 'right',
  },
  {
    id: 'live',
    target: '[data-tour="live"]',
    title: 'Live Transcription',
    description: 'Start transcribing instantly as you speak — capture meetings, interviews, or thoughts on the fly',
    position: 'right',
  },
  {
    id: 'documents',
    target: '[data-tour="documents"]',
    title: 'Documents',
    description: 'Turn PDFs, images, and scans into searchable text with AI-powered OCR',
    position: 'right',
  },
  {
    id: 'projects',
    target: '[data-tour="projects"]',
    title: 'Projects',
    description: 'Organize your work into projects. Each project is a real folder on your computer — accessible anytime, with or without Verbatim',
    position: 'right',
  },
  {
    id: 'search',
    target: '[data-tour="search"]',
    title: 'Search',
    description: 'Search by keyword or meaning — find what you need across transcripts, documents, and notes',
    position: 'right',
  },
  {
    id: 'browser',
    target: '[data-tour="browser"]',
    title: 'Files',
    description: 'Browse and manage all your files in one place — choose local storage or cloud storage for real-time sync',
    position: 'right',
  },
  {
    id: 'settings',
    target: '[data-tour="settings"]',
    title: 'Settings',
    description: 'Customize Verbatim to fit your workflow — adjust transcription quality, storage locations, and sync preferences',
    position: 'right',
    navigateTo: 'settings',
  },
  {
    id: 'settings-general',
    target: '[data-tour="settings-general"]',
    title: 'General Settings',
    description: 'Personalize your workspace — set your theme, timezone, keyboard shortcuts, and playback preferences',
    position: 'bottom',
    navigateTo: 'settings#general',
  },
  {
    id: 'settings-transcription',
    target: '[data-tour="settings-transcription"]',
    title: 'Transcription Settings',
    description: 'Fine-tune your transcriptions — configure transcription models, languages, and speaker detection',
    position: 'bottom',
    navigateTo: 'settings#transcription',
  },
  {
    id: 'settings-ai',
    target: '[data-tour="settings-ai"]',
    title: 'AI Settings',
    description: 'Choose your AI providers — run models locally or bring your own API keys',
    position: 'bottom',
    navigateTo: 'settings#ai',
  },
  {
    id: 'ai-dependencies',
    target: '[data-tour="settings-ai"]',
    title: 'AI Model Downloads',
    description: 'Download the AI assistant model here to enable chat features. For speaker identification, add a HuggingFace token in Transcription settings. For OCR, download the vision model.',
    position: 'bottom',
    navigateTo: 'settings#ai',
  },
  {
    id: 'settings-system',
    target: '[data-tour="settings-system"]',
    title: 'System Settings',
    description: 'Decide where your data lives — local storage, cloud sync setup, and backup options',
    position: 'bottom',
    navigateTo: 'settings#system',
  },
  {
    id: 'assistant',
    target: '[data-tour="assistant"]',
    title: 'Verbatim Assistant',
    description: 'Quick AI help — ask questions about anything, including how to use this app',
    position: 'top',
  },
  {
    id: 'chats',
    target: '[data-tour="chats"]',
    title: 'Chat History',
    description: 'View and continue your saved conversations with the AI assistant',
    position: 'right',
  },
];

export const TOUR_STORAGE_KEYS = {
  completed: 'verbatim-tour-completed',
  skipped: 'verbatim-tour-skipped',
} as const;
