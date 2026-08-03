import type { ZodType } from 'zod';
import { UpstreamBadResponseError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import type {
  NhtsaClientOptions,
  NhtsaMake,
  NhtsaResult,
  NhtsaVehicleType,
} from '../../types/nhtsa.js';
import type { HttpClient } from '../http/http-client.js';
import { toArray } from '../../utils/array.js';
import { parseXml } from '../xml/xml-parser.js';
import {
  allMakesResponseSchema,
  makeRecordSchema,
  vehicleTypeRecordSchema,
  vehicleTypesResponseSchema,
} from './nhtsa.schemas.js';

/**
 * Adapter over the NHTSA vPIC API.
 *
 * This is the anti-corruption layer: it owns the URLs, the XML, vPIC's
 * `Make_ID`-style naming and every way the upstream can disappoint us. Callers
 * receive plain, validated objects in our own vocabulary and never learn that
 * XML was involved.
 *
 * Failure policy is split on purpose:
 *  - a broken *envelope* (not XML at all, no `Response`, no `Results`) throws,
 *    because that means the contract changed and continuing would fabricate an
 *    empty catalogue,
 *  - a broken *record* inside an otherwise valid envelope is logged and skipped,
 *    because one malformed row out of twelve thousand should not abort a run.
 */
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

  /**
   * Validate each repeated element, mapping the good ones and counting the rest.
   *
   * `Results` is a container, not the list itself: the repeated records sit
   * under a named child (`AllVehicleMakes`, `VehicleTypesForMakeIds`). When the
   * container is absent or empty — `<Results />` for an unknown make — that
   * child is simply missing and the batch is empty.
   */
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
