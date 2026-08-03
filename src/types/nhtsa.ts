import type { Logger } from 'pino';
import type { HttpClient } from '@/infrastructure/http/http-client.js';

/** Types for the NHTSA vPIC adapter, expressed in this service's vocabulary. */

export interface NhtsaMake {
  readonly makeId: string;
  readonly makeName: string;
}

export interface NhtsaVehicleType {
  readonly typeId: string;
  readonly typeName: string;
}

/**
 * The outcome of one upstream call.
 *
 * `skipped` is part of the return value rather than a log line only: across
 * 12,000+ makes, "we stored 11,998 of 12,000" is the difference between a
 * healthy run and silent data loss, and the caller needs that number to report it.
 */
export interface NhtsaResult<T> {
  readonly records: T[];
  readonly skipped: number;
}

export interface NhtsaClientOptions {
  readonly http: HttpClient;
  readonly logger: Logger;
}
