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
