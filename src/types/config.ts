import type { Env } from '@/config/env.schema.js';

export type { Env } from '@/config/env.schema.js';

/**
 * The structured, read-only view of configuration every module depends on.
 *
 * Deliberately not the raw `Env`: consumers take the slice they need
 * (`config.nhtsa`, `config.http`) and never learn which environment variable it
 * came from.
 */
export interface AppConfig {
  readonly env: Env['NODE_ENV'];
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly http: {
    readonly port: number;
    readonly host: string;
    readonly shutdownTimeoutMs: number;
    readonly corsOrigins: string[] | '*';
  };
  readonly logging: {
    readonly level: Env['LOG_LEVEL'];
    readonly pretty: boolean;
  };
  readonly mongo: {
    readonly uri: string;
    readonly dbName: string;
    readonly connectTimeoutMs: number;
  };
  readonly nhtsa: {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly retryBaseDelayMs: number;
    readonly concurrency: number;
  };
  readonly graphql: {
    readonly path: string;
    readonly introspection: boolean;
  };
  readonly features: {
    readonly ingestOnStartup: boolean;
    readonly ingestMakeLimit: number;
  };
}
