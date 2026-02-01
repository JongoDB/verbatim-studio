import { contextBridge, ipcRenderer } from 'electron';

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // App info
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // Window controls
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),

  // Dialogs
  openDirectoryDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
});

// Type declaration for renderer
declare global {
  interface Window {
    electronAPI?: {
      platform: NodeJS.Platform;
      getAppVersion: () => Promise<string>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      openDirectoryDialog: () => Promise<string | null>;
    };
  }
}
