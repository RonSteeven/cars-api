/**
 * Vehicle catalogue types.
 *
 * These shapes are the contract: exactly what gets persisted and exactly what
 * the GraphQL layer serves, so no mapping step sits between the domain and the
 * wire. Ids stay strings because they are opaque keys we never do arithmetic on.
 */

export interface VehicleType {
  readonly typeId: string;
  readonly typeName: string;
}

export interface Make {
  readonly makeId: string;
  readonly makeName: string;
  readonly vehicleTypes: readonly VehicleType[];
}

/** A make as it arrives from the source adapter, before its types are attached. */
export interface MakeInput {
  readonly makeId: string;
  readonly makeName: string;
}

export interface CatalogInput {
  readonly makes: readonly MakeInput[];
  /** Vehicle types keyed by make id. A missing key means "none known". */
  readonly vehicleTypesByMakeId: ReadonlyMap<string, readonly VehicleType[]>;
}

/**
 * Counts describing what the transformation did. Reported by the ingestion run,
 * because "we stored 11,998 of 12,312" is the difference between a healthy pass
 * and silent data loss.
 */
export interface CatalogStats {
  readonly makesIn: number;
  readonly makesOut: number;
  readonly invalidMakes: number;
  readonly duplicateMakes: number;
  readonly makesWithoutVehicleTypes: number;
  readonly vehicleTypesOut: number;
  readonly invalidVehicleTypes: number;
  readonly duplicateVehicleTypes: number;
}

export interface CatalogResult {
  readonly makes: Make[];
  readonly stats: CatalogStats;
}
