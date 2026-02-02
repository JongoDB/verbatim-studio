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
