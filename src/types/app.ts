import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import type { HealthCheck } from './health.js';

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly version: string;
  readonly healthChecks?: readonly HealthCheck[];
}
