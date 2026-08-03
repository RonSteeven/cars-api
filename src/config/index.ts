import { config as loadDotenv } from 'dotenv';
import { envSchema, type Env } from './env.schema.js';

export type { Env } from './env.schema.js';

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

/**
 * Thrown when the process environment does not satisfy {@link envSchema}.
 * Carries a human readable, line-per-variable breakdown so a misconfigured
 * deployment fails loudly at startup instead of misbehaving at request time.
 */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';

  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
}

const parseCorsOrigins = (raw: string): string[] | '*' => {
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed === '') return '*';
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

const toAppConfig = (env: Env): AppConfig => ({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  http: {
    port: env.PORT,
    host: env.HOST,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
  },
  logging: {
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  },
  mongo: {
    uri: env.MONGODB_URI,
    dbName: env.MONGODB_DB_NAME,
    connectTimeoutMs: env.MONGODB_CONNECT_TIMEOUT_MS,
  },
  nhtsa: {
    baseUrl: env.NHTSA_BASE_URL.replace(/\/+$/, ''),
    timeoutMs: env.NHTSA_TIMEOUT_MS,
    maxRetries: env.NHTSA_MAX_RETRIES,
    retryBaseDelayMs: env.NHTSA_RETRY_BASE_DELAY_MS,
    concurrency: env.NHTSA_CONCURRENCY,
  },
  graphql: {
    path: env.GRAPHQL_PATH,
    introspection: env.GRAPHQL_INTROSPECTION ?? env.NODE_ENV !== 'production',
  },
  features: {
    ingestOnStartup: env.INGEST_ON_STARTUP,
    ingestMakeLimit: env.INGEST_MAKE_LIMIT,
  },
});

/**
 * Validates a raw environment bag and maps it onto the structured {@link AppConfig}.
 * Exported separately from {@link loadConfig} so tests can exercise validation
 * without touching `process.env`.
 *
 * @throws {ConfigurationError} when validation fails.
 */
export const buildConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  return toAppConfig(result.data);
};

let cached: AppConfig | undefined;

/**
 * Loads `.env` (never overriding real environment variables) and returns the
 * validated, memoised application configuration.
 */
export const loadConfig = (): AppConfig => {
  if (!cached) {
    loadDotenv({ quiet: true });
    cached = buildConfig();
  }
  return cached;
};

/** Test seam: drops the memoised config so the next {@link loadConfig} re-reads the env. */
export const resetConfigCache = (): void => {
  cached = undefined;
};
