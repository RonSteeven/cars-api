import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import type { Express } from 'express';
import { buildConfig } from '@/config/index.js';
import { createGraphQLHandler, type GraphQLHandler } from '@/presentation/graphql/server.js';
import { resolvers, MAX_PAGE_SIZE } from '@/presentation/graphql/resolvers.js';
import { typeDefs } from '@/presentation/graphql/schema.js';
import { createApp } from '@/presentation/http/app.js';
import type { Make } from '@/types/vehicle.js';
import { FakeMakeRepository } from '../helpers/fake-make-repository.js';

const logger = pino({ level: 'silent' });

const CATALOG: Make[] = [
  {
    makeId: '440',
    makeName: 'ASTON MARTIN',
    vehicleTypes: [
      { typeId: '2', typeName: 'Passenger Car' },
      { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
    ],
  },
  {
    makeId: '441',
    makeName: 'BENTLEY',
    vehicleTypes: [{ typeId: '2', typeName: 'Passenger Car' }],
  },
  {
    makeId: '12858',
    makeName: '#1 ALPINE CUSTOMS',
    vehicleTypes: [{ typeId: '6', typeName: 'Trailer' }],
  },
  { makeId: '999', makeName: 'NO TYPES LTD', vehicleTypes: [] },
  {
    makeId: '4877',
    makeName: '1/OFF KUSTOMS, LLC',
    vehicleTypes: [{ typeId: '1', typeName: 'Motorcycle' }],
  },
];

interface Harness {
  app: Express;
  repository: FakeMakeRepository;
  handler: GraphQLHandler;
}

const createHarness = async (options: { production?: boolean } = {}): Promise<Harness> => {
  const config = buildConfig({ NODE_ENV: options.production ? 'production' : 'test' });
  const repository = new FakeMakeRepository(CATALOG);
  const handler = await createGraphQLHandler(
    {
      repository,
      logger,
      introspection: config.graphql.introspection,
      exposeInternals: !config.isProduction,
    },
    typeDefs,
    resolvers,
  );
  const app = createApp({
    config,
    logger,
    version: '0.0.0-test',
    graphql: handler.middleware,
  });
  return { app, repository, handler };
};

const post = (app: Express, query: string, variables?: Record<string, unknown>) =>
  request(app)
    .post('/graphql')
    .send(variables ? { query, variables } : { query });

describe('GraphQL API', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.handler.stop();
  });

  describe('the endpoint', () => {
    it('is mounted at the configured path', async () => {
      const response = await post(harness.app, '{ makes { items { makeId } } }').expect(200);

      expect(response.body.errors).toBeUndefined();
    });

    it('rejects a GET mutation-style request but serves queries over POST', async () => {
      await request(harness.app).post('/graphql').send({ query: '{ __typename }' }).expect(200);
    });

    it('reports a syntax error as a client error', async () => {
      const response = await post(harness.app, '{ makes { items {');

      expect(response.body.errors[0].extensions.code).toBe('GRAPHQL_PARSE_FAILED');
    });

    it('reports an unknown field as a validation error', async () => {
      const response = await post(harness.app, '{ makes { items { notAField } } }');

      expect(response.body.errors[0].extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
    });
  });

  describe('query: makes', () => {
    it('returns the unified structure the contract specifies', async () => {
      const response = await post(
        harness.app,
        `{ makes(filter: { search: "ASTON MARTIN" }) {
             items { makeId makeName vehicleTypes { typeId typeName } }
           } }`,
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([
        {
          makeId: '440',
          makeName: 'ASTON MARTIN',
          vehicleTypes: [
            { typeId: '2', typeName: 'Passenger Car' },
            { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
          ],
        },
      ]);
    });

    it('orders makes by name, case-insensitively', async () => {
      const response = await post(harness.app, '{ makes { items { makeName } } }').expect(200);

      expect(response.body.data.makes.items.map((m: Make) => m.makeName)).toEqual([
        '#1 ALPINE CUSTOMS',
        '1/OFF KUSTOMS, LLC',
        'ASTON MARTIN',
        'BENTLEY',
        'NO TYPES LTD',
      ]);
    });

    it('returns a make with no vehicle types as an empty list, not null', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { search: "NO TYPES" }) { items { makeId vehicleTypes { typeId } } } }',
      ).expect(200);

      expect(response.body.data.makes.items[0].vehicleTypes).toEqual([]);
    });

    it('searches names case-insensitively', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { search: "bentley" }) { items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([{ makeId: '441' }]);
    });

    it('treats regex metacharacters in a search as literal text', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { search: "1/OFF KUSTOMS, LLC" }) { items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([{ makeId: '4877' }]);
    });

    it('does not match everything when given a wildcard pattern', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { search: ".*" }) { items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([]);
    });

    it('filters by vehicle type', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { vehicleTypeId: "2" }) { items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes.items.map((m: Make) => m.makeId).sort()).toEqual([
        '440',
        '441',
      ]);
    });

    it('combines both filter criteria', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { search: "bentley", vehicleTypeId: "2" }) { items { makeId } } }',
      ).expect(200);

      expect(response.body.data.makes.items).toEqual([{ makeId: '441' }]);
    });

    it('returns an empty page rather than an error when nothing matches', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { search: "NOPE" }) { items { makeId } totalCount hasMore } }',
      ).expect(200);

      expect(response.body.data.makes).toEqual({ items: [], totalCount: 0, hasMore: false });
    });
  });

  describe('pagination', () => {
    it('applies limit and reports the page metadata', async () => {
      const response = await post(
        harness.app,
        '{ makes(limit: 2) { items { makeName } totalCount limit offset hasMore } }',
      ).expect(200);

      expect(response.body.data.makes).toMatchObject({
        totalCount: 5,
        limit: 2,
        offset: 0,
        hasMore: true,
      });
      expect(response.body.data.makes.items).toHaveLength(2);
    });

    it('never returns more items than the requested limit', async () => {
      // The resolver over-fetches by one to detect a next page; that extra row
      // must not leak into the response.
      const response = await post(harness.app, '{ makes(limit: 3) { items { makeId } } }').expect(
        200,
      );

      expect(response.body.data.makes.items).toHaveLength(3);
    });

    it('reports hasMore false on the last page', async () => {
      const response = await post(
        harness.app,
        '{ makes(limit: 2, offset: 3) { items { makeId } hasMore } }',
      ).expect(200);

      expect(response.body.data.makes.hasMore).toBe(false);
    });

    it('walks the whole catalogue without dropping or repeating a make', async () => {
      const ids: string[] = [];
      for (let offset = 0; offset < 6; offset += 2) {
        const response = await post(
          harness.app,
          `{ makes(limit: 2, offset: ${offset}) { items { makeId } } }`,
        ).expect(200);
        ids.push(...response.body.data.makes.items.map((m: Make) => m.makeId));
      }

      expect(ids).toEqual(['12858', '4877', '440', '441', '999']);
    });

    it('defaults to a page size of 50', async () => {
      const response = await post(harness.app, '{ makes { limit } }').expect(200);

      expect(response.body.data.makes.limit).toBe(50);
    });

    it(`rejects a limit above the ${MAX_PAGE_SIZE} maximum instead of truncating silently`, async () => {
      const response = await post(harness.app, `{ makes(limit: ${MAX_PAGE_SIZE + 1}) { limit } }`);

      expect(response.body.errors[0].extensions.code).toBe('BAD_REQUEST');
      expect(response.body.errors[0].message).toContain(String(MAX_PAGE_SIZE));
    });

    it.each([0, -1])('rejects a limit of %i', async (limit) => {
      const response = await post(harness.app, `{ makes(limit: ${limit}) { limit } }`);

      expect(response.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });

    it('rejects a negative offset', async () => {
      const response = await post(harness.app, '{ makes(offset: -5) { offset } }');

      expect(response.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });

    it('counts the filtered set, not the whole catalogue', async () => {
      const response = await post(
        harness.app,
        '{ makes(filter: { vehicleTypeId: "2" }, limit: 1) { totalCount } }',
      ).expect(200);

      expect(response.body.data.makes.totalCount).toBe(2);
    });
  });

  describe('performance characteristics', () => {
    it('does not run the count query unless totalCount is selected', async () => {
      // The whole reason totalCount is a lazy field resolver.
      const { app, repository, handler } = await createHarness();
      let counts = 0;
      const originalCount = repository.count.bind(repository);
      repository.count = (query) => {
        counts += 1;
        return originalCount(query);
      };

      await post(app, '{ makes { items { makeId } } }').expect(200);
      expect(counts).toBe(0);

      await post(app, '{ makes { totalCount } }').expect(200);
      expect(counts).toBe(1);

      await handler.stop();
    });

    it('resolves embedded vehicle types without a second read', async () => {
      // Types live in the make document, so there is no per-make lookup and
      // therefore no N+1.
      const { app, repository, handler } = await createHarness();
      let lookups = 0;
      const originalFindByMakeId = repository.findByMakeId.bind(repository);
      repository.findByMakeId = (id) => {
        lookups += 1;
        return originalFindByMakeId(id);
      };

      await post(app, '{ makes { items { makeId vehicleTypes { typeId } } } }').expect(200);

      expect(lookups).toBe(0);
      await handler.stop();
    });
  });

  describe('query: make', () => {
    it('fetches a single make by id', async () => {
      const response = await post(
        harness.app,
        '{ make(makeId: "440") { makeId makeName vehicleTypes { typeId } } }',
      ).expect(200);

      expect(response.body.data.make).toMatchObject({ makeId: '440', makeName: 'ASTON MARTIN' });
    });

    it('returns null for an unknown make rather than an error', async () => {
      const response = await post(
        harness.app,
        '{ make(makeId: "does-not-exist") { makeId } }',
      ).expect(200);

      expect(response.body.data.make).toBeNull();
      expect(response.body.errors).toBeUndefined();
    });

    it('requires the makeId argument', async () => {
      const response = await post(harness.app, '{ make { makeId } }');

      expect(response.body.errors[0].extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
    });
  });

  describe('query: vehicleTypes', () => {
    it('returns each distinct type once, ordered by id', async () => {
      const response = await post(harness.app, '{ vehicleTypes { typeId typeName } }').expect(200);

      expect(response.body.data.vehicleTypes).toEqual([
        { typeId: '1', typeName: 'Motorcycle' },
        { typeId: '2', typeName: 'Passenger Car' },
        { typeId: '6', typeName: 'Trailer' },
        { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
      ]);
    });
  });

  describe('error handling', () => {
    it('maps a repository failure to a typed GraphQL error', async () => {
      const { app, repository, handler } = await createHarness();
      repository.findMany = () => Promise.reject(new Error('mongo exploded'));

      const response = await post(app, '{ makes { items { makeId } } }');

      expect(response.body.errors).toHaveLength(1);
      expect(response.body.data).toBeNull();
      await handler.stop();
    });

    it('hides internal error detail in production', async () => {
      const { app, repository, handler } = await createHarness({ production: true });
      repository.findMany = () => Promise.reject(new Error('connection string leaked here'));

      const response = await post(app, '{ makes { items { makeId } } }');

      expect(response.body.errors[0].message).toBe('Internal server error');
      expect(JSON.stringify(response.body)).not.toContain('connection string leaked here');
      await handler.stop();
    });

    it('still reports validation errors clearly in production', async () => {
      const { app, handler } = await createHarness({ production: true });

      const response = await post(app, '{ nope }');

      expect(response.body.errors[0].extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
      await handler.stop();
    });

    it('does not mask a malformed request as an internal error in production', async () => {
      // A bare GET with no query is the caller's mistake. Reporting it as
      // INTERNAL_ERROR sends them hunting for a server fault that isn't there.
      const { app, handler } = await createHarness({ production: true });

      const response = await request(app).get('/graphql').expect(400);

      expect(response.body.errors[0].extensions.code).toBe('BAD_REQUEST');
      expect(response.body.errors[0].message).not.toBe('Internal server error');
      await handler.stop();
    });

    it('reports a parse error clearly in production too', async () => {
      const { app, handler } = await createHarness({ production: true });

      const response = await post(app, '{ makes { items {');

      expect(response.body.errors[0].extensions.code).toBe('GRAPHQL_PARSE_FAILED');
      await handler.stop();
    });
  });

  describe('schema documentation', () => {
    it('exposes descriptions through introspection outside production', async () => {
      const response = await post(
        harness.app,
        `{ __type(name: "Make") {
             description
             fields { name description type { kind name ofType { name } } }
           } }`,
      ).expect(200);

      const type = response.body.data.__type;
      expect(type.description).toBeTruthy();
      expect(type.fields.every((f: { description: string }) => Boolean(f.description))).toBe(true);
    });

    it('documents every query field', async () => {
      const response = await post(
        harness.app,
        '{ __schema { queryType { fields { name description } } } }',
      ).expect(200);

      const fields = response.body.data.__schema.queryType.fields;
      expect(fields.map((f: { name: string }) => f.name).sort()).toEqual([
        'make',
        'makes',
        'vehicleTypes',
      ]);
      expect(fields.every((f: { description: string }) => Boolean(f.description))).toBe(true);
    });

    it('disables introspection in production', async () => {
      const { app, handler } = await createHarness({ production: true });

      const response = await post(app, '{ __schema { queryType { name } } }');

      expect(response.body.errors).toBeDefined();
      await handler.stop();
    });

    it('declares non-null list types so clients never handle null arrays', async () => {
      const response = await post(
        harness.app,
        `{ __type(name: "Make") { fields { name type { kind ofType { kind } } } } }`,
      ).expect(200);

      const vehicleTypes = response.body.data.__type.fields.find(
        (f: { name: string }) => f.name === 'vehicleTypes',
      );
      expect(vehicleTypes.type.kind).toBe('NON_NULL');
      expect(vehicleTypes.type.ofType.kind).toBe('LIST');
    });
  });
});
