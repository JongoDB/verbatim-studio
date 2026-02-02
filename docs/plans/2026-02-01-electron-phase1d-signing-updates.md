# Electron Phase 1d: Code Signing & Auto-Updates

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add code signing for macOS/Windows and configure auto-updates via electron-updater.

**Architecture:** electron-builder handles code signing with certificates from GitHub Secrets. electron-updater checks GitHub Releases for updates.

**Tech Stack:** electron-builder, electron-updater, Apple Developer certificates, Windows code signing

---

## Task 1: Add electron-updater Dependency

**Files:**
- Modify: `apps/electron/package.json`

**Step 1: Add electron-updater**

Add to dependencies in `apps/electron/package.json`:

```json
"dependencies": {
  "electron-updater": "^6.3.0"
}
```

**Step 2: Install**

```bash
cd apps/electron && pnpm install
```

**Step 3: Commit**

```bash
git add apps/electron/package.json pnpm-lock.yaml
git commit -m "chore(electron): add electron-updater dependency"
```

---

## Task 2: Implement Auto-Update Logic

**Files:**
- Create: `apps/electron/src/main/updater.ts`
- Modify: `apps/electron/src/main/index.ts`

**Step 1: Create updater module**

Create `apps/electron/src/main/updater.ts`:

```typescript
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

  // Check for updates on startup
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] Error checking for updates:', err);
  });

  // Update available
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `A new version (${info.version}) is available.`,
      detail: 'Would you like to download it now?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  // Download progress
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Download progress: ${progress.percent.toFixed(1)}%`);
    mainWindow.webContents.send('update-download-progress', progress.percent);
  });

  // Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded. Restart to apply?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
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
    autoUpdater.checkForUpdates();
  }
}
```

**Step 2: Initialize updater in main**

Add to `apps/electron/src/main/index.ts` after window creation:

```typescript
import { initAutoUpdater } from './updater';

// After mainWindow is created:
initAutoUpdater(mainWindow);
```

**Step 3: Build and verify**

```bash
cd apps/electron && pnpm build
```

**Step 4: Commit**

```bash
git add apps/electron/src/main/updater.ts apps/electron/src/main/index.ts
git commit -m "feat(electron): add auto-update support"
```

---

## Task 3: Configure electron-builder for Updates

**Files:**
- Modify: `apps/electron/package.json`

**Step 1: Add publish configuration**

Add to the `build` section in `apps/electron/package.json`:

```json
"build": {
  ...
  "publish": {
    "provider": "github",
    "owner": "JongoDB",
    "repo": "verbatim-studio"
  }
}
```

**Step 2: Commit**

```bash
git add apps/electron/package.json
git commit -m "feat(electron): configure GitHub releases for auto-updates"
```

---

## Task 4: Document Code Signing Setup

**Files:**
- Create: `docs/electron-code-signing.md`

**Step 1: Create documentation**

Create `docs/electron-code-signing.md`:

```markdown
# Electron Code Signing Setup

## macOS Code Signing

### Prerequisites
1. Apple Developer account ($99/year)
2. Developer ID Application certificate

### Generate Certificate
1. Open Keychain Access
2. Request a certificate from a certificate authority
3. Upload to Apple Developer portal
4. Download and install Developer ID Application certificate

### Export for CI
1. Export certificate as .p12 file with password
2. Base64 encode: `base64 -i certificate.p12 | pbcopy`
3. Add to GitHub Secrets:
   - `MAC_CERTS`: Base64-encoded .p12 file
   - `MAC_CERTS_PASSWORD`: .p12 password

### Notarization (Required for macOS 10.15+)
Add to GitHub Secrets:
- `APPLE_ID`: Your Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific password from appleid.apple.com
- `APPLE_TEAM_ID`: Your team ID from developer.apple.com

## Windows Code Signing

### Prerequisites
1. EV Code Signing Certificate from trusted CA
2. Hardware token (required for EV certs)

### For CI (Cloud Signing)
Use a cloud signing service like:
- Azure SignTool
- DigiCert KeyLocker
- SSL.com eSigner

Add to GitHub Secrets:
- `WIN_CSC_LINK`: Path or URL to certificate
- `WIN_CSC_KEY_PASSWORD`: Certificate password

## GitHub Secrets Required

| Secret | Platform | Description |
|--------|----------|-------------|
| `MAC_CERTS` | macOS | Base64-encoded .p12 certificate |
| `MAC_CERTS_PASSWORD` | macOS | Certificate password |
| `APPLE_ID` | macOS | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password |
| `APPLE_TEAM_ID` | macOS | Apple Developer Team ID |
| `WIN_CSC_LINK` | Windows | Certificate file or URL |
| `WIN_CSC_KEY_PASSWORD` | Windows | Certificate password |
```

**Step 2: Commit**

```bash
git add docs/electron-code-signing.md
git commit -m "docs: add code signing setup guide"
```

---

## Task 5: Update Workflow for Code Signing

**Files:**
- Modify: `.github/workflows/build-electron.yml`

**Step 1: Add code signing environment variables**

Update the "Package Electron app" step:

```yaml
- name: Package Electron app
  run: pnpm --filter @verbatim/electron dist
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # macOS code signing
    CSC_LINK: ${{ secrets.MAC_CERTS }}
    CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTS_PASSWORD }}
    # macOS notarization
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    # Windows code signing
    WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

**Step 2: Commit**

```bash
git add .github/workflows/build-electron.yml
git commit -m "ci: add code signing secrets to build workflow"
```

---

## Task 6: Add Menu Item for Manual Update Check

**Files:**
- Modify: `apps/electron/src/main/index.ts`

**Step 1: Add Help menu with update check**

```typescript
import { Menu } from 'electron';
import { checkForUpdates } from './updater';

// Create application menu
const template: Electron.MenuItemConstructorOptions[] = [
  // ... existing menus ...
  {
    label: 'Help',
    submenu: [
      {
        label: 'Check for Updates...',
        click: () => checkForUpdates(),
      },
      { type: 'separator' },
      {
        label: 'About Verbatim Studio',
        role: 'about',
      },
    ],
  },
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
```

**Step 2: Commit**

```bash
git add apps/electron/src/main/index.ts
git commit -m "feat(electron): add Check for Updates menu item"
```

---

## Summary

After completing these tasks:

1. ✅ electron-updater installed and configured
2. ✅ Auto-update logic with user prompts
3. ✅ GitHub Releases configured as update source
4. ✅ Code signing documentation
5. ✅ CI workflow ready for code signing (needs secrets)
6. ✅ Manual update check in Help menu

**To enable code signing:**
1. Obtain certificates (Apple Developer, Windows EV)
2. Add secrets to GitHub repository settings
3. Builds will automatically sign when secrets are present

**Next steps (Phase 2):**
- ML dependencies on-demand installation UI
- Backend `/api/ml/status` and `/api/ml/install` endpoints
- ML Setup modal in frontend
