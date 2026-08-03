import type { ZodType } from 'zod';
import { UpstreamBadResponseError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import type { HttpClient } from '../http/http-client.js';
import { parseXml, toArray } from '../xml/xml-parser.js';
import {
  allMakesResponseSchema,
  makeRecordSchema,
  vehicleTypeRecordSchema,
  vehicleTypesResponseSchema,
} from './nhtsa.schemas.js';

/** A vehicle make as this service models it, decoupled from vPIC's field names. */
export interface NhtsaMake {
  readonly makeId: string;
  readonly makeName: string;
}

/** A vehicle type as this service models it. */
export interface NhtsaVehicleType {
  readonly typeId: string;
  readonly typeName: string;
}

export interface NhtsaResult<T> {
  readonly records: T[];
  readonly skipped: number;
}

export interface NhtsaClientOptions {
  readonly http: HttpClient;
  readonly logger: Logger;
}

export class NhtsaClient {
  private readonly http: HttpClient;
  private readonly logger: Logger;

  constructor(options: NhtsaClientOptions) {
    this.http = options.http;
    this.logger = options.logger.child({ component: 'nhtsa-client' });
  }

  // Fetches every vehicle make known to vPIC.
  async getAllMakes(): Promise<NhtsaResult<NhtsaMake>> {
    const path = '/getallmakes?format=XML';
    const results = await this.fetchResults(path, allMakesResponseSchema);

    return this.mapRecords(results, 'AllVehicleMakes', makeRecordSchema, path, (record) => ({
      makeId: record.Make_ID,
      makeName: record.Make_Name,
    }));
  }

  /**
   * Fetches the vehicle types associated with a single make.
   *
   * An unknown make id is not an error upstream: vPIC answers 200 with
   * `<Results />`, which maps to an empty list here.
   */
  async getVehicleTypesForMake(makeId: string): Promise<NhtsaResult<NhtsaVehicleType>> {
    const path = `/GetVehicleTypesForMakeId/${encodeURIComponent(makeId)}?format=xml`;
    const results = await this.fetchResults(path, vehicleTypesResponseSchema);

    return this.mapRecords(
      results,
      'VehicleTypesForMakeIds',
      vehicleTypeRecordSchema,
      path,
      (record) => ({
        typeId: record.VehicleTypeId,
        typeName: record.VehicleTypeName,
      }),
    );
  }

  // Fetch, parse and validate the envelope, returning the raw `Results` node.
  private async fetchResults(
    path: string,
    schema: ZodType<{ Response: { Results?: unknown } }>,
  ): Promise<unknown> {
    const body = await this.http.getText(path);
    const parsed = parseXml(body, path);
    const envelope = schema.safeParse(parsed);

    if (!envelope.success) {
      throw new UpstreamBadResponseError(`Unexpected vPIC response shape for ${path}`, {
        context: {
          path,
          issues: envelope.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
      });
    }

    return envelope.data.Response.Results;
  }

  private mapRecords<Raw, Mapped>(
    results: unknown,
    elementName: string,
    schema: ZodType<Raw>,
    path: string,
    map: (record: Raw) => Mapped,
  ): NhtsaResult<Mapped> {
    const container =
      typeof results === 'object' && results !== null
        ? (results as Record<string, unknown>)[elementName]
        : undefined;
    const raw = toArray(container as unknown[]);
    const records: Mapped[] = [];
    let skipped = 0;

    for (const entry of raw) {
      const record = schema.safeParse(entry);
      if (record.success) {
        records.push(map(record.data));
      } else {
        skipped += 1;
        this.logger.warn(
          {
            path,
            issues: record.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          },
          'Skipping malformed vPIC record',
        );
      }
    }

    this.logger.debug({ path, count: records.length, skipped }, 'Fetched vPIC records');
    return { records, skipped };
  }
}
