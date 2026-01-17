# Phase 1: Foundation - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the foundational monorepo structure with working Electron shell, FastAPI backend, and React frontend that communicate over localhost.

**Architecture:** pnpm monorepo with three packages (electron app, frontend, backend). Electron spawns Python backend as subprocess, frontend communicates via HTTP. SQLite for persistence.

**Tech Stack:** pnpm workspaces, Electron 28+, React 18 + Vite + shadcn/ui, FastAPI + SQLAlchemy + aiosqlite, TypeScript throughout JS code.

---

## Task 1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.nvmrc`

**Step 1: Create root package.json**

```json
{
  "name": "verbatim-studio",
  "version": "0.1.0",
  "private": true,
  "description": "Privacy-first transcription for professionals",
  "scripts": {
    "dev": "pnpm --filter frontend dev",
    "dev:electron": "pnpm --filter electron dev",
    "build": "pnpm --filter frontend build && pnpm --filter electron build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Step 3: Create .gitignore**

```
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
*.app
*.dmg

# Python
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
*.egg-info/
.eggs/

# IDE
.idea/
.vscode/
*.swp
*.swo
.DS_Store

# Environment
.env
.env.local
*.log

# Electron
out/

# Test
coverage/
.pytest_cache/

# Models (downloaded at runtime)
models/
*.bin
*.gguf
*.pt
```

**Step 4: Create .nvmrc**

```
20
```

**Step 5: Initialize pnpm and commit**

Run:
```bash
pnpm install
git add package.json pnpm-workspace.yaml .gitignore .nvmrc
git commit -m "chore: initialize pnpm monorepo structure"
```

---

## Task 2: Create Frontend Package Scaffold

**Files:**
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/index.html`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/tsconfig.node.json`
- Create: `packages/frontend/tailwind.config.ts`
- Create: `packages/frontend/postcss.config.js`
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/app/App.tsx`
- Create: `packages/frontend/src/index.css`

**Step 1: Create packages/frontend/package.json**

```json
{
  "name": "@verbatim/frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.1.1",
    "@tanstack/react-query": "^5.62.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.1",
    "lucide-react": "^0.469.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.17",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vite": "^6.0.6"
  }
}
```

**Step 2: Create packages/frontend/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" />
    <title>Verbatim Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 3: Create packages/frontend/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'electron' ? './' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: mode === 'electron' ? '../../apps/electron/renderer' : 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
```

**Step 4: Create packages/frontend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**Step 5: Create packages/frontend/tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

**Step 6: Create packages/frontend/tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};

export default config;
```

**Step 7: Create packages/frontend/postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**Step 8: Create packages/frontend/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

**Step 9: Create packages/frontend/src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Step 10: Create packages/frontend/src/app/App.tsx**

```tsx
export function App() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground mb-4">
          Verbatim Studio
        </h1>
        <p className="text-muted-foreground">
          Privacy-first transcription for professionals
        </p>
      </div>
    </div>
  );
}
```

**Step 11: Install dependencies and verify**

Run:
```bash
cd packages/frontend && pnpm install && cd ../..
pnpm --filter frontend dev
```

Expected: Vite dev server starts at http://localhost:5173, showing "Verbatim Studio" heading.

**Step 12: Commit**

Run:
```bash
git add packages/frontend/
git commit -m "feat: add React frontend scaffold with Vite and Tailwind"
```

---

## Task 3: Create Electron App Scaffold

**Files:**
- Create: `apps/electron/package.json`
- Create: `apps/electron/tsconfig.json`
- Create: `apps/electron/src/main/index.ts`
- Create: `apps/electron/src/main/windows.ts`
- Create: `apps/electron/src/preload/index.ts`

**Step 1: Create apps/electron/package.json**

```json
{
  "name": "@verbatim/electron",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "concurrently \"pnpm dev:main\" \"pnpm dev:preload\"",
    "dev:main": "tsc -p tsconfig.json --watch",
    "dev:preload": "tsc -p tsconfig.preload.json --watch",
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.preload.json",
    "start": "electron .",
    "pack": "electron-builder --dir",
    "dist": "electron-builder"
  },
  "dependencies": {
    "electron-updater": "^6.3.9"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "concurrently": "^9.1.2",
    "electron": "^34.0.0",
    "electron-builder": "^25.1.8",
    "typescript": "^5.7.2"
  },
  "build": {
    "appId": "com.verbatimstudio.app",
    "productName": "Verbatim Studio",
    "directories": {
      "output": "../../dist"
    },
    "mac": {
      "category": "public.app-category.productivity",
      "target": [
        {
          "target": "dmg",
          "arch": ["arm64"]
        }
      ],
      "hardenedRuntime": true,
      "gatekeeperAssess": false
    },
    "extraResources": [
      {
        "from": "../../build/resources",
        "to": ".",
        "filter": ["**/*"]
      }
    ]
  }
}
```

