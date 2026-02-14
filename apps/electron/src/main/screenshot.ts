import { BrowserWindow, desktopCapturer, screen, nativeImage } from 'electron';
import { execFile } from 'child_process';
import { readFile, unlink, mkdir, access } from 'fs/promises';
import path from 'path';
import os from 'os';

export interface ScreenshotResult {
  data: string | null; // base64 PNG, or null if cancelled
  width: number;
  height: number;
}

const CANCELLED: ScreenshotResult = { data: null, width: 0, height: 0 };
const TEMP_DIR = path.join(os.tmpdir(), 'verbatim-screenshots');

/**
 * Capture a screenshot using platform-native tools.
 * macOS: uses screencapture -i (native crosshair selection).
 * Windows: uses desktopCapturer + transparent overlay for region selection.
 */
export async function captureScreenshot(
  callerWindow: BrowserWindow
): Promise<ScreenshotResult> {
  if (process.platform === 'darwin') {
    return captureScreenshotMac(callerWindow);
  } else {
    return captureScreenshotWindows(callerWindow);
  }
}

// ---------------------------------------------------------------------------
// macOS — shell out to screencapture -i
// ---------------------------------------------------------------------------

async function captureScreenshotMac(
  callerWindow: BrowserWindow
): Promise<ScreenshotResult> {
  await mkdir(TEMP_DIR, { recursive: true });
  const tmpPath = path.join(TEMP_DIR, `screenshot-${Date.now()}.png`);

  try {
    callerWindow.hide();
    await delay(300); // let the hide animation finish

    await new Promise<void>((resolve) => {
      // -i  interactive (region/window selection)
      // -x  no shutter sound
      execFile('screencapture', ['-i', '-x', tmpPath], () => resolve());
    });

    // screencapture exits 0 regardless — check if the file was created
    const fileExists = await access(tmpPath).then(() => true).catch(() => false);
    if (!fileExists) {
      return CANCELLED;
    }

    const buf = await readFile(tmpPath);
    const img = nativeImage.createFromBuffer(buf);
    const size = img.getSize();

    // Clean up temp file
    await unlink(tmpPath).catch(() => {});

    return {
      data: buf.toString('base64'),
      width: size.width,
      height: size.height,
    };
  } finally {
    callerWindow.show();
  }
}

// ---------------------------------------------------------------------------
// Windows — desktopCapturer + transparent overlay
// ---------------------------------------------------------------------------

async function captureScreenshotWindows(
  callerWindow: BrowserWindow
): Promise<ScreenshotResult> {
  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh } = display.size;
  const scaleFactor = display.scaleFactor;

  // Capture the screen at native resolution
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: dw * scaleFactor, height: dh * scaleFactor },
  });

  if (sources.length === 0) return CANCELLED;

  const fullImage = sources[0].thumbnail;
  const fullBase64 = fullImage.toPNG().toString('base64');

  try {
    callerWindow.hide();
    await delay(200);

    const selection = await showSelectionOverlay(fullBase64, dw, dh, display);

    if (!selection) return CANCELLED;

    // Crop the full image to the selected region (account for scale factor)
    const cropped = fullImage.crop({
      x: Math.round(selection.x * scaleFactor),
      y: Math.round(selection.y * scaleFactor),
      width: Math.round(selection.w * scaleFactor),
      height: Math.round(selection.h * scaleFactor),
    });

    const pngBuf = cropped.toPNG();
    const size = cropped.getSize();

    return {
      data: pngBuf.toString('base64'),
      width: size.width,
      height: size.height,
    };
  } finally {
    callerWindow.show();
  }
}

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function showSelectionOverlay(
  screenBase64: string,
  width: number,
  height: number,
  display: Electron.Display
): Promise<SelectionRect | null> {
  return new Promise((resolve) => {
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreen: true,
      resizable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let resolved = false;
    const done = (result: SelectionRect | null) => {
      if (resolved) return;
      resolved = true;
      overlay.close();
      resolve(result);
    };

    overlay.on('closed', () => done(null));

    const html = buildOverlayHtml(screenBase64, width, height);
    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    overlay.webContents.once('did-finish-load', () => {
      // Poll for the result set by the overlay's JS
      const poll = setInterval(() => {
        if (resolved) {
          clearInterval(poll);
          return;
        }
        overlay.webContents
          .executeJavaScript('window.__screenshotResult')
          .then((val: string | undefined) => {
            if (!val) return;
            clearInterval(poll);
            if (val === 'cancelled') {
              done(null);
            } else {
              try {
                done(JSON.parse(val));
              } catch {
                done(null);
              }
            }
          })
          .catch(() => {});
      }, 50);
    });
  });
}

function buildOverlayHtml(
  screenBase64: string,
  width: number,
  height: number
): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  -webkit-app-region: no-drag;
}
body {
  background: url('data:image/png;base64,${screenBase64}') no-repeat top left;
  background-size: ${width}px ${height}px;
}
#overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
}
#selection {
  position: fixed;
  border: 2px solid #4B8FDE;
  background: transparent;
  display: none;
  pointer-events: none;
  z-index: 10;
}
/* Cut-out effect: the selection area is clear, rest is dimmed */
#selection::before {
  content: '';
  position: absolute;
  inset: -2px;
  box-shadow: 0 0 0 9999px rgba(0,0,0,0.35);
}
#dims {
  position: fixed;
  padding: 2px 6px;
  background: rgba(0,0,0,0.7);
  color: #fff;
  font: 11px/1.4 -apple-system, 'Segoe UI', sans-serif;
  border-radius: 3px;
  display: none;
  z-index: 20;
  pointer-events: none;
}
#hint {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 8px 16px;
  background: rgba(0,0,0,0.6);
  color: #e2e8f0;
  font: 13px/1.4 -apple-system, 'Segoe UI', sans-serif;
  border-radius: 6px;
  z-index: 5;
  pointer-events: none;
}
</style></head><body>
<div id="overlay"></div>
<div id="selection"></div>
<div id="dims"></div>
<div id="hint">Click and drag to select a region &middot; Press Esc to cancel</div>
<script>
(function() {
  const sel = document.getElementById('selection');
  const dims = document.getElementById('dims');
  const hint = document.getElementById('hint');
  let startX = 0, startY = 0, dragging = false;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    hint.style.display = 'none';
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    sel.style.display = 'block';
    sel.style.left = startX + 'px';
    sel.style.top = startY + 'px';
    sel.style.width = '0px';
    sel.style.height = '0px';
    dims.style.display = 'block';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    sel.style.left = x + 'px';
    sel.style.top = y + 'px';
    sel.style.width = w + 'px';
    sel.style.height = h + 'px';
    dims.textContent = w + ' × ' + h;
    dims.style.left = (x + w + 8) + 'px';
    dims.style.top = (y + h + 8) + 'px';
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    if (w < 5 || h < 5) {
      // Too small, treat as cancel
      window.__screenshotResult = 'cancelled';
      return;
    }
    window.__screenshotResult = JSON.stringify({ x: x, y: y, w: w, h: h });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.__screenshotResult = 'cancelled';
    }
  });
})();
</script>
</body></html>`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
