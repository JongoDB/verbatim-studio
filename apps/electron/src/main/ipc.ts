import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import { backendManager } from './backend';
import { checkForUpdates, startUpdate, markWhatsNewSeen } from './updater';
import { getAutoUpdateEnabled, setAutoUpdateEnabled } from './update-store';

export function registerIpcHandlers(): void {
  // App info
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  // API URL - returns the backend URL for the renderer
  ipcMain.handle('api:getUrl', () => {
    return backendManager.getApiUrl();
  });

  // API Port - returns just the port number
  ipcMain.handle('api:getPort', () => {
    return backendManager.port;
  });

  // Connection mode - for future enterprise support
  ipcMain.handle('api:getConnectionMode', () => {
    // TODO: Read from settings when implementing enterprise mode
    return 'local';
  });

  // Directory picker - returns full path
  ipcMain.handle('dialog:openDirectory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Storage Folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // File picker - returns full path(s)
  ipcMain.handle('dialog:openFile', async (event, options?: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options?.filters,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return options?.multiple ? result.filePaths : result.filePaths[0];
  });

  // Window controls
  ipcMain.on('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMaximized()) {
      window.unmaximize();
    } else {
      window?.maximize();
    }
  });

  ipcMain.on('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
  });

  // Update handlers
  ipcMain.on('update:start', (_event, { downloadUrl, version }) => {
    // Validate URL
    try {
      new URL(downloadUrl);
    } catch {
      console.error('[IPC] Invalid download URL:', downloadUrl);
      return;
    }
    // Validate version
    if (!version || typeof version !== 'string') {
      console.error('[IPC] Invalid version:', version);
      return;
    }
    startUpdate(downloadUrl, version);
  });

  ipcMain.on('update:check', () => {
    checkForUpdates(true); // manual = true
  });

  ipcMain.on('update:whats-new-seen', (_event, version) => {
    if (!version || typeof version !== 'string') {
      console.error('[IPC] Invalid version for whats-new-seen:', version);
      return;
    }
    markWhatsNewSeen(version);
  });

  ipcMain.handle('update:getSettings', () => {
    return { autoUpdateEnabled: getAutoUpdateEnabled() };
  });

  ipcMain.handle('update:setAutoUpdate', (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      console.error('[IPC] Invalid enabled value:', enabled);
      return;
    }
    setAutoUpdateEnabled(enabled);
  });
}
