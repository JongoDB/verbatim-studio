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
    };
  }
}
