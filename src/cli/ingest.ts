import { loadConfig, ConfigurationError } from '@/config/index.js';
import { createLogger } from '@/shared/logger.js';
import { APP_VERSION } from '@/shared/version.js';
import { ingestVehicleCatalog } from '@/application/ingestion/ingest-vehicle-catalog.js';
import { HttpClient } from '@/infrastructure/http/http-client.js';
import { NhtsaClient } from '@/infrastructure/nhtsa/nhtsa.client.js';
import { MongoConnection } from '@/infrastructure/persistence/mongo/mongo-connection.js';
import { MongoMakeRepository } from '@/infrastructure/persistence/mongo/make.repository.js';

/**
 * One-shot ingestion command: `npm run ingest`.
 *
 * Populating the datastore should not require restarting the API with a feature
 * flag, which is the only trigger the server itself offers. This is the same use
 * case with the same configuration — just run to completion and exit, so it also
 * works as a container job or a cron entry.
 *
 * Exits 0 on a clean pass, 1 on failure or if any make had to be skipped, so a
 * scheduler can tell the difference.
 */
const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info(
    {
      version: APP_VERSION,
      database: config.mongo.dbName,
      concurrency: config.nhtsa.concurrency,
      makeLimit: config.features.ingestMakeLimit || 'none',
    },
    'Starting one-shot ingestion',
  );

  const mongo = new MongoConnection(config, logger);
  const db = await mongo.connect();
  const repository = new MongoMakeRepository(db, logger);
  await repository.ensureIndexes();

  const http = new HttpClient({
    baseUrl: config.nhtsa.baseUrl,
    timeoutMs: config.nhtsa.timeoutMs,
    maxRetries: config.nhtsa.maxRetries,
    retryBaseDelayMs: config.nhtsa.retryBaseDelayMs,
    logger,
    userAgent: `cars-api/${APP_VERSION}`,
  });

  // Ctrl-C stops the run cleanly: whatever was already gathered still gets
  // persisted, and the prune step is skipped because the pass is incomplete.
  const controller = new AbortController();
  const onSignal = (): void => {
    logger.warn('Interrupted, finishing the current batch');
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const report = await ingestVehicleCatalog(
      {
        source: new NhtsaClient({ http, logger }),
        repository,
        logger,
        concurrency: config.nhtsa.concurrency,
        makeLimit: config.features.ingestMakeLimit,
      },
      { signal: controller.signal },
    );

    const total = await repository.count();
    logger.info({ storedMakes: total }, 'Ingestion finished');

    if (report.failedMakes > 0 || report.aborted) {
      logger.warn(
        { failedMakes: report.failedMakes, aborted: report.aborted },
        'Run was incomplete',
      );
      process.exitCode = 1;
    }
  } finally {
    await mongo.close();
  }
};

main().catch((error: unknown) => {
  const message =
    error instanceof ConfigurationError
      ? error.message
      : error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);

  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'Ingestion failed' })}\n${message}\n`,
  );
  process.exit(1);
});
