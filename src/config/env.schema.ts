import { z } from 'zod';

/**
 * Canonical description of every environment variable the service understands.
 *
 * Rules of the road:
 *  - Every variable gets a documented default unless it is genuinely deployment
 *    specific (there are none today: the defaults point at the local compose stack).
 *  - Values arrive as strings, so coercion happens here and nowhere else.
 *  - The parsed output of this schema is the ONLY way the rest of the codebase is
 *    allowed to read configuration. `process.env` is off limits outside this module.
 */

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
  /** Interface the HTTP server binds to. 0.0.0.0 is required inside containers. */
  HOST: z.string().min(1).default('0.0.0.0'),
  /** Grace period for in-flight requests during shutdown before the socket is destroyed. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Comma separated list of allowed CORS origins, or `*` for any. */
  CORS_ORIGINS: z.string().default('*'),

  // ---------------------------------------------------------------- logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Human readable log output. Handy in a terminal, never in production. */
  LOG_PRETTY: booleanFromString.default(false),

  // ---------------------------------------------------------------- datastore
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017'),
  MONGODB_DB_NAME: z.string().min(1).default('cars'),
  MONGODB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // ---------------------------------------------------------------- external apis
  /** Base URL of the NHTSA vPIC API. Overridable so tests can point at a local stub. */
  NHTSA_BASE_URL: z.url().default('https://vpic.nhtsa.dot.gov/api/vehicles'),
  /** Per-request timeout for outbound calls to vPIC. */
  NHTSA_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** How many times a failed vPIC request is retried (exponential backoff). */
  NHTSA_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  /** Base delay for the retry backoff, in milliseconds. */
  NHTSA_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(300),
  /** Maximum number of vPIC requests in flight at once during ingestion. */
  NHTSA_CONCURRENCY: z.coerce.number().int().positive().max(64).default(8),

  // ---------------------------------------------------------------- graphql
  GRAPHQL_PATH: z.string().startsWith('/').default('/graphql'),
  /** Schema introspection. Enabled by default outside production. */
  GRAPHQL_INTROSPECTION: booleanFromString.optional(),

  // ---------------------------------------------------------------- feature flags
  /** Run a full ingestion pass as part of startup. */
  INGEST_ON_STARTUP: booleanFromString.default(false),
  /** Cap the number of makes ingested. 0 means "no cap". Useful for local runs. */
  INGEST_MAKE_LIMIT: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof envSchema>;
