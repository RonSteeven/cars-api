import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import type { Express } from 'express';
import { buildConfig } from '../../src/config/index.js';
import { ingestVehicleCatalog } from '../../src/application/ingestion/ingest-vehicle-catalog.js';
import { HttpClient } from '../../src/infrastructure/http/http-client.js';
import { NhtsaClient } from '../../src/infrastructure/nhtsa/nhtsa.client.js';
import { MongoMakeRepository } from '../../src/infrastructure/persistence/mongo/make.repository.js';
import {
  createGraphQLHandler,
  type GraphQLHandler,
} from '../../src/presentation/graphql/server.js';
import { resolvers } from '../../src/presentation/graphql/resolvers.js';
import { typeDefs } from '../../src/presentation/graphql/schema.js';
import { createApp } from '../../src/presentation/http/app.js';
import type { IngestionReport } from '../../src/types/ingestion.js';
import { createTestDatabase, isMongoAvailable, type TestDatabase } from '../helpers/mongo.js';
import { startVpicStub, type StubMake, type VpicStub } from '../helpers/vpic-stub.js';

/**
 * End-to-end: XML over HTTP → parse → transform → MongoDB → GraphQL.
 *
 * Every layer is the real one. The only substitution is the upstream API, which
 * is a local HTTP server serving genuine vPIC-shaped XML — so the HTTP client's
 * retries, the XML parser, the transformation rules, MongoDB's indexes and
 * collation, and Apollo's resolvers are all exercised together.
 */

const logger = pino({ level: 'silent' });
const available = await isMongoAvailable();

