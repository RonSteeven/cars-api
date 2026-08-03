import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { ingestVehicleCatalog } from './ingest-vehicle-catalog.js';
import { UpstreamUnavailableError } from '../../shared/errors.js';
import type { VehicleCatalogSource } from '../../types/ingestion.js';
import { FakeMakeRepository } from '../../../tests/helpers/fake-make-repository.js';
import type { Make } from '../../types/vehicle.js';

const logger = pino({ level: 'silent' });
const RUN_AT = new Date('2026-03-01T00:00:00.000Z');

interface SourceSpec {
  makes: { makeId: string; makeName: string }[];
  types: Record<string, { typeId: string; typeName: string }[]>;
  makesSkipped?: number;
  typesSkipped?: Record<string, number>;
  failFor?: Set<string>;
}

const createSource = (spec: SourceSpec): VehicleCatalogSource => ({
  getAllMakes: () => Promise.resolve({ records: spec.makes, skipped: spec.makesSkipped ?? 0 }),
  getVehicleTypesForMake: (makeId) => {
    if (spec.failFor?.has(makeId)) {
      return Promise.reject(new UpstreamUnavailableError(`vPIC unreachable for ${makeId}`));
    }
    return Promise.resolve({
      records: spec.types[makeId] ?? [],
      skipped: spec.typesSkipped?.[makeId] ?? 0,
    });
  },
});

const MAKES = [
  { makeId: '440', makeName: 'ASTON MARTIN' },
  { makeId: '441', makeName: 'BENTLEY' },
];
const TYPES = {
  '440': [{ typeId: '2', typeName: 'Passenger Car' }],
  '441': [{ typeId: '7', typeName: 'MPV' }],
};

const run = (spec: SourceSpec, overrides: { concurrency?: number; makeLimit?: number } = {}) => {
  const repository = new FakeMakeRepository();
  return {
    repository,
    report: ingestVehicleCatalog({
      source: createSource(spec),
      repository,
      logger,
      concurrency: overrides.concurrency ?? 4,
      makeLimit: overrides.makeLimit ?? 0,
      now: () => RUN_AT,
    }),
  };
};

