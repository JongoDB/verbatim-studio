export interface TourStep {
  id: string;
  target: string; // data-tour attribute selector
  title: string;
  description: string;
  position: 'right' | 'left' | 'top' | 'bottom';
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
    description: 'Real-time transcription as you speak—perfect for meetings',
    position: 'right',
  },
  {
    id: 'documents',
    target: '[data-tour="documents"]',
    title: 'Documents',
    description: 'Extract and search text from PDFs, images, and scanned files',
    position: 'right',
  },
  {
    id: 'projects',
    target: '[data-tour="projects"]',
    title: 'Projects',
    description: 'Organize your transcripts and documents into folders',
    position: 'right',
  },
  {
    id: 'chats',
    target: '[data-tour="chats"]',
    title: 'Chats',
    description: 'Have AI conversations about your transcripts',
    position: 'right',
  },
  {
    id: 'search',
    target: '[data-tour="search"]',
    title: 'Search',
    description: 'Find anything across all your content instantly',
    position: 'right',
  },
  {
    id: 'browser',
    target: '[data-tour="browser"]',
    title: 'Files',
    description: 'Browse and manage all your files in one place',
    position: 'right',
  },
  {
    id: 'settings',
    target: '[data-tour="settings"]',
    title: 'Settings',
    description: 'Configure transcription, AI models, appearance, and more',
    position: 'right',
  },
  {
    id: 'assistant',
    target: '[data-tour="assistant"]',
    title: 'Assistant',
    description: 'Quick AI help—ask questions about anything, including how to use this app',
    position: 'top',
  },
];

export const TOUR_STORAGE_KEYS = {
  completed: 'verbatim-tour-completed',
  skipped: 'verbatim-tour-skipped',
} as const;