const ASTON: StubMake = {
  makeId: '440',
  makeName: 'ASTON MARTIN',
  types: [
    { typeId: '2', typeName: 'Passenger Car' },
    { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
  ],
};
// Single type: XML collapses a one-element list to a bare object.
const ALPINE: StubMake = {
  makeId: '12858',
  makeName: '#1 ALPINE CUSTOMS',
  types: [{ typeId: '6', typeName: 'Trailer' }],
};
// No types at all: vPIC answers 200 with <Results />.
const NO_TYPES: StubMake = { makeId: '999', makeName: 'NO TYPES LTD', types: [] };
// Regex metacharacters in a real vPIC name.
const KUSTOMS: StubMake = {
  makeId: '4877',
  makeName: '1/OFF KUSTOMS, LLC',
  types: [{ typeId: '1', typeName: 'Motorcycle' }],
};

const CATALOG = [ASTON, ALPINE, NO_TYPES, KUSTOMS];

describe.skipIf(!available)('end to end: ingestion → persistence → GraphQL', () => {
  let database: TestDatabase;
  let stub: VpicStub;
  let repository: MongoMakeRepository;
  let handler: GraphQLHandler;
  let app: Express;

  /** Runs a real ingestion pass against the stub. */
  const ingest = (options: { makeLimit?: number } = {}): Promise<IngestionReport> => {
    const http = new HttpClient({
      baseUrl: stub.baseUrl,
      timeoutMs: 5_000,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      logger,
    });
    return ingestVehicleCatalog({
      source: new NhtsaClient({ http, logger }),
      repository,
      logger,
      concurrency: 4,
      makeLimit: options.makeLimit ?? 0,
    });
  };

  const query = (gql: string, variables?: Record<string, unknown>) =>
    request(app)
      .post('/graphql')
      .send(variables ? { query: gql, variables } : { query: gql });

  beforeAll(async () => {
    database = await createTestDatabase('e2e');
    stub = await startVpicStub(CATALOG);
    repository = new MongoMakeRepository(database.db, logger);
    await repository.ensureIndexes();

    const config = buildConfig({ NODE_ENV: 'test' });
    handler = await createGraphQLHandler(
      { repository, logger, introspection: true, exposeInternals: true },
      typeDefs,
      resolvers,
    );
    app = createApp({
      config,
      logger,
      version: '0.0.0-e2e',
      graphql: handler.middleware,
    });
  });

  afterAll(async () => {
    await handler.stop();
    await stub.close();
    await database.close();
  });

  beforeEach(async () => {
    await database.db.collection('makes').deleteMany({});
    stub.setMakes(CATALOG);
  });

  afterEach(() => {
    stub.resetFailures();
  });

  describe('the happy path', () => {
    it('serves XML-sourced data as the unified JSON structure', async () => {
      await ingest();

      const response = await query(
        '{ makes { totalCount items { makeId makeName vehicleTypes { typeId typeName } } } }',
      ).expect(200);

      expect(response.body.data.makes.totalCount).toBe(4);
      expect(
        response.body.data.makes.items.find((m: { makeId: string }) => m.makeId === '440'),
      ).toEqual({
        makeId: '440',
        makeName: 'ASTON MARTIN',
        vehicleTypes: [
          { typeId: '2', typeName: 'Passenger Car' },
          { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
        ],
      });
    });

    it('issues exactly one request per make plus the make list', async () => {
      const before = stub.requestCount();
      await ingest();

      expect(stub.requestCount() - before).toBe(1 + CATALOG.length);
    });

    it('carries a single-type make through as a one-element array', async () => {
      // XML gives an object here, not a list; the whole chain must still yield [].
      await ingest();

      const response = await query(
        '{ make(makeId: "12858") { vehicleTypes { typeName } } }',
      ).expect(200);

      expect(response.body.data.make.vehicleTypes).toEqual([{ typeName: 'Trailer' }]);
    });

    it('carries a no-types make through as an empty array, not null', async () => {
      await ingest();

      const response = await query(
        '{ make(makeId: "999") { makeName vehicleTypes { typeId } } }',
      ).expect(200);

      expect(response.body.data.make).toEqual({ makeName: 'NO TYPES LTD', vehicleTypes: [] });
    });

    it('reports a clean pass', async () => {
      const report = await ingest();

      expect(report).toMatchObject({
        makesFetched: 4,
        failedMakes: 0,
        aborted: false,
        pruneSkipped: false,
        upserted: { inserted: 4 },
      });
    });
  });

  describe('re-ingesting', () => {
    it('is idempotent: a second pass inserts nothing and changes nothing', async () => {
      await ingest();
      const second = await ingest();

      expect(second.upserted).toMatchObject({ inserted: 0, matched: 4 });
      await expect(repository.count()).resolves.toBe(4);
    });

    it('picks up an upstream rename', async () => {
      await ingest();
      stub.setMakes([{ ...ASTON, makeName: 'ASTON MARTIN LAGONDA' }, ALPINE, NO_TYPES, KUSTOMS]);
      await ingest();

      const response = await query('{ make(makeId: "440") { makeName } }').expect(200);

      expect(response.body.data.make.makeName).toBe('ASTON MARTIN LAGONDA');
    });

    it('picks up a new vehicle type on an existing make', async () => {
      await ingest();
      stub.setMakes([
        { ...ASTON, types: [...ASTON.types, { typeId: '3', typeName: 'Truck' }] },
        ALPINE,
        NO_TYPES,
        KUSTOMS,
      ]);
      await ingest();

      const response = await query('{ make(makeId: "440") { vehicleTypes { typeId } } }').expect(
        200,
      );

      expect(response.body.data.make.vehicleTypes.map((t: { typeId: string }) => t.typeId)).toEqual(
        ['2', '3', '7'],
      );
    });

    it('stops serving a make that disappeared upstream', async () => {
      await ingest();
      stub.setMakes([ASTON, ALPINE]);
      const report = await ingest();

      expect(report.pruned).toBe(2);
      const response = await query('{ makes { totalCount items { makeId } } }').expect(200);
      expect(response.body.data.makes.totalCount).toBe(2);
      expect(response.body.data.makes.items.map((m: { makeId: string }) => m.makeId)).not.toContain(
        '999',
      );
    });
  });

  describe('surviving a flaky upstream', () => {
    it('retries a transient 503 and still ingests the make', async () => {
      stub.failTemporarily('440', 2);

      const report = await ingest();

      expect(report.failedMakes).toBe(0);
      const response = await query('{ make(makeId: "440") { vehicleTypes { typeId } } }').expect(
        200,
      );
      expect(response.body.data.make.vehicleTypes).toHaveLength(2);
    });

    it('excludes a make whose types never arrive, keeping the rest', async () => {
      stub.failPermanently('440');

      const report = await ingest();

      expect(report.failedMakes).toBe(1);
      const response = await query('{ makes { totalCount } }').expect(200);
      expect(response.body.data.makes.totalCount).toBe(3);
    });

    it('preserves previously stored types when a later pass cannot fetch them', async () => {
      // The rule that matters most: a transient upstream failure must never
      // replace good data with an empty list.
      await ingest();
      stub.failPermanently('440');
      await ingest();

      const response = await query('{ make(makeId: "440") { vehicleTypes { typeId } } }').expect(
        200,
      );
      expect(response.body.data.make.vehicleTypes).toHaveLength(2);
    });

    it('does not prune on an incomplete pass, even when makes vanished upstream', async () => {
      // 999 and 4877 are genuinely gone, but one make failed, so deletion is
      // unsafe: a failed make is indistinguishable from a removed one.
      await ingest();
      stub.setMakes([ASTON, ALPINE]);
      stub.failPermanently('440');

      const report = await ingest();

      expect(report.pruneSkipped).toBe(true);
      expect(report.pruned).toBe(0);
      await expect(repository.count()).resolves.toBe(4);
    });

    it('excludes a make whose XML is malformed', async () => {
      stub.serveMalformed('12858');

      const report = await ingest();

      expect(report.failedMakes).toBe(1);
      await expect(repository.findByMakeId('12858')).resolves.toBeNull();
    });
  });

  describe('querying the ingested catalogue', () => {
    beforeEach(async () => {
      await ingest();
    });

    it('orders makes by name, case-insensitively, via the collation index', async () => {
      const response = await query('{ makes { items { makeName } } }').expect(200);

      expect(response.body.data.makes.items.map((m: { makeName: string }) => m.makeName)).toEqual([
        '#1 ALPINE CUSTOMS',
        '1/OFF KUSTOMS, LLC',
        'ASTON MARTIN',
        'NO TYPES LTD',
      ]);
    });

    it('searches names case-insensitively', async () => {
      const response = await query(
        '{ makes(filter: { search: "aston" }) { items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([{ makeId: '440' }]);
    });

    it('matches a name containing regex metacharacters literally', async () => {
      const response = await query(
        'query Q($f: MakeFilter) { makes(filter: $f) { items { makeId } } }',
        {
          f: { search: '1/OFF KUSTOMS, LLC' },
        },
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([{ makeId: '4877' }]);
    });

    it('does not treat a wildcard search as a pattern', async () => {
      const response = await query(
        '{ makes(filter: { search: ".*" }) { items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([]);
    });

    it('filters by vehicle type through the multikey index', async () => {
      const response = await query(
        '{ makes(filter: { vehicleTypeId: "2" }) { totalCount items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes).toEqual({ totalCount: 1, items: [{ makeId: '440' }] });
    });

    it('paginates without dropping or repeating a make', async () => {
      const ids: string[] = [];
      for (let offset = 0; offset < 4; offset += 2) {
        const page = await query(
          `{ makes(limit: 2, offset: ${offset}) { items { makeId } hasMore } }`,
        ).expect(200);
        ids.push(...page.body.data.makes.items.map((m: { makeId: string }) => m.makeId));
      }

      expect(ids).toEqual(['12858', '4877', '440', '999']);
      expect(new Set(ids).size).toBe(4);
    });

    it('exposes the distinct vehicle types present in the catalogue', async () => {
      const response = await query('{ vehicleTypes { typeId typeName } }').expect(200);

      expect(response.body.data.vehicleTypes).toEqual([
        { typeId: '1', typeName: 'Motorcycle' },
        { typeId: '2', typeName: 'Passenger Car' },
        { typeId: '6', typeName: 'Trailer' },
        { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
      ]);
    });

    it('returns null for a make that was never ingested', async () => {
      const response = await query('{ make(makeId: "111111") { makeId } }').expect(200);

      expect(response.body.data.make).toBeNull();
      expect(response.body.errors).toBeUndefined();
    });
  });

  describe('a capped run', () => {
    it('ingests only the cap and never prunes', async () => {
      const report = await ingest({ makeLimit: 2 });

      expect(report.makesFetched).toBe(2);
      expect(report.pruneSkipped).toBe(true);
      const response = await query('{ makes { totalCount } }').expect(200);
      expect(response.body.data.makes.totalCount).toBe(2);
    });

    it('leaves makes from an earlier full pass in place', async () => {
      await ingest();
      await ingest({ makeLimit: 1 });

      await expect(repository.count()).resolves.toBe(4);
    });
  });

  describe('an empty upstream catalogue', () => {
    it('serves an empty result set rather than erroring', async () => {
      stub.setMakes([]);
      await ingest();

      const response = await query('{ makes { totalCount items { makeId } } }').expect(200);

      expect(response.body.data.makes).toEqual({ totalCount: 0, items: [] });
    });
  });
});