describe('ingestVehicleCatalog', () => {
  describe('the happy path', () => {
    it('persists every make with its vehicle types', async () => {
      const { repository, report } = run({ makes: MAKES, types: TYPES });
      await report;

      expect(await repository.findByMakeId('440')).toEqual({
        makeId: '440',
        makeName: 'ASTON MARTIN',
        vehicleTypes: [{ typeId: '2', typeName: 'Passenger Car' }],
      });
      expect(await repository.count()).toBe(2);
    });

    it('stamps every document with the run start timestamp', async () => {
      const { repository, report } = run({ makes: MAKES, types: TYPES });
      await report;

      expect(repository.upsertCalls[0]?.syncedAt).toBe(RUN_AT);
    });

    it('reports what it did', async () => {
      const { report } = run({ makes: MAKES, types: TYPES });

      await expect(report).resolves.toMatchObject({
        startedAt: RUN_AT,
        makesFetched: 2,
        failedMakes: 0,
        aborted: false,
        pruneSkipped: false,
        upserted: { inserted: 2 },
        catalog: { makesOut: 2, vehicleTypesOut: 2 },
      });
    });

    it('surfaces records the source dropped as malformed', async () => {
      const { report } = run({
        makes: MAKES,
        types: TYPES,
        makesSkipped: 3,
        typesSkipped: { '440': 1 },
      });

      await expect(report).resolves.toMatchObject({
        makesSkippedUpstream: 3,
        vehicleTypesSkippedUpstream: 1,
      });
    });

    it('keeps a make that genuinely has no vehicle types', async () => {
      const { repository, report } = run({ makes: MAKES, types: { '440': TYPES['440'] } });
      await report;

      expect(await repository.findByMakeId('441')).toEqual({
        makeId: '441',
        makeName: 'BENTLEY',
        vehicleTypes: [],
      });
    });

    it('handles an empty upstream catalogue without writing', async () => {
      const { repository, report } = run({ makes: [], types: {} });

      await expect(report).resolves.toMatchObject({ makesFetched: 0, upserted: { inserted: 0 } });
      expect(repository.stored.size).toBe(0);
    });
  });

  describe('rule 1: a make whose types cannot be fetched is excluded', () => {
    it('leaves the failed make out of the write', async () => {
      const { repository, report } = run({
        makes: MAKES,
        types: TYPES,
        failFor: new Set(['441']),
      });
      await report;

      expect(repository.upsertCalls[0]?.makes.map((m) => m.makeId)).toEqual(['440']);
    });

    it('does NOT overwrite stored types with an empty array', async () => {
      // The whole point: a transient network error must not erase good data.
      const repository = new FakeMakeRepository();
      const existing: Make = {
        makeId: '441',
        makeName: 'BENTLEY',
        vehicleTypes: [{ typeId: '7', typeName: 'MPV' }],
      };
      await repository.upsertMany([existing], new Date('2026-01-01T00:00:00.000Z'));

      await ingestVehicleCatalog({
        source: createSource({ makes: MAKES, types: TYPES, failFor: new Set(['441']) }),
        repository,
        logger,
        concurrency: 4,
        makeLimit: 0,
        now: () => RUN_AT,
      });

      expect(await repository.findByMakeId('441')).toEqual(existing);
    });

    it('still persists every make that did resolve', async () => {
      const { repository, report } = run({
        makes: MAKES,
        types: TYPES,
        failFor: new Set(['441']),
      });
      await report;

      expect(await repository.findByMakeId('440')).not.toBeNull();
    });

    it('counts the failures in the report', async () => {
      const { report } = run({ makes: MAKES, types: TYPES, failFor: new Set(['441']) });

      await expect(report).resolves.toMatchObject({ failedMakes: 1 });
    });

    it('does not abort the whole run when every make fails', async () => {
      const { report } = run({
        makes: MAKES,
        types: TYPES,
        failFor: new Set(['440', '441']),
      });

      await expect(report).resolves.toMatchObject({ failedMakes: 2, makesFetched: 2 });
    });
  });

  describe('rule 2: pruning only after a complete pass', () => {
    it('prunes makes that disappeared upstream', async () => {
      const repository = new FakeMakeRepository();
      await repository.upsertMany(
        [{ makeId: '999', makeName: 'GONE', vehicleTypes: [] }],
        new Date('2026-01-01T00:00:00.000Z'),
      );

      const report = await ingestVehicleCatalog({
        source: createSource({ makes: MAKES, types: TYPES }),
        repository,
        logger,
        concurrency: 4,
        makeLimit: 0,
        now: () => RUN_AT,
      });

      expect(report.pruned).toBe(1);
      expect(await repository.findByMakeId('999')).toBeNull();
    });

    it('skips the prune entirely when any make failed', async () => {
      const { repository, report } = run({
        makes: MAKES,
        types: TYPES,
        failFor: new Set(['441']),
      });

      await expect(report).resolves.toMatchObject({ pruned: 0, pruneSkipped: true });
      expect(repository.pruneCalls).toEqual([]);
    });

    it('does not delete an excluded make, which looks stale but is not', async () => {
      // 441 was excluded by rule 1, so its syncedAt is old. Pruning here would
      // delete a make that still exists upstream.
      const repository = new FakeMakeRepository();
      await repository.upsertMany(
        [{ makeId: '441', makeName: 'BENTLEY', vehicleTypes: [] }],
        new Date('2026-01-01T00:00:00.000Z'),
      );

      await ingestVehicleCatalog({
        source: createSource({ makes: MAKES, types: TYPES, failFor: new Set(['441']) }),
        repository,
        logger,
        concurrency: 4,
        makeLimit: 0,
        now: () => RUN_AT,
      });

      expect(await repository.findByMakeId('441')).not.toBeNull();
    });

    it('skips the prune on a capped run', async () => {
      // Everything beyond the cap was never fetched, so it would all look stale.
      const { repository, report } = run({ makes: MAKES, types: TYPES }, { makeLimit: 1 });

      await expect(report).resolves.toMatchObject({ pruneSkipped: true, makesFetched: 1 });
      expect(repository.pruneCalls).toEqual([]);
    });
  });

  describe('the make limit', () => {
    it('processes only the first N makes', async () => {
      const { repository, report } = run({ makes: MAKES, types: TYPES }, { makeLimit: 1 });
      await report;

      expect(repository.stored.size).toBe(1);
      expect(await repository.findByMakeId('440')).not.toBeNull();
    });

    it('treats 0 as no cap', async () => {
      const { report } = run({ makes: MAKES, types: TYPES }, { makeLimit: 0 });

      await expect(report).resolves.toMatchObject({ makesFetched: 2 });
    });

    it('ignores a cap larger than the catalogue', async () => {
      const { report } = run({ makes: MAKES, types: TYPES }, { makeLimit: 100 });

      await expect(report).resolves.toMatchObject({ makesFetched: 2 });
    });
  });

  describe('abortion', () => {
    let makes: { makeId: string; makeName: string }[];

    beforeEach(() => {
      makes = Array.from({ length: 50 }, (_, i) => ({
        makeId: String(i),
        makeName: `MAKE ${i}`,
      }));
    });

    it('stops the run and reports it', async () => {
      const controller = new AbortController();
      const repository = new FakeMakeRepository();
      const source: VehicleCatalogSource = {
        getAllMakes: () => Promise.resolve({ records: makes, skipped: 0 }),
        getVehicleTypesForMake: async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return { records: [], skipped: 0 };
        },
      };

      const promise = ingestVehicleCatalog(
        { source, repository, logger, concurrency: 2, makeLimit: 0, now: () => RUN_AT },
        { signal: controller.signal },
      );
      await new Promise((resolve) => setTimeout(resolve, 6));
      controller.abort();
      const report = await promise;

      expect(report.aborted).toBe(true);
      expect(report.catalog.makesOut).toBeLessThan(50);
    });

    it('still persists what it managed to gather', async () => {
      const controller = new AbortController();
      const repository = new FakeMakeRepository();
      const source: VehicleCatalogSource = {
        getAllMakes: () => Promise.resolve({ records: makes, skipped: 0 }),
        getVehicleTypesForMake: async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return { records: [{ typeId: '2', typeName: 'Passenger Car' }], skipped: 0 };
        },
      };

      const promise = ingestVehicleCatalog(
        { source, repository, logger, concurrency: 2, makeLimit: 0, now: () => RUN_AT },
        { signal: controller.signal },
      );
      await new Promise((resolve) => setTimeout(resolve, 6));
      controller.abort();
      await promise;

      expect(repository.stored.size).toBeGreaterThan(0);
    });

    it('never prunes after an abort', async () => {
      const controller = new AbortController();
      controller.abort();
      const repository = new FakeMakeRepository();

      const report = await ingestVehicleCatalog(
        {
          source: createSource({ makes: MAKES, types: TYPES }),
          repository,
          logger,
          concurrency: 2,
          makeLimit: 0,
          now: () => RUN_AT,
        },
        { signal: controller.signal },
      );

      expect(report.aborted).toBe(true);
      expect(report.pruneSkipped).toBe(true);
      expect(repository.pruneCalls).toEqual([]);
    });
  });

  describe('failure propagation', () => {
    it('rejects when the make list itself cannot be fetched', async () => {
      // Without the make list there is nothing to ingest, and continuing would
      // write an empty catalogue.
      const repository = new FakeMakeRepository();

      await expect(
        ingestVehicleCatalog({
          source: {
            getAllMakes: () => Promise.reject(new UpstreamUnavailableError('vPIC down')),
            getVehicleTypesForMake: () => Promise.resolve({ records: [], skipped: 0 }),
          },
          repository,
          logger,
          concurrency: 2,
          makeLimit: 0,
        }),
      ).rejects.toBeInstanceOf(UpstreamUnavailableError);

      expect(repository.upsertCalls).toEqual([]);
    });

    it('propagates a persistence failure', async () => {
      const repository = new FakeMakeRepository();
      vi.spyOn(repository, 'upsertMany').mockRejectedValue(new Error('mongo down'));

      await expect(
        ingestVehicleCatalog({
          source: createSource({ makes: MAKES, types: TYPES }),
          repository,
          logger,
          concurrency: 2,
          makeLimit: 0,
        }),
      ).rejects.toThrow('mongo down');
    });
  });

  it('respects the configured concurrency', async () => {
    let active = 0;
    let peak = 0;
    const repository = new FakeMakeRepository();
    const makes = Array.from({ length: 20 }, (_, i) => ({
      makeId: String(i),
      makeName: `MAKE ${i}`,
    }));

    await ingestVehicleCatalog({
      source: {
        getAllMakes: () => Promise.resolve({ records: makes, skipped: 0 }),
        getVehicleTypesForMake: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return { records: [], skipped: 0 };
        },
      },
      repository,
      logger,
      concurrency: 3,
      makeLimit: 0,
    });

    expect(peak).toBe(3);
  });
});
