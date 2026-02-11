import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
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
    console.log(`[Backend] app.isPackaged: ${app.isPackaged}`);
    console.log(`[Backend] process.resourcesPath: ${process.resourcesPath}`);

    // Check if Python exists
    console.log(`[Backend] Python exists: ${fs.existsSync(pythonPath)}`);
    console.log(`[Backend] Backend dir exists: ${fs.existsSync(backendPath)}`);

    // Build PATH based on platform
    let extendedPath: string;
    if (process.platform === 'win32') {
      // Windows: prepend bundled CUDA DLLs directory so PyTorch/llama.cpp find them
      const cudaPath = path.join(process.resourcesPath, 'cuda');
      extendedPath = [cudaPath, process.env.PATH || ''].join(';');
    } else {
      // macOS/Linux: add common binary paths (Homebrew, MacPorts, etc.)
      // Electron apps don't inherit the user's shell PATH
      const additionalPaths = [
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt/local/bin',
        '/opt/local/sbin',
      ];
      const currentPath = process.env.PATH || '/usr/bin:/bin';
      extendedPath = [...additionalPaths, currentPath].join(':');
    }

    // Use user data directory for database to persist across updates
    // The app bundle gets replaced on update, so storing db there causes data loss
    const userDataDir = app.getPath('userData');
    const databasePath = path.join(userDataDir, 'verbatim.db');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: extendedPath,
      VERBATIM_ELECTRON: '1',
      VERBATIM_PORT: String(this._port),
      VERBATIM_DATA_DIR: userDataDir,
      VERBATIM_DATABASE_URL: `sqlite+aiosqlite:///${databasePath}`,
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
      console.log('[Backend] Started successfully');
    } catch (error) {
      console.error('[Backend] Health check failed:', error);
      this.killProcess(true);
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
          this.killProcess(true);
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

      console.log('[Backend] Stopping process');
      this.killProcess(false);
    });
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  /** Platform-aware process termination. */
  private killProcess(force: boolean): void {
    if (!this.process?.pid) return;

    if (process.platform === 'win32') {
      // Windows: use taskkill to kill the process tree
      try {
        const args = ['/T', '/PID', String(this.process.pid)];
        if (force) args.unshift('/F');
        spawn('taskkill', args, { stdio: 'ignore' });
      } catch (err) {
        console.error('[Backend] taskkill failed:', err);
        this.process.kill();
      }
    } else {
      this.process.kill(force ? 'SIGKILL' : 'SIGTERM');
    }
  }

  /** Synchronously force-kill the backend process (for use in process.on('exit')) */
  forceKill(): void {
    this.killProcess(true);
  }

  private getPythonPath(): string {
    if (app.isPackaged) {
      // Bundled Python in resources
      const resourcesPath = process.resourcesPath;
      if (process.platform === 'win32') {
        return path.join(resourcesPath, 'python', 'python.exe');
      } else {
        return path.join(resourcesPath, 'python', 'bin', 'python3');
      }
    } else {
      // Development: Use venv Python
      const backendPath = path.join(__dirname, '../../../../packages/backend');
      if (process.platform === 'win32') {
        return path.join(backendPath, '.venv', 'Scripts', 'python.exe');
      } else {
        return path.join(backendPath, '.venv', 'bin', 'python');
      }
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

    let lastError = '';
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          console.log('[Backend] Health check passed');
          return;
        }
        lastError = `HTTP ${response.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(`Backend failed to start within ${timeout/1000}s. Last error: ${lastError}`);
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
