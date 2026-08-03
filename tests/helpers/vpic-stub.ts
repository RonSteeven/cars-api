import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the NHTSA vPIC API.
 *
 * End-to-end tests point `NHTSA_BASE_URL` at this, so the real HTTP client, the
 * real XML parser, the real transformation, real MongoDB and the real GraphQL
 * server all take part — only the upstream is substituted. Mocking `fetch`
 * instead would skip exactly the layers most likely to break: XML parsing,
 * retry behaviour and status handling.
 *
 * It also serves the awkward shapes that make this API interesting: a
 * single-element `Results` (which XML collapses to an object), `<Results />` for
 * an unknown make, malformed documents, and transient 503s.
 */

export interface StubVehicleType {
  readonly typeId: string;
  readonly typeName: string;
}

export interface StubMake {
  readonly makeId: string;
  readonly makeName: string;
  readonly types: readonly StubVehicleType[];
}

const XML_HEADER =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<Response xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
  ' xmlns:xsd="http://www.w3.org/2001/XMLSchema">';

const makesXml = (makes: readonly StubMake[]): string => {
  const rows = makes
    .map(
      (make) =>
        `<AllVehicleMakes><Make_ID>${make.makeId}</Make_ID>` +
        `<Make_Name>${make.makeName}</Make_Name></AllVehicleMakes>`,
    )
    .join('');
  return `${XML_HEADER}<Count>${makes.length}</Count><Message>Response returned successfully</Message><Results>${rows}</Results></Response>`;
};

const typesXml = (makeId: string, types: readonly StubVehicleType[]): string => {
  if (types.length === 0) {
    // Exactly what vPIC returns for a make with no types: a self-closing node.
    return `${XML_HEADER}<Count>0</Count><Message>Response returned successfully</Message><SearchCriteria>Make ID: ${makeId}</SearchCriteria><Results /></Response>`;
  }
  const rows = types
    .map(
      (type) =>
        `<VehicleTypesForMakeIds><VehicleTypeId>${type.typeId}</VehicleTypeId>` +
        `<VehicleTypeName>${type.typeName}</VehicleTypeName></VehicleTypesForMakeIds>`,
    )
    .join('');
  return `${XML_HEADER}<Count>${types.length}</Count><Message>Response returned successfully</Message><SearchCriteria>Make ID: ${makeId}</SearchCriteria><Results>${rows}</Results></Response>`;
};

export interface VpicStub {
  readonly baseUrl: string;
  /** Replaces the catalogue the stub serves, simulating an upstream change. */
  setMakes(makes: readonly StubMake[]): void;
  /** Fail this make's type request with 503 for the next `times` attempts. */
  failTemporarily(makeId: string, times: number): void;
  /** Fail this make's type request with 503 forever, exhausting all retries. */
  failPermanently(makeId: string): void;
  /** Return truncated XML for this make's type request. */
  serveMalformed(makeId: string): void;
  /** Clears every injected failure. */
  resetFailures(): void;
  requestCount(path?: string): number;
  close(): Promise<void>;
}

export const startVpicStub = async (initial: readonly StubMake[] = []): Promise<VpicStub> => {
  let makes = [...initial];
  const temporaryFailures = new Map<string, number>();
  const permanentFailures = new Set<string>();
  const malformed = new Set<string>();
  const requests: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push(url.pathname);

    if (url.pathname.endsWith('/getallmakes')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(makesXml(makes));
      return;
    }

    const match = /\/GetVehicleTypesForMakeId\/([^/?]+)$/.exec(url.pathname);
    if (match) {
      const makeId = decodeURIComponent(match[1] as string);

      if (permanentFailures.has(makeId)) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('Service Unavailable');
        return;
      }

      const remaining = temporaryFailures.get(makeId) ?? 0;
      if (remaining > 0) {
        temporaryFailures.set(makeId, remaining - 1);
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('Service Unavailable');
        return;
      }

      if (malformed.has(makeId)) {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(`${XML_HEADER}<Count>1</Count><Results><VehicleTypesForMakeIds>`);
        return;
      }

      const make = makes.find((candidate) => candidate.makeId === makeId);
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(typesXml(makeId, make?.types ?? []));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/api/vehicles`,
    setMakes: (next) => {
      makes = [...next];
    },
    failTemporarily: (makeId, times) => temporaryFailures.set(makeId, times),
    failPermanently: (makeId) => permanentFailures.add(makeId),
    serveMalformed: (makeId) => malformed.add(makeId),
    resetFailures: () => {
      temporaryFailures.clear();
      permanentFailures.clear();
      malformed.clear();
    },
    requestCount: (path) =>
      path === undefined ? requests.length : requests.filter((p) => p.includes(path)).length,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};
