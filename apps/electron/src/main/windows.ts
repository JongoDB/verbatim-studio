import { BrowserWindow, shell, app } from 'electron';
import path from 'path';

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  console.log('[Window] Preload path:', preloadPath);

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Verbatim Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      sandbox: false, // Disable sandbox to allow preload to work
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
  });

  // Load content
  if (!app.isPackaged) {
    // Development: load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load bundled frontend from extraResources
    const frontendPath = path.join(process.resourcesPath, 'frontend', 'index.html');
    console.log('[Window] Loading frontend from:', frontendPath);
    mainWindow.loadFile(frontendPath);
  }

  // Enable dev tools with keyboard shortcut (Cmd+Option+I / Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.meta && input.alt && input.key === 'i') ||
        (input.control && input.shift && input.key === 'I')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Show when ready
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}
