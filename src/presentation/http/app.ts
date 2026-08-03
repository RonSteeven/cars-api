import express, { type Express } from 'express';
import cors from 'cors';
import helmet, { type HelmetOptions } from 'helmet';
import type { CreateAppOptions } from '../../types/app.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './routes/health.route.js';

/** Where Apollo's landing page loads its own assets from. */
const APOLLO_CDN = 'https://apollo-server-landing-page.cdn.apollographql.com';
const APOLLO_SANDBOX = 'https://sandbox.embed.apollographql.com';

/**
 * Content Security Policy.
 *
 * Enforced in production only; a strict policy locally just breaks tooling. The
 * wrinkle is Apollo's landing page, which loads scripts and images from
 * Apollo's CDN: if introspection is enabled in production (opt-in via
 * `GRAPHQL_INTROSPECTION`) the page is served, and a default policy would block
 * its own assets. So the CDN is allow-listed exactly when that page exists, and
 * not a moment otherwise.
 */
const contentSecurityPolicy = (
  isProduction: boolean,
  landingPageEnabled: boolean,
): NonNullable<HelmetOptions['contentSecurityPolicy']> => {
  if (!isProduction) return false;
  if (!landingPageEnabled) return true;

  const defaults = helmet.contentSecurityPolicy.getDefaultDirectives();
  return {
    directives: {
      ...defaults,
      'img-src': ["'self'", 'data:', APOLLO_CDN],
      'script-src': ["'self'", APOLLO_CDN],
      'manifest-src': ["'self'", APOLLO_CDN],
      'frame-src': ["'self'", APOLLO_SANDBOX],
    },
  };
};

export const createApp = (options: CreateAppOptions): Express => {
  const { config, logger, version } = options;
  const app = express();

  // Trust the reverse proxy for client IPs and protocol when deployed behind one.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: contentSecurityPolicy(
        config.isProduction,
        config.graphql.introspection,
      ),
    }),
  );
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

  if (options.graphql) {
    app.use(config.graphql.path, options.graphql);
  }

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
