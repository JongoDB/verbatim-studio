# Auto-Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement seamless auto-update for the Electron app with "What's New" dialog on first launch after update.

**Architecture:** Custom GitHub-based updater that downloads DMG, removes quarantine, mounts, and uses a shell script handoff to replace the app while it quits and relaunches. Release notes shown on first launch of new version via electron-store tracking.

**Tech Stack:** Electron (main process), electron-store, GitHub Releases API, React (frontend dialogs), execFile for safe command execution.

---

## Task 1: Create electron-store for Update Preferences

**Files:**
- Create: `apps/electron/src/main/update-store.ts`

**Step 1: Write the update store module**

```typescript
// apps/electron/src/main/update-store.ts
import Store from 'electron-store';

interface UpdateStoreSchema {
  autoUpdateEnabled: boolean;
  lastUpdateCheck: number;
  lastSeenVersion: string;
}

const updateStore = new Store<UpdateStoreSchema>({
  name: 'update-preferences',
  defaults: {
    autoUpdateEnabled: true,
    lastUpdateCheck: 0,
    lastSeenVersion: '',
  },
});

export function getAutoUpdateEnabled(): boolean {
  return updateStore.get('autoUpdateEnabled');
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  updateStore.set('autoUpdateEnabled', enabled);
}

export function getLastUpdateCheck(): number {
  return updateStore.get('lastUpdateCheck');
}

export function setLastUpdateCheck(timestamp: number): void {
  updateStore.set('lastUpdateCheck', timestamp);
}

export function getLastSeenVersion(): string {
  return updateStore.get('lastSeenVersion');
}

export function setLastSeenVersion(version: string): void {
  updateStore.set('lastSeenVersion', version);
}

export { updateStore };
```

**Step 2: Verify it compiles**

Run: `cd apps/electron && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add apps/electron/src/main/update-store.ts
git commit -m "feat(updater): add electron-store for update preferences"
```

---

## Task 2: Create Update Script Generator

**Files:**
- Create: `apps/electron/src/main/update-script.ts`

**Step 1: Write the script generator**

```typescript
// apps/electron/src/main/update-script.ts
import { writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const UPDATE_DIR = '/tmp/verbatim-update';

export function generateUpdaterScript(volumePath: string, appName: string): string {
  const appPath = `/Applications/${appName}.app`;

  return `#!/bin/bash
# Verbatim Studio Auto-Updater Script
# Generated automatically - do not edit

APP_NAME="${appName}"
VOLUME_PATH="${volumePath}"
APP_PATH="${appPath}"

echo "[Updater] Waiting for app to quit..."

# Wait for app to quit (max 30 seconds)
TIMEOUT=30
COUNTER=0
while pgrep -x "$APP_NAME" > /dev/null; do
  sleep 0.5
  COUNTER=$((COUNTER + 1))
  if [ $COUNTER -ge $((TIMEOUT * 2)) ]; then
    echo "[Updater] Timeout waiting for app to quit"
    osascript -e 'display notification "Update failed: App did not quit" with title "Verbatim Studio"'
    hdiutil detach "$VOLUME_PATH" -quiet 2>/dev/null
    exit 1
  fi
done

echo "[Updater] App quit, replacing..."

# Remove old app
rm -rf "$APP_PATH"
if [ $? -ne 0 ]; then
  echo "[Updater] Failed to remove old app"
  osascript -e 'display notification "Update failed: Could not remove old app" with title "Verbatim Studio"'
  hdiutil detach "$VOLUME_PATH" -quiet 2>/dev/null
  exit 1
fi

# Copy new app
cp -R "$VOLUME_PATH/$APP_NAME.app" "/Applications/"
if [ $? -ne 0 ]; then
  echo "[Updater] Failed to copy new app"
  osascript -e 'display notification "Update failed: Could not copy new app" with title "Verbatim Studio"'
  hdiutil detach "$VOLUME_PATH" -quiet 2>/dev/null
  exit 1
fi

echo "[Updater] Launching new version..."

# Launch new version
open "$APP_PATH"

