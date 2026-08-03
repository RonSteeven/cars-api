import { TransformationError } from '../../shared/errors.js';
import type { CatalogInput, CatalogResult, Make } from '../../types/vehicle.js';
import { compareIds } from '../../utils/sort.js';
import { collectVehicleTypes } from '../../utils/vehicle.js';
import { makeSchema } from './vehicle.schemas.js';

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
