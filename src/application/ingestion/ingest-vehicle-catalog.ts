import { buildVehicleCatalog } from '@/domain/vehicles/vehicle-catalog.js';
import type {
  IngestionDependencies,
  IngestionOptions,
  IngestionReport,
} from '@/types/ingestion.js';
import type { MakeInput, VehicleType } from '@/types/vehicle.js';
import { mapWithConcurrency } from '@/utils/concurrency.js';

const PROGRESS_INTERVAL = 1_000;

export const ingestVehicleCatalog = async (
  dependencies: IngestionDependencies,
  options: IngestionOptions = {},
): Promise<IngestionReport> => {
  const { source, repository, concurrency, makeLimit } = dependencies;
  const now = dependencies.now ?? ((): Date => new Date());
  const logger = dependencies.logger.child({ component: 'ingestion' });

  const startedAt = now();
  const startedAtMs = Date.now();
  logger.info({ concurrency, makeLimit: makeLimit || 'none' }, 'Ingestion started');

  // ---------------------------------------------------------------- 1. makes
  const allMakes = await source.getAllMakes();
  const makes: MakeInput[] =
    makeLimit > 0 ? allMakes.records.slice(0, makeLimit) : [...allMakes.records];

  logger.info(
    { fetched: allMakes.records.length, processing: makes.length, skipped: allMakes.skipped },
    'Fetched make list',
  );

  // ------------------------------------------------- 2. vehicle types per make
  const outcome = await mapWithConcurrency(
    makes,
    concurrency,
    async (make) => source.getVehicleTypesForMake(make.makeId),
    {
      ...(options.signal ? { signal: options.signal } : {}),
      onProgress: (completed, total) => {
        if (completed % PROGRESS_INTERVAL === 0 || completed === total) {
          logger.info({ completed, total }, 'Fetching vehicle types');
        }
      },
    },
  );

  const vehicleTypesByMakeId = new Map<string, readonly VehicleType[]>();
  let vehicleTypesSkippedUpstream = 0;

  for (const { item, value } of outcome.results) {
    vehicleTypesByMakeId.set(item.makeId, value.records);
    vehicleTypesSkippedUpstream += value.skipped;
  }

  for (const failure of outcome.failures) {
    logger.warn(
      { makeId: failure.item.makeId, err: failure.error.message },
      'Excluding make from this run: vehicle types could not be fetched',
    );
  }

  // Rule 1: a make we could not fully resolve is left out entirely, so its
  // stored document keeps whatever it already had.
  const resolvedMakes = outcome.results.map(({ item }) => item);

  // ----------------------------------------------------------- 3. transform
  const { makes: catalog, stats } = buildVehicleCatalog({
    makes: resolvedMakes,
    vehicleTypesByMakeId,
  });

  // ------------------------------------------------------------- 4. persist
  const upserted = await repository.upsertMany(catalog, startedAt);

  // --------------------------------------------------------------- 5. prune
  // Rule 2: only a complete pass may delete.
  const complete = outcome.failures.length === 0 && !outcome.aborted;
  let pruned = 0;

  if (complete && makeLimit === 0) {
    pruned = await repository.deleteStaleBefore(startedAt);
  } else if (!complete) {
    logger.warn(
      { failedMakes: outcome.failures.length, aborted: outcome.aborted },
      'Skipping prune: run was incomplete, stale records would be indistinguishable from failures',
    );
  } else {
    // A capped run only ever sees part of the catalogue, so everything outside
    // the cap would look stale.
    logger.info({ makeLimit }, 'Skipping prune: run was capped by INGEST_MAKE_LIMIT');
  }

  const report: IngestionReport = {
    startedAt,
    durationMs: Date.now() - startedAtMs,
    makesFetched: makes.length,
    makesSkippedUpstream: allMakes.skipped,
    vehicleTypesSkippedUpstream,
    failedMakes: outcome.failures.length,
    catalog: stats,
    upserted,
    pruned,
    pruneSkipped: !complete || makeLimit > 0,
    aborted: outcome.aborted,
  };

  logger.info({ report }, outcome.aborted ? 'Ingestion aborted' : 'Ingestion complete');
  return report;
};