# Cleanup
echo "[Updater] Cleaning up..."
hdiutil detach "$VOLUME_PATH" -quiet 2>/dev/null
rm -rf "${UPDATE_DIR}"

echo "[Updater] Update complete!"
`;
}

export async function writeUpdaterScript(volumePath: string, appName: string): Promise<string> {
  const scriptPath = path.join(UPDATE_DIR, 'update.sh');
  const script = generateUpdaterScript(volumePath, appName);

  await writeFile(scriptPath, script, { mode: 0o755 });

  return scriptPath;
}

export async function parseVolumePath(hdiutilOutput: string): Promise<string> {
  // hdiutil output format: "/dev/disk4s1  Apple_HFS  /Volumes/Verbatim Studio"
  const lines = hdiutilOutput.trim().split('\n');
  for (const line of lines) {
    const match = line.match(/\/Volumes\/.+$/);
    if (match) {
      return match[0];
    }
  }
  throw new Error('Could not parse volume path from hdiutil output');
}

export { UPDATE_DIR };
```

**Step 2: Verify it compiles**

Run: `cd apps/electron && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add apps/electron/src/main/update-script.ts
git commit -m "feat(updater): add shell script generator for seamless updates"
```

---

## Task 3: Rewrite Updater Module

**Files:**
- Modify: `apps/electron/src/main/updater.ts` (complete rewrite)

**Step 1: Rewrite the updater**

