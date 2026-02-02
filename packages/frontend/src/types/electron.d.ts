/**
 * Type declarations for the Electron API exposed via preload script.
 * This file ensures TypeScript knows about window.electronAPI.
 */

interface ElectronAPI {
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
