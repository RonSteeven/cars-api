import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');

const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((value) =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1' || value === 'yes',
  );

const port = z.coerce.number().int().min(1).max(65_535);

export const envSchema = z.object({
  // ---------------------------------------------------------------- runtime
  NODE_ENV: nodeEnv,

  // ---------------------------------------------------------------- http server
  /** TCP port the HTTP server binds to. */
  PORT: port.default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CORS_ORIGINS: z.string().default('*'),

  // ---------------------------------------------------------------- logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanFromString.default(false),

  // ---------------------------------------------------------------- datastore
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017'),
  MONGODB_DB_NAME: z.string().min(1).default('cars'),
  MONGODB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // ---------------------------------------------------------------- external apis
  NHTSA_BASE_URL: z.url().default('https://vpic.nhtsa.dot.gov/api/vehicles'),
  NHTSA_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  NHTSA_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  NHTSA_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(300),
  NHTSA_CONCURRENCY: z.coerce.number().int().positive().max(64).default(8),

  // ---------------------------------------------------------------- graphql
  GRAPHQL_PATH: z.string().startsWith('/').default('/graphql'),
  /** Schema introspection. Enabled by default outside production. */
  GRAPHQL_INTROSPECTION: booleanFromString.optional(),

  // ---------------------------------------------------------------- feature flags
  INGEST_ON_STARTUP: booleanFromString.default(false),
  INGEST_MAKE_LIMIT: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof envSchema>;