```typescript
// apps/electron/src/main/updater.ts
import { app, BrowserWindow } from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import path from 'path';
import https from 'https';
import {
  getAutoUpdateEnabled,
  getLastUpdateCheck,
  setLastUpdateCheck,
  getLastSeenVersion,
  setLastSeenVersion,
} from './update-store';
import { writeUpdaterScript, parseVolumePath, UPDATE_DIR } from './update-script';

const execFileAsync = promisify(execFile);

const GITHUB_OWNER = 'JongoDB';
const GITHUB_REPO = 'verbatim-studio';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const APP_NAME = 'Verbatim Studio';

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface UpdateInfo {
  version: string;
  downloadUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

let mainWindow: BrowserWindow | null = null;

export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window;

  if (!app.isPackaged) {
    console.log('[Updater] Skipping updates in development mode');
    return;
  }

  // Check for "What's New" on startup
  checkWhatsNew();

  // Check for updates on startup (after short delay)
  setTimeout(() => {
    if (getAutoUpdateEnabled()) {
      checkForUpdates(false);
    }
  }, 5000);

  // Schedule periodic checks
  setInterval(() => {
    if (getAutoUpdateEnabled() && shouldCheckForUpdates()) {
      checkForUpdates(false);
    }
  }, 60 * 60 * 1000); // Check every hour if 24h has passed
}

function shouldCheckForUpdates(): boolean {
  const lastCheck = getLastUpdateCheck();
  const now = Date.now();
  return now - lastCheck >= CHECK_INTERVAL_MS;
}

async function checkWhatsNew(): Promise<void> {
  const currentVersion = app.getVersion();
  const lastSeenVersion = getLastSeenVersion();

  // First run or same version - nothing to show
  if (!lastSeenVersion) {
    setLastSeenVersion(currentVersion);
    return;
  }

  if (lastSeenVersion === currentVersion) {
    return;
  }

  // Version changed - fetch release notes for versions between last seen and current
  console.log(`[Updater] Version changed: ${lastSeenVersion} -> ${currentVersion}`);

  try {
    const releases = await fetchReleaseNotes(lastSeenVersion, currentVersion);
    if (releases.length > 0 && mainWindow) {
      mainWindow.webContents.send('show-whats-new', { releases });
    }
  } catch (err) {
    console.error('[Updater] Failed to fetch release notes:', err);
  }
}

async function fetchReleaseNotes(
  fromVersion: string,
  toVersion: string
): Promise<Array<{ version: string; notes: string }>> {
  const releases = await fetchGitHubReleases();
  const result: Array<{ version: string; notes: string }> = [];

  const fromNum = parseVersion(fromVersion);
  const toNum = parseVersion(toVersion);

  for (const release of releases) {
    const releaseVersion = release.tag_name.replace(/^v/, '');
    const releaseNum = parseVersion(releaseVersion);

    if (releaseNum > fromNum && releaseNum <= toNum) {
      result.push({
        version: releaseVersion,
        notes: release.body || 'No release notes available.',
      });
    }
  }

  // Sort newest first
  result.sort((a, b) => parseVersion(b.version) - parseVersion(a.version));
  return result;
}

function parseVersion(version: string): number {
  const parts = version.replace(/^v/, '').split('.').map(Number);
  return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      headers: {
        'User-Agent': `${APP_NAME}/${app.getVersion()}`,
        Accept: 'application/vnd.github.v3+json',
      },
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

export async function checkForUpdates(manual = false): Promise<void> {
  if (!app.isPackaged && !manual) {
    console.log('[Updater] Skipping updates in development mode');
    return;
  }

  console.log('[Updater] Checking for updates...');
  setLastUpdateCheck(Date.now());

  try {
    const releases = await fetchGitHubReleases();
    if (releases.length === 0) {
      if (manual && mainWindow) {
        mainWindow.webContents.send('update-not-available');
      }
      return;
    }

    const latest = releases[0];
    const latestVersion = latest.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    if (parseVersion(latestVersion) <= parseVersion(currentVersion)) {
      console.log('[Updater] Already on latest version');
      if (manual && mainWindow) {
        mainWindow.webContents.send('update-not-available');
      }
      return;
    }

    // Find the correct DMG for this architecture
    const arch = process.arch; // 'arm64' or 'x64'
    const asset = latest.assets.find(
      (a) => a.name.includes(arch) && a.name.endsWith('.dmg')
    );

    if (!asset) {
      console.error('[Updater] No DMG found for architecture:', arch);
      if (mainWindow) {
        mainWindow.webContents.send('update-error', {
          message: `No update available for your system (${arch})`,
        });
      }
      return;
    }

    console.log(`[Updater] Update available: ${currentVersion} -> ${latestVersion}`);

    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: latestVersion,
        downloadUrl: asset.browser_download_url,
      });
    }
  } catch (err) {
    console.error('[Updater] Error checking for updates:', err);
    if (manual && mainWindow) {
      mainWindow.webContents.send('update-error', {
        message: 'Failed to check for updates. Please try again later.',
      });
    }
  }
}

export async function startUpdate(downloadUrl: string, version: string): Promise<void> {
  if (!mainWindow) return;

  console.log(`[Updater] Starting update to ${version}...`);

  try {
    // Create temp directory
    await mkdir(UPDATE_DIR, { recursive: true });

    const dmgPath = path.join(UPDATE_DIR, `${APP_NAME}-${version}.dmg`);

    // Download DMG
    console.log('[Updater] Downloading...');
    await downloadFile(downloadUrl, dmgPath, (percent) => {
      mainWindow?.webContents.send('update-downloading', { percent });
    });

    // Remove quarantine
    console.log('[Updater] Removing quarantine...');
    await execFileAsync('xattr', ['-c', dmgPath]);

    // Mount DMG
    console.log('[Updater] Mounting DMG...');
    const { stdout } = await execFileAsync('hdiutil', ['attach', '-nobrowse', dmgPath]);
    const volumePath = await parseVolumePath(stdout);

    console.log('[Updater] Volume mounted at:', volumePath);

    // Generate and write updater script
    const scriptPath = await writeUpdaterScript(volumePath, APP_NAME);

    console.log('[Updater] Update ready, handing off to script...');
    mainWindow.webContents.send('update-ready', { version });

    // Spawn detached updater script
    const child = spawn(scriptPath, [], {
      detached: true,
      stdio: 'ignore',
      shell: true,
    });
    child.unref();

    // Quit app to let script take over
    setTimeout(() => {
      app.quit();
    }, 500);
  } catch (err) {
    console.error('[Updater] Update failed:', err);

    // Cleanup on failure
    try {
      await rm(UPDATE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    if (mainWindow) {
      mainWindow.webContents.send('update-error', {
        message: err instanceof Error ? err.message : 'Update failed',
        fallbackUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      });
    }
  }
}

function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);

    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          onProgress(Math.round((downloadedSize / totalSize) * 100));
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

export function markWhatsNewSeen(version: string): void {
  setLastSeenVersion(version);
}
```