**Step 2: Create apps/electron/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist/main",
    "rootDir": "src/main",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "declarationMap": false,
    "sourceMap": true
  },
  "include": ["src/main/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 3: Create apps/electron/tsconfig.preload.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "outDir": "dist/preload",
    "rootDir": "src/preload",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  },
  "include": ["src/preload/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create apps/electron/src/main/index.ts**

```typescript
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
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
```

**Step 5: Create apps/electron/src/main/windows.ts**

```typescript
import { BrowserWindow, shell, app } from 'electron';
import path from 'path';

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Verbatim Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
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
    // Production: load bundled frontend
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

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
```

**Step 6: Create apps/electron/src/preload/index.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // App info
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // Window controls
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),
});

// Type declaration for renderer
declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform;
      getAppVersion: () => Promise<string>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  }
}
```

**Step 7: Install dependencies and build**

Run:
```bash
cd apps/electron && pnpm install && pnpm build && cd ../..
```

**Step 8: Test Electron with frontend**

Run (in two terminals):
```bash
# Terminal 1: Start frontend dev server
pnpm --filter frontend dev

# Terminal 2: Start Electron
cd apps/electron && pnpm start
```

Expected: Electron window opens showing the React app.

**Step 9: Commit**

Run:
```bash
git add apps/electron/
git commit -m "feat: add Electron shell with window management"
```

---

## Task 4: Create Python Backend Scaffold

**Files:**
- Create: `packages/backend/pyproject.toml`
- Create: `packages/backend/api/__init__.py`
- Create: `packages/backend/api/main.py`
- Create: `packages/backend/api/routes/__init__.py`
- Create: `packages/backend/api/routes/health.py`
- Create: `packages/backend/core/__init__.py`
- Create: `packages/backend/core/config.py`

**Step 1: Create packages/backend/pyproject.toml**

```toml
[project]
name = "verbatim-backend"
version = "0.1.0"
description = "Verbatim Studio Backend API"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "pydantic>=2.10.0",
    "pydantic-settings>=2.7.0",
    "sqlalchemy>=2.0.0",
    "aiosqlite>=0.20.0",
    "httpx>=0.28.0",
    "python-multipart>=0.0.18",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "ruff>=0.8.0",
]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

**Step 2: Create packages/backend/api/__init__.py**

```python
"""Verbatim Studio API."""
```

**Step 3: Create packages/backend/core/__init__.py**

```python
"""Core configuration and utilities."""
```

**Step 4: Create packages/backend/core/config.py**

```python
"""Application configuration."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # Deployment mode
    MODE: Literal["basic", "enterprise"] = "basic"

    # API settings
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./verbatim.db"

    # Data paths
    DATA_DIR: Path = Path.home() / "Library" / "Application Support" / "Verbatim Studio"
    MEDIA_DIR: Path | None = None
    MODELS_DIR: Path | None = None

    # Auth (disabled in basic mode)
    AUTH_ENABLED: bool = False

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Set derived paths
        if self.MEDIA_DIR is None:
            self.MEDIA_DIR = self.DATA_DIR / "media"
        if self.MODELS_DIR is None:
            self.MODELS_DIR = self.DATA_DIR / "models"

    def ensure_directories(self) -> None:
        """Create required directories."""
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        self.MODELS_DIR.mkdir(parents=True, exist_ok=True)

    model_config = {"env_prefix": "VERBATIM_"}


settings = Settings()
```

**Step 5: Create packages/backend/api/routes/__init__.py**

```python
"""API routes."""
```

**Step 6: Create packages/backend/api/routes/health.py**

```python
"""Health check endpoints."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    """Basic health check."""
    return {"status": "healthy"}


@router.get("/health/ready")
async def readiness_check() -> dict:
    """Readiness check including dependencies."""
    # TODO: Check database, ML services
    return {
        "status": "ready",
        "services": {
            "database": "healthy",
            "whisper": "not_configured",
            "llama": "not_configured",
        },
    }
```

**Step 7: Create packages/backend/api/main.py**

```python
"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from api.routes import health


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    settings.ensure_directories()
    yield
    # Shutdown


app = FastAPI(
    title="Verbatim Studio API",
    description="Privacy-first transcription backend",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Verbatim Studio API",
        "version": "0.1.0",
        "mode": settings.MODE,
    }
```

