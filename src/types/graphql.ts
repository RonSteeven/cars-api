import type { Logger } from 'pino';
import type { MakeRepository, MakeQuery } from './persistence.js';
import type { Make, VehicleType } from './vehicle.js';

/** Everything a resolver may use. Injected per request, never imported. */
export interface GraphQLContext {
  readonly repository: MakeRepository;
  readonly logger: Logger;
}

export interface MakeFilterArgs {
  readonly search?: string | null;
  readonly vehicleTypeId?: string | null;
}

export interface MakesArgs {
  readonly filter?: MakeFilterArgs | null;
  readonly limit?: number | null;
  readonly offset?: number | null;
}

export interface MakeArgs {
  readonly makeId: string;
}

/**
 * What the `makes` resolver returns.
 *
 * `items` is resolved eagerly, `totalCount` is not: it is carried as the query
 * that produced the page so the field resolver can run the count only when the
 * client actually selects it.
 */
export interface MakeConnection {
  readonly items: Make[];
  readonly limit: number;
  readonly offset: number;
  readonly query: MakeQuery;
}

export interface GraphQLServerDependencies {
  readonly repository: MakeRepository;
  readonly logger: Logger;
  readonly introspection: boolean;
  /** Exposes error messages and stack traces. Off in production. */
  readonly exposeInternals: boolean;
}

export type { VehicleType };
