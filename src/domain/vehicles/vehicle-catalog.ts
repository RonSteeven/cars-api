import { TransformationError } from '@/shared/errors.js';
import type { CatalogInput, CatalogResult, Make, VehicleType } from '@/types/vehicle.js';
import { compareIds } from '@/utils/sort.js';
import { makeSchema, vehicleTypeSchema } from './vehicle.schemas.js';

/** Validates, de-duplicates and orders the vehicle types belonging to one make. */
const collectVehicleTypes = (
  candidates: readonly VehicleType[],
): { vehicleTypes: VehicleType[]; invalid: number; duplicates: number } => {
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

export const buildVehicleCatalog = (input: CatalogInput): CatalogResult => {
  const makes: Make[] = [];
  const seenMakeIds = new Set<string>();

  let invalidMakes = 0;
  let duplicateMakes = 0;
  let invalidVehicleTypes = 0;
  let duplicateVehicleTypes = 0;
  let vehicleTypesOut = 0;
  let makesWithoutVehicleTypes = 0;

  for (const candidate of input.makes) {
    const parsed = makeSchema.safeParse({ ...candidate, vehicleTypes: [] });
    if (!parsed.success) {
      invalidMakes += 1;
      continue;
    }

    const { makeId, makeName } = parsed.data;

    if (seenMakeIds.has(makeId)) {
      duplicateMakes += 1;
      continue;
    }
    seenMakeIds.add(makeId);

    const types = collectVehicleTypes(input.vehicleTypesByMakeId.get(makeId) ?? []);
    invalidVehicleTypes += types.invalid;
    duplicateVehicleTypes += types.duplicates;
    vehicleTypesOut += types.vehicleTypes.length;
    if (types.vehicleTypes.length === 0) makesWithoutVehicleTypes += 1;

    makes.push({ makeId, makeName, vehicleTypes: types.vehicleTypes });
  }

  if (input.makes.length > 0 && makes.length === 0) {
    throw new TransformationError(
      'Every make failed validation, which indicates a changed upstream contract',
      { context: { makesIn: input.makes.length, invalidMakes, duplicateMakes } },
    );
  }

  makes.sort((a, b) => compareIds(a.makeId, b.makeId));

  return {
    makes,
    stats: {
      makesIn: input.makes.length,
      makesOut: makes.length,
      invalidMakes,
      duplicateMakes,
      makesWithoutVehicleTypes,
      vehicleTypesOut,
      invalidVehicleTypes,
      duplicateVehicleTypes,
    },
  };
};
