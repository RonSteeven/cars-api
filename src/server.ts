import { createServer, type Server } from 'node:http';
import type { Express } from 'express';
import type { AppConfig } from './config/index.js';
import type { Logger } from './shared/logger.js';

export interface HttpServerHandle {
  readonly server: Server;
  readonly address: string;
  close(): Promise<void>;
}

export const startHttpServer = async (
  app: Express,
  config: AppConfig,
  logger: Logger,
): Promise<HttpServerHandle> => {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.http.port, config.http.host);
  });

  const addressInfo = server.address();
  const address =
    typeof addressInfo === 'object' && addressInfo !== null
      ? `http://${config.http.host}:${addressInfo.port}`
      : String(addressInfo);

  return {
    server,
    address,
    close: async () => {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(forceTimer);
          resolve();
        };

        const forceTimer = setTimeout(() => {
          logger.warn(
            { timeoutMs: config.http.shutdownTimeoutMs },
            'Shutdown grace period expired, destroying remaining connections',
          );
          server.closeAllConnections();
          finish();
        }, config.http.shutdownTimeoutMs);
        forceTimer.unref();

        server.close(() => finish());
        server.closeIdleConnections();
      });
    },
  };
};