**Step 8: Create virtual environment and install**

Run:
```bash
cd packages/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ../..
```

**Step 9: Test backend starts**

Run:
```bash
cd packages/backend
source .venv/bin/activate
uvicorn api.main:app --reload --port 8000
```

Expected: Server starts at http://127.0.0.1:8000

**Step 10: Test health endpoint**

Run:
```bash
curl http://127.0.0.1:8000/health
```

Expected: `{"status":"healthy"}`

**Step 11: Commit**

Run:
```bash
git add packages/backend/
git commit -m "feat: add FastAPI backend scaffold with health check"
```

---

## Task 5: Connect Frontend to Backend

**Files:**
- Create: `packages/frontend/src/lib/api.ts`
- Modify: `packages/frontend/src/app/App.tsx`

**Step 1: Create packages/frontend/src/lib/api.ts**

```typescript
const API_BASE_URL = 'http://127.0.0.1:8000';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Health
  health = {
    check: () => this.request<{ status: string }>('/health'),
    ready: () =>
      this.request<{
        status: string;
        services: Record<string, string>;
      }>('/health/ready'),
  };

  // Root info
  info = () =>
    this.request<{
      name: string;
      version: string;
      mode: string;
    }>('/');
}

export const api = new ApiClient();
```

**Step 2: Update packages/frontend/src/app/App.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ApiInfo {
  name: string;
  version: string;
  mode: string;
}

interface HealthStatus {
  status: string;
  services: Record<string, string>;
}

