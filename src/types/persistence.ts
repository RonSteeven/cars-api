import type { Make, VehicleType } from './vehicle.js';

/**
 * Persistence contracts.
 *
 * `MakeRepository` is a port: the domain and application layers depend on this
 * interface, never on the MongoDB driver. That is what lets the ingestion
 * pipeline be tested against an in-memory fake, and what would let the store be
 * swapped without touching a use case.
 */

/** How a make is stored. `_id` carries the make id, so the natural key is the primary key. */
export interface MakeDocument {
  readonly _id: string;
  readonly makeName: string;
  readonly vehicleTypes: readonly VehicleType[];
  /** Stamped on every write; a run prunes anything older than its own start. */
  readonly syncedAt: Date;
}

export interface MakeQuery {
  /** Case-insensitive substring match on the make name. */
  readonly search?: string;
  /** Only makes that have this vehicle type. */
  readonly vehicleTypeId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface UpsertResult {
  readonly matched: number;
  readonly modified: number;
  readonly inserted: number;
}

export interface MakeRepository {
  /** Creates the indexes the queries below rely on. Safe to call repeatedly. */
  ensureIndexes(): Promise<void>;
  /** Idempotent bulk write, chunked internally so a 12k catalogue is one call here. */
  upsertMany(makes: readonly Make[], syncedAt: Date): Promise<UpsertResult>;
  /** Removes makes untouched by the current run: they no longer exist upstream. */
  deleteStaleBefore(syncedAt: Date): Promise<number>;
  findMany(query?: MakeQuery): Promise<Make[]>;
  findByMakeId(makeId: string): Promise<Make | null>;
  count(query?: MakeQuery): Promise<number>;
}
