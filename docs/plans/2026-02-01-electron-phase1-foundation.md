# Electron Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the Electron app to properly communicate API URLs to the frontend and support dynamic port allocation.

**Architecture:** The Electron main process manages the backend lifecycle and exposes the API URL to the renderer via IPC. The frontend detects Electron and uses the provided URL instead of environment variables.

**Tech Stack:** Electron, TypeScript, React, Node.js net module for port finding

---

## Task 1: Add Dynamic Port Finding

**Files:**
- Create: `apps/electron/src/main/utils.ts`
- Modify: `apps/electron/src/main/backend.ts`

**Step 1: Create utils.ts with port finder**

Create `apps/electron/src/main/utils.ts`:

```typescript
import net from 'net';

/**
 * Find an available port starting from the preferred port.
 * Returns the first available port.
 */
export async function findAvailablePort(preferredPort: number = 8000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      server.close(() => resolve(port));
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use, try next port
        resolve(findAvailablePort(preferredPort + 1));
      } else {
        reject(err);
      }
    });
  });
}
```

**Step 2: Update BackendManager to use dynamic port**

Modify `apps/electron/src/main/backend.ts`:

Replace the constructor and add port getter:

```typescript
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { findAvailablePort } from './utils';

interface BackendConfig {
  preferredPort?: number;
  pythonPath?: string;
  backendPath?: string;
}

class BackendManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: BackendConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isStopping = false;
  private _port: number | null = null;

  constructor(config: BackendConfig = {}) {
    super();
    this.config = config;
  }

  get port(): number | null {
    return this._port;
  }

  getApiUrl(): string | null {
    if (this._port === null) return null;
    return `http://127.0.0.1:${this._port}`;
  }

  async start(): Promise<void> {
    if (this.process) {
      console.log('[Backend] Already running');
      return;
    }

    // Find available port
    this._port = await findAvailablePort(this.config.preferredPort ?? 8000);
    console.log(`[Backend] Using port ${this._port}`);

    const pythonPath = this.config.pythonPath || this.getPythonPath();
    const backendPath = this.config.backendPath || this.getBackendPath();

    console.log(`[Backend] Starting: ${pythonPath} at ${backendPath}`);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VERBATIM_ELECTRON: '1',
      VERBATIM_PORT: String(this._port),
      VERBATIM_DATA_DIR: app.getPath('userData'),
    };

    this.process = spawn(
      pythonPath,
      ['-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', String(this._port)],
      {
        cwd: backendPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    this.process.stdout?.on('data', (data: Buffer) => {
      console.log(`[Backend] ${data.toString().trim()}`);
      this.emit('log', { level: 'info', message: data.toString() });
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[Backend] ${data.toString().trim()}`);
      this.emit('log', { level: 'error', message: data.toString() });
    });

    this.process.on('exit', (code: number | null) => {
      console.log(`[Backend] Exited with code ${code}`);
      this.process = null;
      this._port = null;
      this.emit('exit', code);
    });

    this.process.on('error', (err: Error) => {
      console.error(`[Backend] Process error: ${err.message}`);
      this.emit('error', err);
    });

    try {
      await this.waitForHealth();
      this.startHealthCheck();
    } catch (error) {
      this.process?.kill('SIGKILL');
      this.process = null;
      this._port = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (!this.process || this.isStopping) return;
    this.isStopping = true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          console.log('[Backend] Force killing');
          this.process.kill('SIGKILL');
        }
        this.isStopping = false;
        this._port = null;
        resolve();
      }, 5000);

      this.process!.on('exit', () => {
        clearTimeout(timeout);
        this.isStopping = false;
        this._port = null;
        resolve();
      });

      console.log('[Backend] Sending SIGTERM');
      this.process!.kill('SIGTERM');
    });
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  private getPythonPath(): string {
    if (app.isPackaged) {
      // Bundled Python
      const resourcesPath = process.resourcesPath;
      return path.join(resourcesPath, 'python', 'bin', 'python3.12');
    } else {
      // Development: Use venv Python
      return path.join(__dirname, '../../../../packages/backend/.venv/bin/python');
    }
  }

  private getBackendPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'backend');
    } else {
      return path.join(__dirname, '../../../../packages/backend');
    }
  }

  private async waitForHealth(timeout = 30000): Promise<void> {
    const startTime = Date.now();
    const url = `http://127.0.0.1:${this._port}/health`;

    console.log(`[Backend] Waiting for health at ${url}`);

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          console.log('[Backend] Health check passed');
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error('Backend failed to start within timeout');
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${this._port}/health`);
        if (!response.ok) {
          this.emit('unhealthy');
        }
      } catch {
        this.emit('unhealthy');
      }
    }, 10000);
  }
}

export const backendManager = new BackendManager();
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/electron && pnpm build`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/electron/src/main/utils.ts apps/electron/src/main/backend.ts
git commit -m "feat(electron): add dynamic port allocation for backend"
```

---

## Task 2: Add API URL IPC Handlers

**Files:**
- Modify: `apps/electron/src/main/ipc.ts`
- Modify: `apps/electron/src/main/index.ts`

**Step 1: Add API URL handlers to ipc.ts**

Replace `apps/electron/src/main/ipc.ts`:

```typescript
import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import { backendManager } from './backend';

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
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/electron && pnpm build`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/electron/src/main/ipc.ts
git commit -m "feat(electron): add API URL IPC handlers"
```

---

## Task 3: Update Preload Script

**Files:**
- Modify: `apps/electron/src/preload/index.ts`

**Step 1: Add API methods to preload**

Replace `apps/electron/src/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // App info
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // API connection
  getApiUrl: (): Promise<string | null> => ipcRenderer.invoke('api:getUrl'),
  getApiPort: (): Promise<number | null> => ipcRenderer.invoke('api:getPort'),
  getConnectionMode: (): Promise<'local' | 'connected' | 'hybrid'> =>
    ipcRenderer.invoke('api:getConnectionMode'),

  // Window controls
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),

  // Dialogs
  openDirectoryDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),
  openFileDialog: (options?: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
  }): Promise<string | string[] | null> =>
    ipcRenderer.invoke('dialog:openFile', options),
});

// Type declaration for renderer
declare global {
  interface Window {
    electronAPI?: {
      platform: NodeJS.Platform;
      getAppVersion: () => Promise<string>;
      getApiUrl: () => Promise<string | null>;
      getApiPort: () => Promise<number | null>;
      getConnectionMode: () => Promise<'local' | 'connected' | 'hybrid'>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      openDirectoryDialog: () => Promise<string | null>;
      openFileDialog: (options?: {
        filters?: { name: string; extensions: string[] }[];
        multiple?: boolean;
      }) => Promise<string | string[] | null>;
    };
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/electron && pnpm build`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/electron/src/preload/index.ts
git commit -m "feat(electron): expose API URL methods in preload"
```

---

## Task 4: Update Frontend API Configuration

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`

**Step 1: Add Electron API URL detection**

Update the top of `packages/frontend/src/lib/api.ts` (replace lines 1-40):

```typescript
// Backend API URL configuration
// Priority:
// 1. Electron app: use URL from main process via IPC
// 2. VITE_API_URL environment variable
// 3. Empty string (relative URLs for same-origin)

// Cache the API URL once resolved
let cachedApiBaseUrl: string | null = null;
let apiUrlPromise: Promise<string> | null = null;

/**
 * Initialize the API base URL.
 * In Electron, this fetches the URL from the main process.
 * Call this early in app startup.
 */
export async function initializeApiUrl(): Promise<string> {
  if (cachedApiBaseUrl !== null) {
    return cachedApiBaseUrl;
  }

  if (apiUrlPromise) {
    return apiUrlPromise;
  }

  apiUrlPromise = (async () => {
    // Check if running in Electron
    if (window.electronAPI?.getApiUrl) {
      const url = await window.electronAPI.getApiUrl();
      if (url) {
        console.log('[API] Using Electron backend URL:', url);
        cachedApiBaseUrl = url;
        return url;
      }
    }

    // Fall back to environment variable or empty string
    const envUrl = import.meta.env.VITE_API_URL ?? '';
    console.log('[API] Using environment URL:', envUrl || '(relative)');
    cachedApiBaseUrl = envUrl;
    return envUrl;
  })();

  return apiUrlPromise;
}

/**
 * Get the API base URL synchronously.
 * Returns cached value or empty string if not yet initialized.
 * Prefer using initializeApiUrl() at app startup.
 */
function getApiBaseUrl(): string {
  return cachedApiBaseUrl ?? import.meta.env.VITE_API_URL ?? '';
}

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

/**
 * Get the WebSocket URL for a given API path.
 * Automatically handles:
 * - Protocol (ws:// vs wss:// based on current page protocol)
 * - Host (uses current origin or API_BASE_URL if set)
 * - Development mode: connects directly to backend (Vite WS proxy unreliable)
 */
export function getWebSocketUrl(path: string): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const apiBaseUrl = getApiBaseUrl();

  if (apiBaseUrl) {
    // If API_BASE_URL is set, use it (convert http(s) to ws(s))
    const apiUrl = new URL(apiBaseUrl);
    const apiWsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${apiWsProtocol}//${apiUrl.host}${path}`;
  }

  // In development (Vite dev server), connect directly to backend
  // Vite's WebSocket proxy is unreliable for non-HMR WebSockets
  if (import.meta.env.DEV && window.location.port === '5173') {
    return `ws://127.0.0.1:8000${path}`;
  }

  // Production: use same origin (assumes reverse proxy handles WS)
  return `${wsProtocol}//${window.location.host}${path}`;
}

/**
 * Get the full API URL for a given path.
 * Uses relative URLs when API_BASE_URL is not set.
 */
export function getApiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}
```

**Step 2: Update ApiClient constructor**

Find the `ApiClient` class (around line 1022) and update its constructor:

```typescript
export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? getApiBaseUrl();
  }
  // ... rest of class unchanged