**Step 2: Verify it compiles**

Run: `cd apps/electron && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add apps/electron/src/main/updater.ts
git commit -m "feat(updater): rewrite with GitHub-based seamless updates"
```

---

## Task 4: Add IPC Channels to Preload

**Files:**
- Modify: `apps/electron/src/preload/index.ts`

**Step 1: Add update-related IPC channels**

Add to the `contextBridge.exposeInMainWorld('electronAPI', {...})` object:

```typescript
// Update channels
onUpdateAvailable: (callback: (data: { version: string; downloadUrl: string }) => void) => {
  ipcRenderer.on('update-available', (_event, data) => callback(data));
  return () => ipcRenderer.removeAllListeners('update-available');
},
onUpdateNotAvailable: (callback: () => void) => {
  ipcRenderer.on('update-not-available', () => callback());
  return () => ipcRenderer.removeAllListeners('update-not-available');
},
onUpdateDownloading: (callback: (data: { percent: number }) => void) => {
  ipcRenderer.on('update-downloading', (_event, data) => callback(data));
  return () => ipcRenderer.removeAllListeners('update-downloading');
},
onUpdateReady: (callback: (data: { version: string }) => void) => {
  ipcRenderer.on('update-ready', (_event, data) => callback(data));
  return () => ipcRenderer.removeAllListeners('update-ready');
},
onUpdateError: (callback: (data: { message: string; fallbackUrl?: string }) => void) => {
  ipcRenderer.on('update-error', (_event, data) => callback(data));
  return () => ipcRenderer.removeAllListeners('update-error');
},
onShowWhatsNew: (callback: (data: { releases: Array<{ version: string; notes: string }> }) => void) => {
  ipcRenderer.on('show-whats-new', (_event, data) => callback(data));
  return () => ipcRenderer.removeAllListeners('show-whats-new');
},
startUpdate: (downloadUrl: string, version: string): void => {
  ipcRenderer.send('update:start', { downloadUrl, version });
},
checkForUpdates: (): void => {
  ipcRenderer.send('update:check');
},
whatsNewSeen: (version: string): void => {
  ipcRenderer.send('update:whats-new-seen', version);
},
getUpdateSettings: (): Promise<{ autoUpdateEnabled: boolean }> => {
  return ipcRenderer.invoke('update:getSettings');
},
setAutoUpdate: (enabled: boolean): Promise<void> => {
  return ipcRenderer.invoke('update:setAutoUpdate', enabled);
},
```

**Step 2: Update the Window type declaration**

Add to the `electronAPI` interface in the `declare global` section:

```typescript
// Update methods
onUpdateAvailable: (callback: (data: { version: string; downloadUrl: string }) => void) => () => void;
onUpdateNotAvailable: (callback: () => void) => () => void;
onUpdateDownloading: (callback: (data: { percent: number }) => void) => () => void;
onUpdateReady: (callback: (data: { version: string }) => void) => () => void;
onUpdateError: (callback: (data: { message: string; fallbackUrl?: string }) => void) => () => void;
onShowWhatsNew: (callback: (data: { releases: Array<{ version: string; notes: string }> }) => void) => () => void;
startUpdate: (downloadUrl: string, version: string) => void;
checkForUpdates: () => void;
whatsNewSeen: (version: string) => void;
getUpdateSettings: () => Promise<{ autoUpdateEnabled: boolean }>;
setAutoUpdate: (enabled: boolean) => Promise<void>;
```

**Step 3: Verify it compiles**

Run: `cd apps/electron && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add apps/electron/src/preload/index.ts
git commit -m "feat(updater): add IPC channels for update communication"
```

---

## Task 5: Add IPC Handlers to Main Process

**Files:**
- Modify: `apps/electron/src/main/ipc.ts`

**Step 1: Import updater functions**

