import { ipcMain, app, BrowserWindow } from 'electron';

export function registerIpcHandlers(): void {
  // App info
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
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
}
