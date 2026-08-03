# Cars-api

A backend service that ingests vehicle data from the public [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/)
XML API, transforms it into JSON, persists it in MongoDB and serves it through a
single GraphQL endpoint.

> **Status:** foundation. Configuration, logging, HTTP bootstrap, tooling and
> containerisation are in place. Ingestion, persistence and the GraphQL layer land
> in the follow-up branches listed under [Roadmap](#roadmap).

---

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Running with Docker](#running-with-docker)
- [npm scripts](#npm-scripts)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Error handling strategy](#error-handling-strategy)
- [Logging strategy](#logging-strategy)
- [Testing](#testing)
- [Git workflow](#git-workflow)
- [Roadmap](#roadmap)

---

## Requirements

| Tool    | Version                                     |
| ------- | ------------------------------------------- |
| Node.js | >= 20.11 (24.x recommended, see `.nvmrc`)   |
| npm     | >= 10                                       |
| Docker  | >= 24 (optional, for the containerised run) |
| MongoDB | 8.x (provided by `docker compose`)          |

## Quick start

```bash
# 1. install dependencies (also installs the Husky git hooks)
npm install

# 2. create your local environment file
cp .env.example .env

# 3. start MongoDB only
docker compose up -d mongo

# 4. run the API in watch mode
npm run dev
```

The service is then available on <http://localhost:4000>:

```bash
curl http://localhost:4000/health/live
# {"status":"ok","version":"0.1.0","uptimeSeconds":3}
```

## Running with Docker

The compose stack builds the production image and wires it to MongoDB. The API
waits for the database health check before it starts, so a cold `up` is safe.

```bash
docker compose up --build          # API on :4000, MongoDB on :27017
docker compose logs -f api
docker compose down                # add -v to drop the database volume
```

Build and run the image on its own:

```bash
docker build -t cars-api .
docker run --rm -p 4000:4000 --env-file .env cars-api
```

The image is multi-stage: dependencies and TypeScript compilation happen in
builder stages, and the runtime stage ships only production dependencies plus
`dist/`. It runs as the unprivileged `node` user under `tini`, so `SIGTERM`
reaches Node and the graceful shutdown path actually runs.

## npm scripts

| Script                  | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `npm run dev`           | Watch-mode server via `tsx`                         |
| `npm run build`         | Type-check and emit `dist/` (`tsconfig.build.json`) |
| `npm start`             | Run the compiled server from `dist/`                |
| `npm run typecheck`     | `tsc --noEmit` across sources and tests             |
| `npm run lint`          | ESLint (type-aware rules)                           |
| `npm run lint:fix`      | ESLint with `--fix`                                 |
| `npm run format`        | Prettier write                                      |
| `npm run format:check`  | Prettier check (used in CI)                         |
| `npm test`              | Vitest, single run                                  |
| `npm run test:watch`    | Vitest in watch mode                                |
| `npm run test:coverage` | Vitest with a V8 coverage report in `coverage/`     |

## Configuration

Configuration is environment based. Every variable is declared, coerced and
validated with **Zod** in [`src/config/env.schema.ts`](src/config/env.schema.ts),
then mapped onto a structured, read-only `AppConfig` object in
[`src/config/index.ts`](src/config/index.ts).

Three rules keep this honest:

1. **Validation happens once, at startup.** An invalid environment throws a
   `ConfigurationError` listing every offending variable and the process exits
   non-zero. The service never boots half-configured.
2. **`process.env` is read in exactly one module.** Everywhere else takes
   `AppConfig` as an injected dependency, which is also what makes the units
   testable without touching the real environment.
3. **Every variable has a working default.** A bare `npm run dev` against the
   compose stack needs no `.env` at all; `.env` only overrides.

`.env` is loaded with `dotenv` and never overrides variables already present in
the real environment, so container and CI settings always win.

### Environment variables

| Variable                     | Default                                   | Description                                                    |
| ---------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `NODE_ENV`                   | `development`                             | `development` \| `test` \| `production`                        |
| `PORT`                       | `4000`                                    | TCP port the HTTP server binds to                              |
| `HOST`                       | `0.0.0.0`                                 | Bind interface (`0.0.0.0` is required inside containers)       |
| `SHUTDOWN_TIMEOUT_MS`        | `10000`                                   | Grace period for in-flight requests during shutdown            |
| `CORS_ORIGINS`               | `*`                                       | Comma separated allow-list, or `*` for any origin              |
| `LOG_LEVEL`                  | `info`                                    | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`         |
| `LOG_PRETTY`                 | `false`                                   | Human readable log output (local development only)             |
| `MONGODB_URI`                | `mongodb://localhost:27017`               | MongoDB connection string                                      |
| `MONGODB_DB_NAME`            | `cars`                                    | Database name                                                  |
| `MONGODB_CONNECT_TIMEOUT_MS` | `10000`                                   | Connection timeout                                             |
| `NHTSA_BASE_URL`             | `https://vpic.nhtsa.dot.gov/api/vehicles` | Base URL of the vPIC API (override to point at a stub)         |
| `NHTSA_TIMEOUT_MS`           | `15000`                                   | Per-request timeout for outbound vPIC calls                    |
| `NHTSA_MAX_RETRIES`          | `3`                                       | Retry attempts for a failed vPIC request (exponential backoff) |
| `NHTSA_RETRY_BASE_DELAY_MS`  | `300`                                     | Base delay of the retry backoff                                |
| `NHTSA_CONCURRENCY`          | `8`                                       | Max concurrent vPIC requests during ingestion                  |
| `GRAPHQL_PATH`               | `/graphql`                                | Path the GraphQL endpoint is mounted on                        |
| `GRAPHQL_INTROSPECTION`      | on outside production                     | Force schema introspection on or off                           |
| `INGEST_ON_STARTUP`          | `false`                                   | Feature flag: run a full ingestion pass at startup             |
| `INGEST_MAKE_LIMIT`          | `0`                                       | Feature flag: cap makes ingested (`0` = no cap)                |

Booleans accept `true`/`false`, `1`/`0` and `yes`/`no`.

## Project structure

The layout follows a ports-and-adapters split: the domain sits in the middle and
knows nothing about HTTP, MongoDB or XML; infrastructure implements the ports the
domain declares; presentation exposes it all over the wire.

```
src/
├─ config/              # Zod env schema + structured AppConfig (the only reader of process.env)
├─ domain/              # entities, value objects, repository ports        (next branch)
├─ application/         # use cases: ingestion pipeline orchestration      (next branch)
├─ infrastructure/      # vPIC HTTP client, XML parsing, MongoDB adapters  (next branch)
├─ presentation/
│  └─ http/
│     ├─ app.ts         # Express app factory (fully injected, no I/O on import)
│     ├─ middleware/    # request logger, error handler
│     └─ routes/        # health probes
├─ shared/              # logger, error taxonomy, version
├─ server.ts            # socket binding + graceful close
└─ main.ts              # composition root: config → logger → app → lifecycle
tests/                  # integration tests (unit tests live beside their source)
```

Two conventions worth knowing:

- **No side effects on import.** Modules export factories (`createApp`,
  `createLogger`, `startHttpServer`); only `main.ts` actually wires and starts
  anything. That is what lets the integration tests mount the app in-process.
- **Unit tests live next to their subject** (`src/config/config.test.ts`) while
  cross-layer tests live in `tests/`.

## Error handling strategy

Every deliberate failure extends `AppError`
([`src/shared/errors.ts`](src/shared/errors.ts)) and carries a stable `code`, an
HTTP `status`, an `isOperational` flag and a `context` bag.

| Error class                | Code                    | Raised when                                     |
| -------------------------- | ----------------------- | ----------------------------------------------- |
| `ConfigurationError`       | `CONFIGURATION_ERROR`   | The environment fails Zod validation at startup |
| `UpstreamUnavailableError` | `UPSTREAM_UNAVAILABLE`  | vPIC unreachable: DNS, reset, timeout           |
| `UpstreamBadResponseError` | `UPSTREAM_BAD_RESPONSE` | vPIC answered with an unusable status or body   |
| `XmlParseError`            | `XML_PARSE_ERROR`       | The payload is not well-formed XML              |
| `TransformationError`      | `TRANSFORMATION_ERROR`  | Parsed XML does not map onto the domain model   |
| `PersistenceError`         | `PERSISTENCE_ERROR`     | A MongoDB read or write failed                  |
| `NotFoundError`            | `NOT_FOUND`             | The requested resource or route does not exist  |
| `BadRequestError`          | `BAD_REQUEST`           | Caller input is invalid                         |

The distinction that matters is **operational vs. unexpected**:

- _Operational_ errors are anticipated (an upstream is down, a client asked for a
  missing record). They are logged at `warn`, keep their status code, and their
  message is safe to return to the caller.
- _Unexpected_ errors are bugs. They are logged at `error` with the full stack
  and surface as a generic `500 INTERNAL_ERROR` — internal details never leak in
  production, where message exposure is switched off.

A single Express error handler
([`middleware/error-handler.ts`](src/presentation/http/middleware/error-handler.ts))
is the only place an error becomes a response, and it is mounted last. Express 5
forwards rejected promises from async handlers to it automatically, so no route
needs its own try/catch. Error responses have a uniform shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Route not found: GET /nope", "requestId": "…" } }
```

At the process level, `unhandledRejection` and `uncaughtException` are logged at
`fatal` and trigger the same graceful shutdown as a `SIGTERM`, rather than
leaving the process in an unknown state.

## Logging strategy

Structured NDJSON logs via **Pino**, one line per event, no `console.*` anywhere
(the lint rule forbids it).

- **One root logger per process**, built from config in
  [`src/shared/logger.ts`](src/shared/logger.ts). Components derive children
  (`logger.child({ component: 'ingestion' })`) so context is consistent and
  queryable.
- **Every line carries** `service`, `env`, ISO-8601 `time`, a string `level`
  (rather than Pino's numeric default, which most aggregators mis-handle) and a
  message.
- **Request correlation:** `pino-http` attaches a child logger to each request
  with a request id, taken from an inbound `x-request-id` when present and
  generated otherwise. The id is echoed on the response and included in error
  bodies. Health probes are excluded from access logging unless they fail.
- **Level per outcome:** 5xx and thrown errors log at `error`, 4xx at `warn`,
  everything else at `info`.
- **Redaction:** `authorization`, `cookie`, passwords and connection strings are
  stripped before serialisation.
- **Lifecycle events** — startup (with the effective configuration), listening,
  shutdown reason and shutdown completion — are always logged.
- `LOG_PRETTY=true` swaps in `pino-pretty` for local work. Production always
  emits JSON to stdout, on the assumption the platform collects it.

## Testing

[Vitest](https://vitest.dev) for both unit and integration tests, with V8
coverage.

```bash
npm test                 # single run
npm run test:watch       # watch mode
npm run test:coverage    # coverage report in coverage/
```

`tests/setup.ts` pins `NODE_ENV=test` and silences logs before any module loads,
so tests never inherit a developer's `.env` or write to a real database. HTTP
tests drive the app in-process with `supertest` — no port binding required.

## Git workflow

- `main` is protected; every task ships on its own branch and merges via PR.
- Branch naming: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `test/…`.
- **Husky pre-push hook** runs lint, type-check and the test suite. A failing
  hook blocks the push. Run `npm install` once to install it.

## Roadmap

| #   | Branch                       | Scope                                                               |
| --- | ---------------------------- | ------------------------------------------------------------------- |
| 1   | `chore/initial-setup`        | Tooling, config, logging, HTTP bootstrap, Docker ← **you are here** |
| 2   | `feat/nhtsa-client`          | Resilient vPIC HTTP client + XML parsing                            |
| 3   | `feat/domain-transformation` | Domain model and XML → JSON transformation, fully unit tested       |
| 4   | `feat/mongo-persistence`     | MongoDB repository, indexes, bulk upserts                           |
| 5   | `feat/ingestion-pipeline`    | Orchestrated ingestion with bounded concurrency                     |
| 6   | `feat/graphql-api`           | Single GraphQL endpoint, typed and documented                       |
| 7   | `test/integration`           | End-to-end ingestion → persistence → GraphQL coverage               |
| 8   | `ci/github-actions`          | Lint, test, build, Docker image, artifacts                          |
| 9   | `docs/api-documentation`     | Pipeline docs, diagrams, GraphQL schema reference                   |