Add at top of file:

```typescript
import { checkForUpdates, startUpdate, markWhatsNewSeen } from './updater';
import { getAutoUpdateEnabled, setAutoUpdateEnabled } from './update-store';
```

**Step 2: Add handlers in registerIpcHandlers function**

Add these handlers:

```typescript
// Update handlers
ipcMain.on('update:start', (_event, { downloadUrl, version }) => {
  startUpdate(downloadUrl, version);
});

ipcMain.on('update:check', () => {
  checkForUpdates(true);
});

ipcMain.on('update:whats-new-seen', (_event, version) => {
  markWhatsNewSeen(version);
});

ipcMain.handle('update:getSettings', () => {
  return { autoUpdateEnabled: getAutoUpdateEnabled() };
});

ipcMain.handle('update:setAutoUpdate', (_event, enabled: boolean) => {
  setAutoUpdateEnabled(enabled);
});
```

**Step 3: Verify it compiles**

Run: `cd apps/electron && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add apps/electron/src/main/ipc.ts
git commit -m "feat(updater): add IPC handlers for update operations"
```

---

## Task 6: Create UpdatePrompt Component

**Files:**
- Create: `packages/frontend/src/components/updates/UpdatePrompt.tsx`

**Step 1: Create the component directory and file**

```typescript
// packages/frontend/src/components/updates/UpdatePrompt.tsx
import { useState } from 'react';

interface UpdatePromptProps {
  version: string;
  downloadUrl: string;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdatePrompt({ version, downloadUrl, onUpdate, onDismiss }: UpdatePromptProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // Listen for download progress
  useState(() => {
    if (!window.electronAPI) return;

    const cleanupDownloading = window.electronAPI.onUpdateDownloading(({ percent }) => {
      setDownloadPercent(percent);
    });

    const cleanupReady = window.electronAPI.onUpdateReady(() => {
      // App will quit momentarily
    });

    const cleanupError = window.electronAPI.onUpdateError(({ message, fallbackUrl: url }) => {
      setIsDownloading(false);
      setError(message);
      if (url) setFallbackUrl(url);
    });

    return () => {
      cleanupDownloading();
      cleanupReady();
      cleanupError();
    };
  });

  const handleUpdate = () => {
    if (!window.electronAPI) return;
    setIsDownloading(true);
    setError(null);
    window.electronAPI.startUpdate(downloadUrl, version);
    onUpdate();
  };

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Update Failed
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {error}
          </p>
          {fallbackUrl && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              You can{' '}
              <a
                href={fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                download the update manually
              </a>
              .
            </p>
          )}
          <div className="flex justify-end">
            <button
              onClick={onDismiss}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isDownloading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Downloading Update
          </h2>
          <div className="mb-2">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            {downloadPercent}% complete
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Update Available
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Version {version} is available.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            Later
          </button>
          <button
            onClick={handleUpdate}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Update Now
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd packages/frontend && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add packages/frontend/src/components/updates/UpdatePrompt.tsx
git commit -m "feat(updater): add UpdatePrompt modal component"
```

---

## Task 7: Create WhatsNewDialog Component

**Files:**
- Create: `packages/frontend/src/components/updates/WhatsNewDialog.tsx`

**Step 1: Create the component**

