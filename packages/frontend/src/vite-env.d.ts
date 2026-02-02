/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// File System Access API types (for browsers that support it)
interface FileSystemDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  electronAPI?: {
    platform: NodeJS.Platform;
    getAppVersion: () => Promise<string>;
    getApiUrl: () => Promise<string | null>;
    getApiPort: () => Promise<number | null>;
    getConnectionMode: () => Promise<'local' | 'connected' | 'hybrid'>;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    openDirectoryDialog: () => Promise<string | null>;
    openFileDialog: (options?: {
      filters?: { name: string; extensions: string[] }[];
      multiple?: boolean;
    }) => Promise<string | string[] | null>;
  };
}