```

**Step 3: Verify frontend builds**

Run: `cd packages/frontend && pnpm build`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/frontend/src/lib/api.ts
git commit -m "feat(frontend): add Electron API URL detection"
```

---

## Task 5: Initialize API URL on App Startup

**Files:**
- Modify: `packages/frontend/src/main.tsx`

**Step 1: Add API initialization**

Update `packages/frontend/src/main.tsx` to initialize API URL before rendering:

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initializeApiUrl } from './lib/api'

// Initialize API URL (important for Electron)
initializeApiUrl().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}).catch((error) => {
  console.error('Failed to initialize API URL:', error)
  // Render anyway with fallback
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
```

**Step 2: Verify frontend builds**

Run: `cd packages/frontend && pnpm build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/main.tsx
git commit -m "feat(frontend): initialize API URL on startup"
```

---

## Task 6: Add TypeScript Types for Electron API

**Files:**
- Create: `packages/frontend/src/types/electron.d.ts`

**Step 1: Create type declarations**

Create `packages/frontend/src/types/electron.d.ts`:

```typescript
/**
 * Type declarations for the Electron API exposed via preload script.
 * This file ensures TypeScript knows about window.electronAPI.
 */

interface ElectronAPI {
  platform: NodeJS.Platform;
  getAppVersion: () => Promise<string>;
  getApiUrl: () => Promise<string | null>;
  getApiPort: () => Promise<number | null>;
  getConnectionMode: () => Promise<'local' | 'connected' | 'hybrid'>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  openDirectoryDialog: () => Promise<string | null>;
  openFileDialog: (options?: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
  }) => Promise<string | string[] | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
```

**Step 2: Verify frontend builds**

Run: `cd packages/frontend && pnpm build`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/types/electron.d.ts
git commit -m "feat(frontend): add Electron API type declarations"
```

---

## Task 7: Test Electron Dev Mode

**Step 1: Start backend**

In terminal 1:
```bash
cd packages/backend
source .venv/bin/activate
uvicorn api.main:app --reload
```

**Step 2: Start frontend dev server**

In terminal 2:
```bash
cd packages/frontend
pnpm dev
```

**Step 3: Build and run Electron**

In terminal 3:
```bash
cd apps/electron
pnpm build
pnpm start
```

**Step 4: Verify**

- Electron window opens
- App loads frontend from Vite dev server
- Check DevTools console for: `[API] Using Electron backend URL: http://127.0.0.1:XXXX`
- App functions normally (can load recordings, etc.)

**Step 5: Commit all changes**

```bash
git add -A
git commit -m "feat(electron): complete Phase 1a - API URL wiring"
```

---

## Summary

After completing these tasks:

1. ✅ BackendManager uses dynamic port allocation
2. ✅ IPC handlers expose API URL to renderer
3. ✅ Preload script provides typed API access
4. ✅ Frontend detects Electron and uses correct API URL
5. ✅ TypeScript types for Electron API
6. ✅ API initialization on app startup

**Next steps (Phase 1b-1c):**
- Create Python standalone download scripts
- Set up electron-builder for production builds
- GitHub Actions workflow
