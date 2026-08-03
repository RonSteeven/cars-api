import { loadConfig, ConfigurationError } from './config/index.js';
import { createLogger, type Logger } from './shared/logger.js';
import { APP_VERSION } from './shared/version.js';
import { MongoConnection } from './infrastructure/persistence/mongo/mongo-connection.js';
import { MongoMakeRepository } from './infrastructure/persistence/mongo/make.repository.js';
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

  // The datastore comes up before the HTTP listener: a process that cannot
  // reach MongoDB should fail to start, not accept traffic it cannot serve.
  const mongo = new MongoConnection(config, logger);
  const db = await mongo.connect();
  const makeRepository = new MongoMakeRepository(db, logger);
  await makeRepository.ensureIndexes();

  const app = createApp({
    config,
    logger,
    version: APP_VERSION,
    healthChecks: [mongo.healthCheck()],
  });
  const http = await startHttpServer(app, config, logger);

  logger.info({ address: http.address }, 'HTTP server listening');

  registerLifecycleHandlers({ http, mongo, logger });
};

interface LifecycleDependencies {
  readonly http: HttpServerHandle;
  readonly mongo: MongoConnection;
  readonly logger: Logger;
}

const registerLifecycleHandlers = ({ http, mongo, logger }: LifecycleDependencies): void => {
  let shuttingDown = false;

  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) {
      logger.warn({ reason }, 'Shutdown already in progress, forcing exit');
      process.exit(exitCode);
    }
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');

    // Order matters: stop accepting requests first, then drop the connections
    // those requests were using.
    http
      .close()
      .then(() => mongo.close())
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
