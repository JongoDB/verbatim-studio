import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';
import { backendManager } from './backend';
import { registerIpcHandlers } from './ipc';
import { initAutoUpdater } from './updater';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  try {
    // Register IPC handlers
    registerIpcHandlers();

    // Start backend (both development and production)
    console.log('[Main] Starting backend...');
    await backendManager.start();

    mainWindow = createMainWindow();

    // Initialize auto-updater
    initAutoUpdater(mainWindow);
  } catch (error) {
    console.error('[Main] Failed to start:', error);
    app.quit();
  }
}

app.on('ready', bootstrap);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

app.on('before-quit', async () => {
  console.log('[Main] Shutting down...');
  await backendManager.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Handle backend events
backendManager.on('unhealthy', () => {
  console.warn('[Main] Backend unhealthy');
});

backendManager.on('exit', (code: number | null) => {
  console.warn(`[Main] Backend exited with code ${code}`);
  if (code !== 0 && code !== null) {
    // Unexpected exit, could show error dialog
  }
});
