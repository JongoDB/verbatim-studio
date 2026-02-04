import { app, BrowserWindow, dialog } from 'electron';
import { createMainWindow } from './windows';
import { backendManager } from './backend';
import { registerIpcHandlers } from './ipc';
import { initAutoUpdater } from './updater';
import { bootstrapBundledModels } from './bootstrap-models';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  try {
    console.log('[Main] Bootstrap starting, app.isReady():', app.isReady());

    // Register IPC handlers
    registerIpcHandlers();

    // Bootstrap bundled models (copy from resources to cache if needed)
    await bootstrapBundledModels();

    // Start backend (both development and production)
    console.log('[Main] Starting backend...');
    console.log('[Main] app.isPackaged:', app.isPackaged);
    console.log('[Main] process.resourcesPath:', process.resourcesPath);

    await backendManager.start();

    console.log('[Main] Backend started successfully, port:', backendManager.port);
    console.log('[Main] Backend API URL:', backendManager.getApiUrl());

    // Double-check app is ready before creating window (should always be true here)
    if (!app.isReady()) {
      console.error('[Main] App not ready after backend start! Waiting...');
      await app.whenReady();
    }

    console.log('[Main] Creating main window...');
    mainWindow = createMainWindow();

    // Initialize auto-updater
    initAutoUpdater(mainWindow);
  } catch (error) {
    console.error('[Main] Failed to start:', error);
    dialog.showErrorBox(
      'Verbatim Studio - Startup Failed',
      `Failed to start backend:\n\n${error instanceof Error ? error.message : String(error)}\n\nCheck Console.app for more details.`
    );
    app.quit();
  }
}

app.on('ready', bootstrap);

app.on('activate', () => {
  // Only create window if app is ready and no windows exist
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

let isQuitting = false;

app.on('before-quit', async (event) => {
  if (isQuitting) return;

  // Prevent default to handle async cleanup
  event.preventDefault();
  isQuitting = true;

  console.log('[Main] Shutting down...');
  try {
    await backendManager.stop();
  } catch (error) {
    console.error('[Main] Error stopping backend:', error);
  }

  // Now actually quit
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('second-instance', () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  } catch (error) {
    console.error('[Main] Error handling second instance:', error);
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
