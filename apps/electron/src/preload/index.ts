import { contextBridge, ipcRenderer } from 'electron';

console.log('[Preload] Loading preload script...');
console.log('[Preload] contextBridge available:', !!contextBridge);
console.log('[Preload] ipcRenderer available:', !!ipcRenderer);

try {
  // Expose safe APIs to renderer
  contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // App info
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // API connection
  getApiUrl: (): Promise<string | null> => ipcRenderer.invoke('api:getUrl'),
  getApiPort: (): Promise<number | null> => ipcRenderer.invoke('api:getPort'),
  getConnectionMode: (): Promise<'local' | 'connected' | 'hybrid'> =>
    ipcRenderer.invoke('api:getConnectionMode'),

  // Window controls
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),

  // Dialogs
  openDirectoryDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),
  openFileDialog: (options?: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
  }): Promise<string | string[] | null> =>
    ipcRenderer.invoke('dialog:openFile', options),

  // Update event listeners (return cleanup function)
  onUpdateAvailable: (
    callback: (data: { version: string; downloadUrl: string }) => void
  ) => {
    ipcRenderer.on('update-available', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('update-available');
  },
  onUpdateNotAvailable: (callback: () => void) => {
    ipcRenderer.on('update-not-available', () => callback());
    return () => ipcRenderer.removeAllListeners('update-not-available');
  },
  onUpdateDownloading: (callback: (data: { percent: number }) => void) => {
    ipcRenderer.on('update-downloading', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('update-downloading');
  },
  onUpdateReady: (callback: (data: { version: string }) => void) => {
    ipcRenderer.on('update-ready', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('update-ready');
  },
  onUpdateError: (
    callback: (data: { message: string; fallbackUrl?: string }) => void
  ) => {
    ipcRenderer.on('update-error', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('update-error');
  },
  onShowWhatsNew: (
    callback: (data: { releases: Array<{ version: string; notes: string }> }) => void
  ) => {
    ipcRenderer.on('show-whats-new', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('show-whats-new');
  },

  // Update actions
  startUpdate: (downloadUrl: string, version: string): void => {
    ipcRenderer.send('update:start', { downloadUrl, version });
  },
  checkForUpdates: (): void => {
    ipcRenderer.send('update:check');
  },
  whatsNewSeen: (version: string): void => {
    ipcRenderer.send('update:whats-new-seen', version);
  },

  // Update async getters
  getUpdateSettings: (): Promise<{ autoUpdateEnabled: boolean }> => {
    return ipcRenderer.invoke('update:getSettings');
  },
  setAutoUpdate: (enabled: boolean): Promise<void> => {
    return ipcRenderer.invoke('update:setAutoUpdate', enabled);
  },
  });
  console.log('[Preload] contextBridge.exposeInMainWorld succeeded');
} catch (err) {
  console.error('[Preload] contextBridge.exposeInMainWorld FAILED:', err);
}

// Type declaration for renderer
declare global {
  interface Window {
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
      // Update methods
      onUpdateAvailable: (
        callback: (data: { version: string; downloadUrl: string }) => void
      ) => () => void;
      onUpdateNotAvailable: (callback: () => void) => () => void;
      onUpdateDownloading: (callback: (data: { percent: number }) => void) => () => void;
      onUpdateReady: (callback: (data: { version: string }) => void) => () => void;
      onUpdateError: (
        callback: (data: { message: string; fallbackUrl?: string }) => void
      ) => () => void;
      onShowWhatsNew: (
        callback: (data: { releases: Array<{ version: string; notes: string }> }) => void
      ) => () => void;
      startUpdate: (downloadUrl: string, version: string) => void;
      checkForUpdates: () => void;
      whatsNewSeen: (version: string) => void;
      getUpdateSettings: () => Promise<{ autoUpdateEnabled: boolean }>;
      setAutoUpdate: (enabled: boolean) => Promise<void>;
    };
  }
}
