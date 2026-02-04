# Auto-Update with Release Notes Design

**Issue**: #96 - Add automatic update checking with release notes dialog
**Date**: 2026-02-04
**Status**: Approved

## Summary

Implement automatic update checking that downloads and installs updates seamlessly, plus a "What's New" dialog showing combined release notes on first launch after updating.

## Architecture Overview

```
┌─────────────────┐         IPC          ┌─────────────────┐
│  Electron Main  │◄───────────────────►│    Frontend     │
│                 │                      │                 │
│  - GitHub API   │  update-available    │  - UpdatePrompt │
│  - Download DMG │  update-downloading  │  - WhatsNewDialog│
│  - Mount/Install│  show-whats-new      │  - Settings     │
│  - electron-store│                     │                 │
└─────────────────┘                      └─────────────────┘
```

### Key Flows

**Update Check Flow:**
1. App launches → check GitHub releases API
2. Compare latest version against current
3. If newer: send `update-available` to frontend
4. Frontend shows simple prompt: "Update now / Later"

**Seamless Update Flow:**
1. User clicks "Update Now"
2. Electron downloads `.dmg` to `/tmp/verbatim-update/`
3. Remove quarantine: `xattr -c <file>`
4. Mount DMG: `hdiutil attach -nobrowse <dmg>`
5. Generate updater shell script
6. Spawn script (detached), quit app
7. Script waits for app to exit, replaces `/Applications/Verbatim Studio.app`, relaunches

**What's New Flow:**
1. App launches → compare `currentVersion` vs `lastSeenVersion`
2. If newer: fetch release notes for all versions in between
3. Show What's New dialog with combined notes
4. User clicks "Got it" → update `lastSeenVersion`

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Check frequency | Launch + 24 hours | Industry standard, not excessive |
| Update prompt | Simple (no release notes) | Keep decision quick |
| Release notes timing | After update, first launch | Better UX, user sees what changed |
| Skip version feature | No | YAGNI, adds complexity |
| Settings controls | Toggle + Button + Version | Full control without over-engineering |
| Download mechanism | Seamless auto-replace | Best UX for unsigned app |

## Seamless Update Mechanism

Since the app is unsigned, standard `electron-updater` auto-update won't work on macOS. Custom implementation:

### Phase 1: Download
```javascript
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// Fetch correct asset for architecture
const arch = process.arch; // 'arm64' or 'x64'
const asset = release.assets.find(a => a.name.includes(arch) && a.name.endsWith('.dmg'));

// Download to temp
const dmgPath = '/tmp/verbatim-update/Verbatim-Studio.dmg';
await downloadFile(asset.browser_download_url, dmgPath);

// Remove quarantine (using execFile for safety)
await execFileAsync('xattr', ['-c', dmgPath]);
```

### Phase 2: Prepare
```javascript
// Mount DMG (using execFile for safety)
const { stdout } = await execFileAsync('hdiutil', ['attach', '-nobrowse', dmgPath]);
const volumePath = parseVolumePath(stdout); // e.g., /Volumes/Verbatim Studio

// Generate updater script
const script = generateUpdaterScript(volumePath);
await writeFile('/tmp/verbatim-update/update.sh', script);
await execFileAsync('chmod', ['+x', '/tmp/verbatim-update/update.sh']);
```

### Phase 3: Handoff
```javascript
// Spawn detached updater
spawn('/tmp/verbatim-update/update.sh', [], {
  detached: true,
  stdio: 'ignore'
}).unref();

// Quit app
app.quit();
```

### Updater Script
```bash
#!/bin/bash
APP_NAME="Verbatim Studio"
VOLUME_PATH="/Volumes/Verbatim Studio"
APP_PATH="/Applications/Verbatim Studio.app"

# Wait for app to quit
while pgrep -x "$APP_NAME" > /dev/null; do sleep 0.5; done

# Replace app
rm -rf "$APP_PATH"
cp -R "$VOLUME_PATH/$APP_NAME.app" "/Applications/"

# Launch new version
open "$APP_PATH"

# Cleanup
hdiutil detach "$VOLUME_PATH" -quiet
rm -rf /tmp/verbatim-update
```

