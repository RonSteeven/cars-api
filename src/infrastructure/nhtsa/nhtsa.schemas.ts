import { z } from 'zod';

const xmlScalar = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1));


const resultsContainer = z.unknown().optional();

// `GET /getallmakes?format=XML`
export const allMakesResponseSchema = z.object({
  Response: z.object({
    Count: z.unknown().optional(),
    Message: z.unknown().optional(),
    Results: resultsContainer,
  }),
});

export const makeRecordSchema = z.object({
  Make_ID: xmlScalar,
  Make_Name: xmlScalar,
});

// `GET /GetVehicleTypesForMakeId/{id}?format=xml`
export const vehicleTypesResponseSchema = z.object({
  Response: z.object({
    Count: z.unknown().optional(),
    Message: z.unknown().optional(),
    SearchCriteria: z.unknown().optional(),
    Results: resultsContainer,
  }),
});

export const vehicleTypeRecordSchema = z.object({
  VehicleTypeId: xmlScalar,
  VehicleTypeName: xmlScalar,
});

export type MakeRecord = z.infer<typeof makeRecordSchema>;
export type VehicleTypeRecord = z.infer<typeof vehicleTypeRecordSchema>;
