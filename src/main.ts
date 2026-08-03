import { loadConfig, ConfigurationError } from './config/index.js';
import { createLogger, type Logger } from './shared/logger.js';
import { APP_VERSION } from './shared/version.js';
import { createApp } from './presentation/http/app.js';
import { startHttpServer } from './server.js';
import type { HttpServerHandle } from './types/http.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

const bootstrap = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info(
    {
      version: APP_VERSION,
      nodeEnv: config.env,
      port: config.http.port,
      logLevel: config.logging.level,
      features: config.features,
    },
    'Starting cars-api',
  );

  const app = createApp({ config, logger, version: APP_VERSION });
  const http = await startHttpServer(app, config, logger);

  logger.info({ address: http.address }, 'HTTP server listening');

  registerLifecycleHandlers(http, logger);
};

const registerLifecycleHandlers = (http: HttpServerHandle, logger: Logger): void => {
  let shuttingDown = false;

  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) {
      logger.warn({ reason }, 'Shutdown already in progress, forcing exit');
      process.exit(exitCode);
    }
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');

    http
      .close()
      .then(() => {
        logger.info({ reason }, 'Shutdown complete');
        logger.flush?.();
        process.exit(exitCode);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      });
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => shutdown(signal, 0));
  }

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection', 1);
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException', 1);
  });
};

bootstrap().catch((error: unknown) => {
  const message =
    error instanceof ConfigurationError
      ? error.message
      : error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);

  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'Startup failed' })}\n${message}\n`,
  );
  process.exit(1);
});
