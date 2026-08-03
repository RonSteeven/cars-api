import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { NhtsaClient } from './nhtsa.client.js';
import { HttpClient, type FetchLike } from '../http/http-client.js';
import { UpstreamBadResponseError, XmlParseError } from '../../shared/errors.js';
import { loadFixture } from '../../../tests/fixtures/index.js';

const logger = pino({ level: 'silent' });

/**
 * Wires a real HttpClient and a real XML parser to a fake network, so these
 * tests cover the whole adapter (URL building, parsing, validation, mapping)
 * without a single outbound request.
 */
const createClient = (fetchImpl: FetchLike) => {
  const http = new HttpClient({
    baseUrl: 'https://vpic.test/api/vehicles',
    timeoutMs: 1_000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    logger,
    fetch: fetchImpl,
    sleep: () => Promise.resolve(),
  });
  return new NhtsaClient({ http, logger });
};

/** Return type is left inferred so tests can assert on `.mock.calls`. */
const respondWith = (body: string) =>
  vi.fn<FetchLike>().mockResolvedValue(new Response(body, { status: 200 }));

describe('NhtsaClient', () => {
  describe('getAllMakes', () => {
    it('maps vPIC field names onto the service vocabulary', async () => {
      const client = createClient(respondWith(loadFixture('get-all-makes.xml')));

      const { records, skipped } = await client.getAllMakes();

      expect(skipped).toBe(0);
      expect(records).toHaveLength(4);
      expect(records[2]).toEqual({ makeId: '440', makeName: 'ASTON MARTIN' });
    });

    it('requests the documented endpoint', async () => {
      const fetchImpl = respondWith(loadFixture('get-all-makes.xml'));
      await createClient(fetchImpl).getAllMakes();

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://vpic.test/api/vehicles/getallmakes?format=XML',
        expect.anything(),
      );
    });

    it('keeps ids as strings', async () => {
      const client = createClient(respondWith(loadFixture('get-all-makes.xml')));

      const { records } = await client.getAllMakes();

      expect(typeof records[0]?.makeId).toBe('string');
    });

    it('skips a malformed record and counts it rather than failing the batch', async () => {
      const xml = `<Response><Results>
        <AllVehicleMakes><Make_ID>440</Make_ID><Make_Name>ASTON MARTIN</Make_Name></AllVehicleMakes>
        <AllVehicleMakes><Make_Name>NO ID HERE</Make_Name></AllVehicleMakes>
        <AllVehicleMakes><Make_ID>441</Make_ID><Make_Name>BENTLEY</Make_Name></AllVehicleMakes>
      </Results></Response>`;
      const client = createClient(respondWith(xml));

      const { records, skipped } = await client.getAllMakes();

      expect(records.map((m) => m.makeName)).toEqual(['ASTON MARTIN', 'BENTLEY']);
      expect(skipped).toBe(1);
    });

    it('returns nothing for an empty result set', async () => {
      const client = createClient(respondWith('<Response><Count>0</Count><Results /></Response>'));

      await expect(client.getAllMakes()).resolves.toEqual({ records: [], skipped: 0 });
    });

    it('throws when the envelope no longer matches the upstream contract', async () => {
      const client = createClient(respondWith('<Unexpected><Foo>1</Foo></Unexpected>'));

      await expect(client.getAllMakes()).rejects.toBeInstanceOf(UpstreamBadResponseError);
    });

    it('propagates a parse failure for a truncated body', async () => {
      const client = createClient(respondWith('<Response><Results><AllVehicleMakes>'));

      await expect(client.getAllMakes()).rejects.toBeInstanceOf(XmlParseError);
    });

    it('rejects an HTML gateway error page rather than reporting zero makes', async () => {
      // Well-formed enough to parse, so the envelope check is what catches it.
      // Reporting "0 makes" here would look like a successful empty ingestion.
      const client = createClient(respondWith('<html><body>502 Bad Gateway</body></html>'));

      await expect(client.getAllMakes()).rejects.toBeInstanceOf(UpstreamBadResponseError);
    });
  });

  describe('getVehicleTypesForMake', () => {
    it('maps a multi-type response', async () => {
      const client = createClient(respondWith(loadFixture('vehicle-types-440.xml')));

      const { records } = await client.getVehicleTypesForMake('440');

      expect(records).toEqual([
        { typeId: '2', typeName: 'Passenger Car' },
        { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
      ]);
    });

    it('returns an array when the make has exactly one type', async () => {
      // XML collapses a one-element list to a bare object; most makes hit this.
      const client = createClient(respondWith(loadFixture('vehicle-types-single.xml')));

      const { records } = await client.getVehicleTypesForMake('12858');

      expect(records).toEqual([{ typeId: '6', typeName: 'Trailer' }]);
    });

    it('returns an empty list for an unknown make, which vPIC answers 200 for', async () => {
      const client = createClient(respondWith(loadFixture('vehicle-types-empty.xml')));

      const { records, skipped } = await client.getVehicleTypesForMake('999999999');

      expect(records).toEqual([]);
      expect(skipped).toBe(0);
    });

    it('builds the per-make endpoint', async () => {
      const fetchImpl = respondWith(loadFixture('vehicle-types-440.xml'));
      await createClient(fetchImpl).getVehicleTypesForMake('440');

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://vpic.test/api/vehicles/GetVehicleTypesForMakeId/440?format=xml',
        expect.anything(),
      );
    });

    it('URL-encodes the make id so it cannot alter the path', async () => {
      const fetchImpl = respondWith(loadFixture('vehicle-types-empty.xml'));
      await createClient(fetchImpl).getVehicleTypesForMake('4 4/0');

      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        'https://vpic.test/api/vehicles/GetVehicleTypesForMakeId/4%204%2F0?format=xml',
      );
    });
  });
});
