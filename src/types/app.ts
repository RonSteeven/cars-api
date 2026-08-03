import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import type { HealthCheck } from './health.js';

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly version: string;
  readonly healthChecks?: readonly HealthCheck[];
  /**
   * The GraphQL endpoint, mounted at `config.graphql.path` when supplied.
   *
   * Passed in rather than built here because Apollo's `start()` is async, and
   * keeping `createApp` synchronous means health and error-handling tests need
   * no GraphQL server at all.
   */
  readonly graphql?: RequestHandler;
}