```typescript
// packages/frontend/src/components/updates/WhatsNewDialog.tsx

interface Release {
  version: string;
  notes: string;
}

interface WhatsNewDialogProps {
  releases: Release[];
  onDismiss: () => void;
}

export function WhatsNewDialog({ releases, onDismiss }: WhatsNewDialogProps) {
  const handleDismiss = () => {
    if (window.electronAPI && releases.length > 0) {
      // Mark the newest version as seen
      window.electronAPI.whatsNewSeen(releases[0].version);
    }
    onDismiss();
  };

  // Simple markdown-to-HTML for release notes (handles basic formatting)
  const formatNotes = (notes: string) => {
    return notes
      .split('\n')
      .map((line, i) => {
        // Headers
        if (line.startsWith('### ')) {
          return (
            <h4 key={i} className="font-medium text-gray-900 dark:text-gray-100 mt-3 mb-1">
              {line.slice(4)}
            </h4>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h3 key={i} className="font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-2">
              {line.slice(3)}
            </h3>
          );
        }
        // Bullet points
        if (line.startsWith('- ') || line.startsWith('* ')) {
          const text = line.slice(2);
          // Bold text
          const parts = text.split(/\*\*(.+?)\*\*/g);
          return (
            <li key={i} className="ml-4 text-gray-600 dark:text-gray-400">
              {parts.map((part, j) =>
                j % 2 === 1 ? (
                  <strong key={j} className="text-gray-900 dark:text-gray-100">
                    {part}
                  </strong>
                ) : (
                  part
                )
              )}
            </li>
          );
        }
        // Empty lines
        if (line.trim() === '') {
          return <br key={i} />;
        }
        // Regular text
        return (
          <p key={i} className="text-gray-600 dark:text-gray-400">
            {line}
          </p>
        );
      });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            What's New
          </h2>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {releases.map((release, index) => (
            <div key={release.version} className={index > 0 ? 'mt-6 pt-6 border-t border-gray-200 dark:border-gray-700' : ''}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
                v{release.version}
              </h3>
              <div className="text-sm space-y-1">
                {formatNotes(release.notes)}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleDismiss}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Create index export**

```typescript
// packages/frontend/src/components/updates/index.ts
export { UpdatePrompt } from './UpdatePrompt';
export { WhatsNewDialog } from './WhatsNewDialog';
```

**Step 3: Verify it compiles**

Run: `cd packages/frontend && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add packages/frontend/src/components/updates/
git commit -m "feat(updater): add WhatsNewDialog component for release notes"
```

---

## Task 8: Add Updates Section to Settings Page

**Files:**
- Modify: `packages/frontend/src/pages/settings/SettingsPage.tsx`

**Step 1: Add state and effects for update settings**

Add near the top of the component (after other useState calls):

```typescript
// Update settings state
const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
const [updateCheckResult, setUpdateCheckResult] = useState<'none' | 'available' | null>(null);

// Load update settings on mount
useEffect(() => {
  if (window.electronAPI) {
    window.electronAPI.getUpdateSettings().then(({ autoUpdateEnabled }) => {
      setAutoUpdateEnabled(autoUpdateEnabled);
    });

    const cleanupNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      setIsCheckingForUpdates(false);
      setUpdateCheckResult('none');
      setTimeout(() => setUpdateCheckResult(null), 3000);
    });

    const cleanupAvailable = window.electronAPI.onUpdateAvailable(() => {
      setIsCheckingForUpdates(false);
      setUpdateCheckResult('available');
    });

    return () => {
      cleanupNotAvailable();
      cleanupAvailable();
    };
  }
}, []);

const handleAutoUpdateToggle = async (enabled: boolean) => {
  setAutoUpdateEnabled(enabled);
  if (window.electronAPI) {
    await window.electronAPI.setAutoUpdate(enabled);
  }
};

