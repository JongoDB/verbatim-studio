import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';
import { registerIpcHandlers } from './ipc';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  registerIpcHandlers();
  mainWindow = createMainWindow();
}

app.on('ready', bootstrap);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
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
