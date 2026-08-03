import { loadConfig, ConfigurationError } from './config/index.js';
import { createLogger, type Logger } from './shared/logger.js';
import { APP_VERSION } from './shared/version.js';
import { ingestVehicleCatalog } from './application/ingestion/ingest-vehicle-catalog.js';
import { HttpClient } from './infrastructure/http/http-client.js';
import { NhtsaClient } from './infrastructure/nhtsa/nhtsa.client.js';
import { MongoConnection } from './infrastructure/persistence/mongo/mongo-connection.js';
import { MongoMakeRepository } from './infrastructure/persistence/mongo/make.repository.js';
import { createApp } from './presentation/http/app.js';
import { startHttpServer } from './server.js';
import type { AppConfig } from './types/config.js';
import type { HttpServerHandle } from './types/http.js';
import type { MakeRepository } from './types/persistence.js';
import { settleWithin } from './utils/promise.js';

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

  // A full pass is ~12,300 upstream requests and takes minutes, so it runs in
  // the background rather than holding the listener closed. The controller lets
  // shutdown stop it mid-flight instead of waiting it out.
  const ingestion = new AbortController();
  const ingestionDone = config.features.ingestOnStartup
    ? startBackgroundIngestion(config, makeRepository, logger, ingestion.signal)
    : Promise.resolve();

  registerLifecycleHandlers({
    http,
    mongo,
    logger,
    ingestion,
    ingestionDone,
    shutdownTimeoutMs: config.http.shutdownTimeoutMs,
  });
};

/**
 * Fires an ingestion pass without awaiting it.
 *
 * Returns a promise that never rejects, so shutdown can wait for the run to
 * finish draining without having to handle its failure again. The `.catch` is
 * not optional: an unhandled rejection here would trip the process-level
 * `unhandledRejection` handler and take the service down over a failed
 * background refresh, when the right response is to log it and keep serving
 * whatever is already stored.
 */
const startBackgroundIngestion = (
  config: AppConfig,
  repository: MakeRepository,
  logger: Logger,
  signal: AbortSignal,
): Promise<void> => {
  const http = new HttpClient({
    baseUrl: config.nhtsa.baseUrl,
    timeoutMs: config.nhtsa.timeoutMs,
    maxRetries: config.nhtsa.maxRetries,
    retryBaseDelayMs: config.nhtsa.retryBaseDelayMs,
    logger,
    userAgent: `cars-api/${APP_VERSION}`,
  });

  const dependencies = {
    source: new NhtsaClient({ http, logger }),
    repository,
    logger,
    concurrency: config.nhtsa.concurrency,
    makeLimit: config.features.ingestMakeLimit,
  };

  return ingestVehicleCatalog(dependencies, { signal }).then(
    () => undefined,
    (error: unknown) => {
      logger.error({ err: error }, 'Startup ingestion failed; serving previously stored data');
    },
  );
};

interface LifecycleDependencies {
  readonly http: HttpServerHandle;
  readonly mongo: MongoConnection;
  readonly logger: Logger;
  readonly ingestion: AbortController;
  /** Resolves when the background run has finished draining. Never rejects. */
  readonly ingestionDone: Promise<void>;
  readonly shutdownTimeoutMs: number;
}

const registerLifecycleHandlers = ({
  http,
  mongo,
  logger,
  ingestion,
  ingestionDone,
  shutdownTimeoutMs,
}: LifecycleDependencies): void => {
  let shuttingDown = false;

  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) {
      logger.warn({ reason }, 'Shutdown already in progress, forcing exit');
      process.exit(exitCode);
    }
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');

    // Ask the ingestion run to stop. It still needs a moment to persist what it
    // already gathered, which is why MongoDB is closed last.
    ingestion.abort();

    http
      .close()
      .then(async () => {
        // Closing the connection underneath an in-flight bulk write would both
        // lose the batch and log a spurious failure, so drain first — bounded,
        // so a stuck run cannot hold shutdown open indefinitely.
        const drained = await settleWithin(ingestionDone, shutdownTimeoutMs);
        if (!drained) {
          logger.warn({ timeoutMs: shutdownTimeoutMs }, 'Ingestion did not drain in time');
        }
      })
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