## IPC Communication

### Electron → Frontend

| Channel | Payload | When |
|---------|---------|------|
| `update-available` | `{ version, downloadUrl }` | New version detected |
| `update-downloading` | `{ percent }` | Download progress |
| `update-ready` | `{ version }` | Ready to install |
| `update-error` | `{ message }` | Something failed |
| `show-whats-new` | `{ releases: [{version, notes}] }` | First launch after update |

### Frontend → Electron

| Channel | Payload | When |
|---------|---------|------|
| `start-update` | `{ version }` | User clicks "Update Now" |
| `dismiss-update` | `{}` | User clicks "Later" |
| `check-for-updates` | `{}` | Manual check from Settings |
| `whats-new-seen` | `{ version }` | User dismisses What's New |
| `get-update-settings` | `{}` | Settings page loads |
| `set-auto-update` | `{ enabled }` | User toggles setting |

## Electron Store Schema

```typescript
interface UpdateStore {
  autoUpdateEnabled: boolean;  // default: true
  lastUpdateCheck: number;     // timestamp
  lastSeenVersion: string;     // e.g., "0.26.22"
}
```

## Frontend Components

### WhatsNewDialog
- Modal shown on first launch after update
- Fetches and displays combined release notes
- Markdown rendering for release notes
- Scrollable content area
- "Got it" button dismisses and updates `lastSeenVersion`

```
┌─────────────────────────────────────┐
│  What's New                      ✕  │
├─────────────────────────────────────┤
│  v0.26.23                           │
│  • Live updates for all pages       │
│  • Search history improvements      │
│                                     │
│  v0.26.22                           │
│  • Show recent searches when empty  │
│                                     │
│              [ Got it ]             │
└─────────────────────────────────────┘
```

### UpdatePrompt
- Simple modal when update available
- Shows version number only
- "Update Now" / "Later" buttons
- Progress indicator during download

```
┌─────────────────────────────────────┐
│  Update Available                   │
│                                     │
│  Version 0.26.23 is available.      │
│                                     │
│      [ Later ]  [ Update Now ]      │
└─────────────────────────────────────┘
```

### Settings Updates Section
- Part of existing Settings page
- Shows current version
- Toggle for automatic update checks
- Manual "Check for Updates" button

```
┌─────────────────────────────────────┐
│  Updates                            │
│                                     │
│  Version: v0.26.23                  │
│                                     │
│  [Toggle] Check for updates         │
│           automatically             │
│                                     │
│  [ Check for Updates ]              │
└─────────────────────────────────────┘
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| GitHub API rate limit | Skip silently, retry next cycle (24h) |
| Network offline | Skip silently, retry next cycle |
| Download fails | Show error toast, offer retry, fallback link |
| DMG mount fails | Show error with manual download link |
| App replacement fails | Log error, preserve old app, show fallback |
| Wrong architecture | Detect arch on startup, fetch correct asset |

**Fallback:** If any step fails, show error with link to GitHub releases page for manual download.

## Files to Create/Modify

| File | Action |
|------|--------|
| `apps/electron/src/main/updater.ts` | Rewrite |
| `apps/electron/src/main/update-script.ts` | Create |
| `apps/electron/src/preload/index.ts` | Modify (add IPC) |
| `packages/frontend/src/components/updates/WhatsNewDialog.tsx` | Create |
| `packages/frontend/src/components/updates/UpdatePrompt.tsx` | Create |
| `packages/frontend/src/pages/settings/SettingsPage.tsx` | Modify |
| `packages/frontend/src/app/App.tsx` | Modify (wire dialogs) |

## Implementation Order

1. **Electron updater rewrite** - GitHub API, download, mount, script generation
2. **IPC channels** - Add all channels to preload
3. **UpdatePrompt component** - Simple update available modal
4. **WhatsNewDialog component** - Markdown release notes display
5. **Settings integration** - Toggle, button, version display
6. **App.tsx wiring** - Connect dialogs to IPC events
7. **Testing** - Manual testing of full update flow