const handleCheckForUpdates = () => {
  if (window.electronAPI) {
    setIsCheckingForUpdates(true);
    setUpdateCheckResult(null);
    window.electronAPI.checkForUpdates();
  }
};
```

**Step 2: Add the Updates section UI**

Add this section right before the "About Verbatim Studio" section in the General tab (around line 2786):

```tsx
{/* Updates Section - only show in Electron */}
{window.electronAPI && (
  <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Updates</h2>
    </div>
    <div className="px-5 py-4 space-y-4">
      {/* Version display */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600 dark:text-gray-400">Current Version</span>
        <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
          {APP_VERSION}
        </span>
      </div>

      {/* Auto-update toggle */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Check for updates automatically
          </span>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Checks on launch and every 24 hours
          </p>
        </div>
        <button
          onClick={() => handleAutoUpdateToggle(!autoUpdateEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            autoUpdateEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              autoUpdateEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Check for updates button */}
      <div className="pt-2">
        <button
          onClick={handleCheckForUpdates}
          disabled={isCheckingForUpdates}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCheckingForUpdates ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Checking...
            </span>
          ) : (
            'Check for Updates'
          )}
        </button>
        {updateCheckResult === 'none' && (
          <p className="mt-2 text-sm text-green-600 dark:text-green-400">
            You're on the latest version!
          </p>
        )}
        {updateCheckResult === 'available' && (
          <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">
            Update available! Check the notification.
          </p>
        )}
      </div>
    </div>
  </div>
)}
```

**Step 3: Import APP_VERSION at the top of the file**

Add import:
```typescript
import { APP_VERSION } from '@/version';
```

**Step 4: Verify it compiles**

Run: `cd packages/frontend && npm run build`
Expected: No TypeScript errors

**Step 5: Commit**

```bash
git add packages/frontend/src/pages/settings/SettingsPage.tsx
git commit -m "feat(updater): add Updates section to Settings page"
```

---

## Task 9: Wire Up Dialogs in App.tsx

**Files:**
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Add imports**

```typescript
import { UpdatePrompt, WhatsNewDialog } from '@/components/updates';
```

**Step 2: Add state for update dialogs**

Near the top of the App component, add:

```typescript
// Update dialog state
const [updateInfo, setUpdateInfo] = useState<{ version: string; downloadUrl: string } | null>(null);
const [whatsNewReleases, setWhatsNewReleases] = useState<Array<{ version: string; notes: string }> | null>(null);
```

**Step 3: Add effect to listen for update events**

```typescript
// Listen for update events from Electron
useEffect(() => {
  if (!window.electronAPI) return;

  const cleanupAvailable = window.electronAPI.onUpdateAvailable((data) => {
    setUpdateInfo(data);
  });

  const cleanupWhatsNew = window.electronAPI.onShowWhatsNew((data) => {
    setWhatsNewReleases(data.releases);
  });

  return () => {
    cleanupAvailable();
    cleanupWhatsNew();
  };
}, []);
```

**Step 4: Add dialog components to the render**

Add before the closing fragment or at the end of the component's return:

```tsx
{/* Update Prompt */}
{updateInfo && (
  <UpdatePrompt
    version={updateInfo.version}
    downloadUrl={updateInfo.downloadUrl}
    onUpdate={() => {/* Download started, prompt handles rest */}}
    onDismiss={() => setUpdateInfo(null)}
  />
)}

{/* What's New Dialog */}
{whatsNewReleases && whatsNewReleases.length > 0 && (
  <WhatsNewDialog
    releases={whatsNewReleases}
    onDismiss={() => setWhatsNewReleases(null)}
  />
)}
```

**Step 5: Verify it compiles**

Run: `cd packages/frontend && npm run build`
Expected: No TypeScript errors

**Step 6: Commit**

```bash
git add packages/frontend/src/app/App.tsx
git commit -m "feat(updater): wire up UpdatePrompt and WhatsNewDialog in App"
```

---

## Task 10: Final Integration Test

**Step 1: Build the Electron app**

```bash
cd apps/electron && npm run build
```

Expected: No build errors

**Step 2: Build the frontend**

```bash
cd packages/frontend && npm run build
```

Expected: No build errors

**Step 3: Run lint checks**

```bash
npm run lint
```

Expected: No lint errors

**Step 4: Commit any final fixes**

If there are any TypeScript or lint errors, fix them and commit:

```bash
git add -A
git commit -m "fix(updater): resolve build/lint issues"
```

**Step 5: Final commit for the feature**

```bash
git add -A
git commit -m "feat: implement auto-update with release notes (#96)"
```

---

## Summary

This implementation provides:

1. **Seamless auto-updates** for unsigned macOS apps via:
   - GitHub Releases API for version checking
   - DMG download with progress reporting
   - Quarantine attribute removal (`xattr -c`)
   - Shell script handoff for app replacement

2. **What's New dialog** showing combined release notes on first launch after update

3. **Settings integration** with:
   - Version display
   - Auto-update toggle
   - Manual "Check for Updates" button

4. **Error handling** with fallback to manual download link

All communication happens via IPC channels between Electron main process and React frontend, with electron-store persisting user preferences.
