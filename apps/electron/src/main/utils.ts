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
