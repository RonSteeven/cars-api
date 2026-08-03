import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { MongoMakeRepository } from '@/infrastructure/persistence/mongo/make.repository.js';
import { PersistenceError } from '@/shared/errors.js';
import type { Make } from '@/types/vehicle.js';
import { createTestDatabase, isMongoAvailable, type TestDatabase } from '../helpers/mongo.js';

const logger = pino({ level: 'silent' });
const available = await isMongoAvailable();

const RUN_AT = new Date('2026-02-01T00:00:00.000Z');
const EARLIER = new Date('2026-01-01T00:00:00.000Z');

const ASTON: Make = {
  makeId: '440',
  makeName: 'ASTON MARTIN',
  vehicleTypes: [
    { typeId: '2', typeName: 'Passenger Car' },
    { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
  ],
};
const BENTLEY: Make = {
  makeId: '441',
  makeName: 'BENTLEY',
  vehicleTypes: [{ typeId: '2', typeName: 'Passenger Car' }],
};
const TRAILERS: Make = {
  makeId: '12858',
  makeName: '#1 ALPINE CUSTOMS',
  vehicleTypes: [{ typeId: '6', typeName: 'Trailer' }],
};

describe.skipIf(!available)('MongoMakeRepository (integration)', () => {
  let database: TestDatabase;
  let repository: MongoMakeRepository;

  beforeAll(async () => {
    database = await createTestDatabase('make_repository');
    repository = new MongoMakeRepository(database.db, logger);
    await repository.ensureIndexes();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.db.collection('makes').deleteMany({});
  });

  describe('ensureIndexes', () => {
    it('creates the indexes the queries rely on', async () => {
      const names = (await database.db.collection('makes').indexes()).map((i) => i.name);

      expect(names).toContain('makeName_ci');
      expect(names).toContain('vehicleTypes_typeId');
      expect(names).toContain('syncedAt');
    });

    it('is safe to call again', async () => {
      await expect(repository.ensureIndexes()).resolves.toBeUndefined();
    });
  });

  describe('upsertMany', () => {
    it('inserts new makes', async () => {
      const result = await repository.upsertMany([ASTON, BENTLEY], RUN_AT);

      expect(result.inserted).toBe(2);
      await expect(repository.count()).resolves.toBe(2);
    });

    it('is idempotent: a second identical run inserts nothing', async () => {
      await repository.upsertMany([ASTON], RUN_AT);
      const second = await repository.upsertMany([ASTON], RUN_AT);

      expect(second.inserted).toBe(0);
      expect(second.matched).toBe(1);
      await expect(repository.count()).resolves.toBe(1);
    });

    it('updates an existing make in place rather than duplicating it', async () => {
      await repository.upsertMany([ASTON], EARLIER);
      await repository.upsertMany([{ ...ASTON, makeName: 'ASTON MARTIN LAGONDA' }], RUN_AT);

      await expect(repository.count()).resolves.toBe(1);
      const stored = await repository.findByMakeId('440');
      expect(stored?.makeName).toBe('ASTON MARTIN LAGONDA');
    });

    it('replaces the vehicle type list instead of merging it', async () => {
      await repository.upsertMany([ASTON], EARLIER);
      await repository.upsertMany([{ ...ASTON, vehicleTypes: [ASTON.vehicleTypes[0]!] }], RUN_AT);

      const stored = await repository.findByMakeId('440');
      expect(stored?.vehicleTypes).toEqual([{ typeId: '2', typeName: 'Passenger Car' }]);
    });

    it('stores a make with no vehicle types', async () => {
      await repository.upsertMany([{ ...ASTON, vehicleTypes: [] }], RUN_AT);

      await expect(repository.findByMakeId('440')).resolves.toEqual({
        makeId: '440',
        makeName: 'ASTON MARTIN',
        vehicleTypes: [],
      });
    });

    it('accepts an empty batch without touching the database', async () => {
      await expect(repository.upsertMany([], RUN_AT)).resolves.toEqual({
        matched: 0,
        modified: 0,
        inserted: 0,
      });
    });

    it('writes a batch larger than the internal chunk size', async () => {
      // Exercises the chunking loop: 2,500 docs is three bulkWrite round trips.
      const many: Make[] = Array.from({ length: 2_500 }, (_, index) => ({
        makeId: String(index),
        makeName: `MAKE ${index}`,
        vehicleTypes: [{ typeId: '2', typeName: 'Passenger Car' }],
      }));

      const result = await repository.upsertMany(many, RUN_AT);

      expect(result.inserted).toBe(2_500);
      await expect(repository.count()).resolves.toBe(2_500);
    });
  });

  describe('deleteStaleBefore', () => {
    it('removes makes the latest run did not touch', async () => {
      await repository.upsertMany([ASTON, BENTLEY], EARLIER);
      await repository.upsertMany([ASTON], RUN_AT);

      const deleted = await repository.deleteStaleBefore(RUN_AT);

      expect(deleted).toBe(1);
      await expect(repository.findByMakeId('441')).resolves.toBeNull();
      await expect(repository.findByMakeId('440')).resolves.not.toBeNull();
    });

    it('deletes nothing when every make was refreshed', async () => {
      await repository.upsertMany([ASTON, BENTLEY], RUN_AT);

      await expect(repository.deleteStaleBefore(RUN_AT)).resolves.toBe(0);
    });
  });

  describe('findByMakeId', () => {
    it('returns the stored make', async () => {
      await repository.upsertMany([ASTON], RUN_AT);

      await expect(repository.findByMakeId('440')).resolves.toEqual(ASTON);
    });

    it('returns null for an unknown id rather than throwing', async () => {
      await expect(repository.findByMakeId('999999')).resolves.toBeNull();
    });

    it('does not leak storage-only fields', async () => {
      await repository.upsertMany([ASTON], RUN_AT);
      const stored = await repository.findByMakeId('440');

      expect(Object.keys(stored ?? {})).toEqual(['makeId', 'makeName', 'vehicleTypes']);
    });
  });

  describe('findMany', () => {
    beforeEach(async () => {
      await repository.upsertMany([ASTON, BENTLEY, TRAILERS], RUN_AT);
    });

    it('returns every make ordered by name', async () => {
      const makes = await repository.findMany();

      expect(makes.map((m) => m.makeName)).toEqual([
        '#1 ALPINE CUSTOMS',
        'ASTON MARTIN',
        'BENTLEY',
      ]);
    });

    it('matches names case-insensitively', async () => {
      const makes = await repository.findMany({ search: 'aston' });

      expect(makes.map((m) => m.makeId)).toEqual(['440']);
    });

    it('matches a substring anywhere in the name', async () => {
      const makes = await repository.findMany({ search: 'MARTIN' });

      expect(makes).toHaveLength(1);
    });

    it('treats regex metacharacters in the search literally', async () => {
      // Would match everything if the input were used as a live pattern.
      await expect(repository.findMany({ search: '.*' })).resolves.toEqual([]);
    });

    it('filters by embedded vehicle type', async () => {
      const makes = await repository.findMany({ vehicleTypeId: '2' });

      expect(makes.map((m) => m.makeId).sort()).toEqual(['440', '441']);
    });

    it('combines search and vehicle type', async () => {
      const makes = await repository.findMany({ search: 'bentley', vehicleTypeId: '2' });

      expect(makes.map((m) => m.makeId)).toEqual(['441']);
    });

    it('returns nothing when the vehicle type matches no make', async () => {
      await expect(repository.findMany({ vehicleTypeId: '99' })).resolves.toEqual([]);
    });

    it('applies limit', async () => {
      await expect(repository.findMany({ limit: 2 })).resolves.toHaveLength(2);
    });

    it('applies offset, keeping the ordering stable', async () => {
      const page = await repository.findMany({ offset: 1, limit: 1 });

      expect(page.map((m) => m.makeName)).toEqual(['ASTON MARTIN']);
    });

    it('paginates without dropping or repeating a make', async () => {
      const first = await repository.findMany({ limit: 2, offset: 0 });
      const second = await repository.findMany({ limit: 2, offset: 2 });

      expect([...first, ...second].map((m) => m.makeId)).toEqual(['12858', '440', '441']);
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await repository.upsertMany([ASTON, BENTLEY, TRAILERS], RUN_AT);
    });

    it('counts everything by default', async () => {
      await expect(repository.count()).resolves.toBe(3);
    });

    it('counts the filtered set, ignoring pagination', async () => {
      await expect(repository.count({ vehicleTypeId: '2', limit: 1 })).resolves.toBe(2);
    });
  });

  describe('listVehicleTypes', () => {
    it('returns each distinct type once, ordered by id', async () => {
      await repository.upsertMany([ASTON, BENTLEY, TRAILERS], RUN_AT);

      // ASTON and BENTLEY share type 2; it must appear once.
      await expect(repository.listVehicleTypes()).resolves.toEqual([
        { typeId: '2', typeName: 'Passenger Car' },
        { typeId: '6', typeName: 'Trailer' },
        { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
      ]);
    });

    it('ignores makes with no vehicle types', async () => {
      await repository.upsertMany([{ ...ASTON, vehicleTypes: [] }, BENTLEY], RUN_AT);

      await expect(repository.listVehicleTypes()).resolves.toEqual([
        { typeId: '2', typeName: 'Passenger Car' },
      ]);
    });

    it('returns nothing for an empty collection', async () => {
      await expect(repository.listVehicleTypes()).resolves.toEqual([]);
    });
  });

  describe('error handling', () => {
    it('wraps a driver failure in a PersistenceError', async () => {
      const broken = new MongoMakeRepository(database.db, logger);
      // $ne against _id with an invalid operator shape is rejected by the server.
      await expect(
        broken.findMany({ vehicleTypeId: { $invalid: 1 } as unknown as string }),
      ).rejects.toBeInstanceOf(PersistenceError);
    });
  });
});
