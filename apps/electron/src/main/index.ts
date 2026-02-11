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
    const logHint = process.platform === 'darwin'
      ? 'Check Console.app for more details.'
      : 'Check the application logs for more details.';
    dialog.showErrorBox(
      'Verbatim Studio - Startup Failed',
      `Failed to start backend:\n\n${error instanceof Error ? error.message : String(error)}\n\n${logHint}`
    );
    app.quit();
  }
}

app.on('ready', bootstrap);

app.on('activate', () => {
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    if (!backendManager.isRunning()) {
      console.error('[Main] Backend not running on activate');
      dialog.showMessageBox({
        type: 'error',
        title: 'Backend Not Running',
        message: 'The backend process is not running.',
        detail: 'Please restart the application.',
        buttons: ['Restart', 'Quit'],
      }).then((result) => {
        if (result.response === 0) {
          app.relaunch();
        }
        app.quit();
      });
      return;
    }
    mainWindow = createMainWindow();
  }
});

let isQuitting = false;
let cleanupDone = false;

app.on('before-quit', async (event) => {
  if (cleanupDone) return; // Let quit proceed after cleanup

  if (isQuitting) {
    event.preventDefault();
    return; // Cleanup already in progress
  }

  event.preventDefault();
  isQuitting = true;

  console.log('[Main] Shutting down...');
  try {
    await backendManager.stop();
  } catch (error) {
    console.error('[Main] Error stopping backend:', error);
  }

  cleanupDone = true;
  setImmediate(() => app.quit());
});

app.on('window-all-closed', () => {
  app.quit();
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

// Handle backend health failures with recovery
let healthFailures = 0;
const MAX_HEALTH_FAILURES = 3;

backendManager.on('unhealthy', () => {
  healthFailures++;
  console.warn(`[Main] Backend unhealthy (${healthFailures}/${MAX_HEALTH_FAILURES})`);

  if (healthFailures >= MAX_HEALTH_FAILURES && mainWindow && !mainWindow.isDestroyed() && !isQuitting) {
    healthFailures = 0; // Reset so we don't show multiple dialogs
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Backend Unresponsive',
      message: 'The backend has become unresponsive.',
      detail: 'Please restart the application.',
      buttons: ['Restart', 'Quit'],
    }).then((result) => {
      if (result.response === 0) {
        app.relaunch();
      }
      app.quit();
    });
  }
});

// Reset health failure counter on successful backend output (stdout only —
// stderr may fire during error loops when the backend is actually unresponsive)
backendManager.on('log', (data: { level: string }) => {
  if (data.level === 'info' && healthFailures > 0) healthFailures = 0;
});

backendManager.on('exit', (code: number | null) => {
  console.warn(`[Main] Backend exited with code ${code}`);
  if (code !== 0 && code !== null && !isQuitting) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Backend Stopped',
        message: 'The backend process has stopped unexpectedly.',
        detail: `Exit code: ${code}\n\nPlease restart the application.`,
        buttons: ['Restart', 'Quit'],
      }).then((result) => {
        if (result.response === 0) {
          app.relaunch();
        }
        app.quit();
      });
    }
  }
});

// Safety net: ensure backend stops on process exit
process.on('exit', () => {
  if (backendManager.isRunning()) {
    console.log('[Main] Process exiting, force-stopping backend');
    try {
      backendManager.forceKill();
    } catch {
      // Ignore errors during cleanup
    }
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('[Main] Uncaught exception:', error);
  try {
    await backendManager.stop();
  } catch {
    // Ignore cleanup errors
  }
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled promise rejection:', reason);
});
