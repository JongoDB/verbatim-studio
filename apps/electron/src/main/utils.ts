import net from 'net';

/**
 * Verify that the required port is available.
 * Throws if the port is already in use instead of silently falling back.
 */
export async function ensurePortAvailable(port: number = 52780): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(port));
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Please close the other application using this port and restart Verbatim Studio.`));
      } else {
        reject(err);
      }
    });
  });
}
