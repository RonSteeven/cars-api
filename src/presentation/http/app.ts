import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { AppConfig } from '../../config/index.js';
import type { Logger } from '../../shared/logger.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter, type HealthCheck } from './routes/health.route.js';

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly version: string;
  readonly healthChecks?: readonly HealthCheck[];
}

export const createApp = (options: CreateAppOptions): Express => {
  const { config, logger, version } = options;
  const app = express();

  // Trust the reverse proxy for client IPs and protocol when deployed behind one.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: config.isProduction }));
  app.use(
    cors({
      origin: config.http.corsOrigins === '*' ? true : [...config.http.corsOrigins],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(createRequestLogger(logger));

  app.use(
    '/health',
    createHealthRouter({
      version,
      startedAt: Date.now(),
      ...(options.healthChecks ? { checks: options.healthChecks } : {}),
    }),
  );

  app.get('/', (_req, res) => {
    res.json({
      service: 'cars-api',
      version,
      endpoints: { graphql: config.graphql.path, health: '/health/live' },
    });
  });

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, exposeMessages: !config.isProduction }));

  return app;
};
