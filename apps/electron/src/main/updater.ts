import { autoUpdater } from 'electron-updater';
import { app, dialog, BrowserWindow } from 'electron';

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Don't check for updates in development
  if (!app.isPackaged) {
    console.log('[Updater] Skipping updates in development mode');
    return;
  }

  // Configure updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates on startup (after a short delay)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] Error checking for updates:', err);
    });
  }, 3000);

  // Update available
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available.`,
        detail: 'Would you like to download it now?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  // No update available
  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No updates available');
  });

  // Download progress
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Download progress: ${progress.percent.toFixed(1)}%`);
    mainWindow.webContents.send('update-download-progress', progress.percent);
  });

  // Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. Restart to apply?',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  // Error handling
  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
  });
}

export function checkForUpdates(): void {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] Error checking for updates:', err);
    });
  } else {
    console.log('[Updater] Updates not available in development mode');
  }
}