export function App() {
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkBackend() {
      try {
        const [info, healthStatus] = await Promise.all([
          api.info(),
          api.health.ready(),
        ]);
        setApiInfo(info);
        setHealth(healthStatus);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to backend');
      }
    }

    checkBackend();
    const interval = setInterval(checkBackend, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold text-foreground">Verbatim Studio</h1>
        <p className="text-muted-foreground">
          Privacy-first transcription for professionals
        </p>

        <div className="mt-8 p-6 rounded-lg border bg-card">
          <h2 className="text-lg font-semibold mb-4">Backend Status</h2>

          {error ? (
            <div className="text-destructive">
              <p className="font-medium">Connection Error</p>
              <p className="text-sm">{error}</p>
              <p className="text-sm mt-2 text-muted-foreground">
                Make sure the backend is running on port 8000
              </p>
            </div>
          ) : apiInfo ? (
            <div className="space-y-2 text-left">
              <div className="flex justify-between">
                <span className="text-muted-foreground">API:</span>
                <span className="font-mono">{apiInfo.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version:</span>
                <span className="font-mono">{apiInfo.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode:</span>
                <span className="font-mono">{apiInfo.mode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span
                  className={`font-mono ${health?.status === 'ready' ? 'text-green-600' : 'text-yellow-600'}`}
                >
                  {health?.status || 'checking...'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Connecting...</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Test frontend-backend connection**

Run (in three terminals):
```bash
# Terminal 1: Backend
cd packages/backend && source .venv/bin/activate && uvicorn api.main:app --reload

# Terminal 2: Frontend
pnpm --filter frontend dev

# Terminal 3: Electron
cd apps/electron && pnpm start
```

Expected: Electron window shows backend status as "ready" with version info.

**Step 4: Commit**

Run:
```bash
git add packages/frontend/src/lib/api.ts packages/frontend/src/app/App.tsx
git commit -m "feat: connect frontend to backend API"
```

---

## Task 6: Add Database with SQLAlchemy

**Files:**
- Create: `packages/backend/persistence/__init__.py`
- Create: `packages/backend/persistence/database.py`
- Create: `packages/backend/persistence/models.py`
- Modify: `packages/backend/api/main.py`

**Step 1: Create packages/backend/persistence/__init__.py**

```python
"""Database persistence layer."""

from .database import get_db, init_db
from .models import Base

__all__ = ["get_db", "init_db", "Base"]
```

**Step 2: Create packages/backend/persistence/database.py**

```python
"""Database connection and session management."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for database sessions."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Initialize database tables."""
    from .models import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

**Step 3: Create packages/backend/persistence/models.py**

```python
"""SQLAlchemy models."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""

    pass


def generate_uuid() -> str:
    """Generate a UUID string."""
    return str(uuid.uuid4())


class Project(Base):
    """Project model for organizing recordings."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    recordings: Mapped[list["Recording"]] = relationship(back_populates="project")


class Recording(Base):
    """Recording model for audio/video files."""

    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    project: Mapped[Project | None] = relationship(back_populates="recordings")
    transcript: Mapped["Transcript | None"] = relationship(back_populates="recording")


class Transcript(Base):
    """Transcript model linked to recordings."""

    __tablename__ = "transcripts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    recording_id: Mapped[str] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False
    )
    language: Mapped[str | None] = mapped_column(String(10))
    model_used: Mapped[str | None] = mapped_column(String(50))
    confidence_avg: Mapped[float | None] = mapped_column(Float)
    word_count: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    recording: Mapped[Recording] = relationship(back_populates="transcript")
    segments: Mapped[list["Segment"]] = relationship(back_populates="transcript")


class Segment(Base):
    """Segment model for transcript utterances."""

    __tablename__ = "segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    transcript_id: Mapped[str] = mapped_column(
        ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    segment_index: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker: Mapped[str | None] = mapped_column(String(100))
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    transcript: Mapped[Transcript] = relationship(back_populates="segments")


class Job(Base):
    """Job queue model for async tasks."""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    job_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    started_at: Mapped[datetime | None] = mapped_column()
    completed_at: Mapped[datetime | None] = mapped_column()


class Setting(Base):
    """Application settings model."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())
```

**Step 4: Update packages/backend/api/main.py**

```python
"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import health
from core.config import settings
from persistence import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    settings.ensure_directories()
    await init_db()
    yield
    # Shutdown


app = FastAPI(
    title="Verbatim Studio API",
    description="Privacy-first transcription backend",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Verbatim Studio API",
        "version": "0.1.0",
        "mode": settings.MODE,
    }
```

**Step 5: Test database initialization**

Run:
```bash
cd packages/backend
source .venv/bin/activate
uvicorn api.main:app --reload
```

Expected: Server starts and creates `verbatim.db` in the current directory.

**Step 6: Verify database was created**

Run:
```bash
sqlite3 packages/backend/verbatim.db ".tables"
```

Expected: `jobs  projects  recordings  segments  settings  transcripts`

**Step 7: Commit**

Run:
```bash
git add packages/backend/persistence/
git add packages/backend/api/main.py
git commit -m "feat: add SQLAlchemy models and database initialization"
```

---

## Task 7: Add Electron Backend Process Management

**Files:**
- Create: `apps/electron/src/main/backend.ts`
- Modify: `apps/electron/src/main/index.ts`

**Step 1: Create apps/electron/src/main/backend.ts**

```typescript
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';

interface BackendConfig {
  port: number;
  pythonPath?: string;
  backendPath?: string;
}

class BackendManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: BackendConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: BackendConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.process) {
      console.log('[Backend] Already running');
      return;
    }

    const pythonPath = this.config.pythonPath || this.getPythonPath();
    const backendPath = this.config.backendPath || this.getBackendPath();

    console.log(`[Backend] Starting: ${pythonPath} at ${backendPath}`);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VERBATIM_MODE: 'basic',
      VERBATIM_API_PORT: String(this.config.port),
      VERBATIM_DATA_DIR: app.getPath('userData'),
    };

    this.process = spawn(
      pythonPath,
      ['-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', String(this.config.port)],
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
      this.emit('exit', code);
    });

    this.process.on('error', (err: Error) => {
      console.error(`[Backend] Process error: ${err.message}`);
      this.emit('error', err);
    });

    await this.waitForHealth();
    this.startHealthCheck();
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (!this.process) return;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          console.log('[Backend] Force killing');
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.process!.on('exit', () => {
        clearTimeout(timeout);
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
      return path.join(resourcesPath, 'python', 'bin', 'python3.11');
    } else {
      // Development: Use venv Python
      return path.join(__dirname, '../../../../packages/backend/.venv/bin/python');
    }
  }

  private getBackendPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'python', 'backend');
    } else {
      return path.join(__dirname, '../../../../packages/backend');
    }
  }

  private async waitForHealth(timeout = 30000): Promise<void> {
    const startTime = Date.now();
    const url = `http://127.0.0.1:${this.config.port}/health`;

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
        const response = await fetch(`http://127.0.0.1:${this.config.port}/health`);
        if (!response.ok) {
          this.emit('unhealthy');
        }
      } catch {
        this.emit('unhealthy');
      }
    }, 10000);
  }
}

export const backendManager = new BackendManager({ port: 8000 });
```

**Step 2: Update apps/electron/src/main/index.ts**

```typescript
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';
import { backendManager } from './backend';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  try {
    // Start backend in development (production will use bundled)
    if (!app.isPackaged) {
      console.log('[Main] Starting backend in development mode');
      await backendManager.start();
    }

    mainWindow = createMainWindow();
  } catch (error) {
    console.error('[Main] Failed to start:', error);
    app.quit();
  }
}

app.on('ready', bootstrap);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

app.on('before-quit', async () => {
  console.log('[Main] Shutting down...');
  await backendManager.stop();
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

// Handle backend events
backendManager.on('unhealthy', () => {
  console.warn('[Main] Backend unhealthy');
});

backendManager.on('exit', (code: number) => {
  console.warn(`[Main] Backend exited with code ${code}`);
  if (code !== 0 && code !== null) {
    // Unexpected exit, could show error dialog
  }
});
```

**Step 3: Test integrated startup**

Run:
```bash
# Make sure backend venv exists
cd packages/backend && source .venv/bin/activate && pip install -e . && deactivate && cd ../..

# Build and start Electron (which will start backend)
cd apps/electron && pnpm build && pnpm start
```

Expected: Electron starts, automatically launches backend, frontend shows "ready" status.

**Step 4: Commit**

Run:
```bash
git add apps/electron/src/main/backend.ts apps/electron/src/main/index.ts
git commit -m "feat: add backend process management to Electron"
```

---

## Task 8: Add Development Scripts

**Files:**
- Modify: `package.json`
- Create: `scripts/dev.sh`

**Step 1: Update root package.json**

```json
{
  "name": "verbatim-studio",
  "version": "0.1.0",
  "private": true,
  "description": "Privacy-first transcription for professionals",
  "scripts": {
    "dev": "./scripts/dev.sh",
    "dev:frontend": "pnpm --filter @verbatim/frontend dev",
    "dev:backend": "cd packages/backend && source .venv/bin/activate && uvicorn api.main:app --reload",
    "dev:electron": "pnpm --filter @verbatim/electron dev",
    "build": "pnpm build:frontend && pnpm build:electron",
    "build:frontend": "pnpm --filter @verbatim/frontend build",
    "build:electron": "pnpm --filter @verbatim/electron build",
    "start:electron": "cd apps/electron && pnpm start",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "clean": "rm -rf dist build node_modules/.cache"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

**Step 2: Create scripts/dev.sh**

```bash
#!/bin/bash
# Development startup script

set -e

echo "Starting Verbatim Studio development environment..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check dependencies
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is not installed"
    exit 1
fi

# Ensure backend venv exists
if [ ! -d "packages/backend/.venv" ]; then
    echo -e "${BLUE}Creating Python virtual environment...${NC}"
    cd packages/backend
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -e ".[dev]"
    deactivate
    cd ../..
fi

# Install node dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing Node dependencies...${NC}"
    pnpm install
fi

# Build Electron (needed for dev)
echo -e "${BLUE}Building Electron...${NC}"
cd apps/electron && pnpm build && cd ../..

# Start all services
echo -e "${GREEN}Starting services...${NC}"
echo "  - Frontend: http://localhost:5173"
echo "  - Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Use concurrently if available, otherwise run sequentially
if command -v npx &> /dev/null; then
    npx concurrently \
        --names "frontend,backend,electron" \
        --prefix-colors "cyan,yellow,magenta" \
        "pnpm dev:frontend" \
        "cd packages/backend && source .venv/bin/activate && uvicorn api.main:app --reload --port 8000" \
        "sleep 3 && cd apps/electron && pnpm start"
else
    echo "Install concurrently globally for better dev experience: npm i -g concurrently"
    # Fallback: just start frontend and backend
    cd packages/backend && source .venv/bin/activate && uvicorn api.main:app --reload --port 8000 &
    BACKEND_PID=$!
    pnpm dev:frontend &
    FRONTEND_PID=$!

    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
    wait
fi
```

**Step 3: Make script executable**

Run:
```bash
chmod +x scripts/dev.sh
```

**Step 4: Install concurrently**

Run:
```bash
pnpm add -D -w concurrently
```

**Step 5: Test development script**

Run:
```bash
pnpm dev
```

Expected: All three services start (frontend, backend, electron).

**Step 6: Commit**

Run:
```bash
git add package.json scripts/dev.sh pnpm-lock.yaml
git commit -m "feat: add development scripts for unified startup"
```

---

## Summary

After completing all tasks, you will have:

1. **Monorepo structure** with pnpm workspaces
2. **React frontend** with Vite, Tailwind, and shadcn/ui theming
3. **Electron shell** that manages window lifecycle
4. **FastAPI backend** with health checks and CORS
5. **SQLite database** with all core models (projects, recordings, transcripts, segments, jobs)
6. **Backend process management** - Electron spawns/monitors Python backend
7. **Frontend-backend connection** - API client with health status display
8. **Development scripts** - Single command to start everything

The foundation is ready for Phase 2: Core Transcription.
