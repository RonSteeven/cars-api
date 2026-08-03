import type { Logger } from 'pino';
import type { MakeRepository, UpsertResult } from './persistence.js';
import type { NhtsaMake, NhtsaResult, NhtsaVehicleType } from './nhtsa.js';
import type { CatalogStats } from './vehicle.js';

export interface VehicleCatalogSource {
  getAllMakes(): Promise<NhtsaResult<NhtsaMake>>;
  getVehicleTypesForMake(makeId: string): Promise<NhtsaResult<NhtsaVehicleType>>;
}

export interface IngestionDependencies {
  readonly source: VehicleCatalogSource;
  readonly repository: MakeRepository;
  readonly logger: Logger;
  readonly concurrency: number;
  readonly makeLimit: number;
  readonly now?: () => Date;
}

export interface IngestionOptions {
  readonly signal?: AbortSignal;
}

export interface IngestionReport {
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly makesFetched: number;
  readonly makesSkippedUpstream: number;
  readonly vehicleTypesSkippedUpstream: number;
  readonly failedMakes: number;
  readonly catalog: CatalogStats;
  readonly upserted: UpsertResult;
  readonly pruned: number;
  readonly pruneSkipped: boolean;
  readonly aborted: boolean;
}
