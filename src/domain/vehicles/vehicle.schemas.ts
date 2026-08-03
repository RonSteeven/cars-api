import { z } from 'zod';
import { normalizeText } from '../../utils/text.js';
import type { Make, VehicleType } from '../../types/vehicle.js';

/** Runtime validation and normalisation for the vehicle catalogue. */

const identifier = z.string().trim().min(1);
const label = z.string().transform(normalizeText).pipe(z.string().min(1));

export const vehicleTypeSchema: z.ZodType<VehicleType> = z.object({
  typeId: identifier,
  typeName: label,
});

export const makeSchema: z.ZodType<Make> = z.object({
  makeId: identifier,
  makeName: label,
  vehicleTypes: z.array(vehicleTypeSchema),
});

export const vehicleCatalogSchema = z.array(makeSchema);
