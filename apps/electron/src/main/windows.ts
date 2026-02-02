import { BrowserWindow, shell, app } from 'electron';
import path from 'path';
import { backendManager } from './backend';

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

  // Inject API URL into page early (backup for when preload fails)
  // Use dom-ready which fires before did-finish-load, ensuring URL is available before app init
  mainWindow.webContents.on('dom-ready', () => {
    const apiUrl = backendManager.getApiUrl();
    const port = backendManager.port;
    const isRunning = backendManager.isRunning();
    console.log('[Window] dom-ready - Backend status: running=%s, port=%s, apiUrl=%s', isRunning, port, apiUrl);

    if (apiUrl) {
      mainWindow.webContents.executeJavaScript(`
        window.__VERBATIM_API_URL__ = '${apiUrl}';
        console.log('[Injected] API URL set to:', window.__VERBATIM_API_URL__);
      `).then(() => {
        console.log('[Window] API URL injection succeeded');
      }).catch((err) => {
        console.error('[Window] API URL injection FAILED:', err);
      });
    } else {
      console.error('[Window] Cannot inject API URL - backend not ready');
    }
  });

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
