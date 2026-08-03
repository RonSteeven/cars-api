import { vehicleTypeSchema } from '../domain/vehicles/vehicle.schemas.js';
import type { VehicleType, VehicleTypeCollection } from '../types/vehicle.js';
import { compareIds } from './sort.js';

/** Validates, de-duplicates and orders the vehicle types belonging to one make. */
export const collectVehicleTypes = (candidates: readonly VehicleType[]): VehicleTypeCollection => {
  const vehicleTypes: VehicleType[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;

  for (const candidate of candidates) {
    const parsed = vehicleTypeSchema.safeParse(candidate);
    if (!parsed.success) {
      invalid += 1;
      continue;
    }
    if (seen.has(parsed.data.typeId)) {
      duplicates += 1;
      continue;
    }
    seen.add(parsed.data.typeId);
    vehicleTypes.push(parsed.data);
  }

  vehicleTypes.sort((a, b) => compareIds(a.typeId, b.typeId));
  return { vehicleTypes, invalid, duplicates };
};
