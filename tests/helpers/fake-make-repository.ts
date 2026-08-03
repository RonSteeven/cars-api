import type { MakeQuery, MakeRepository, UpsertResult } from '../../src/types/persistence.js';
import type { Make, VehicleType } from '../../src/types/vehicle.js';
import { compareIds } from '../../src/utils/sort.js';
import { escapeRegExp } from '../../src/utils/text.js';

/**
 * In-memory {@link MakeRepository}.
 *
 * Mirrors the MongoDB implementation's observable behaviour — case-insensitive
 * literal search, name ordering, limit/offset, embedded-type filtering — so the
 * pipeline and GraphQL layers can be tested with no database at all. The
 * MongoDB implementation itself is covered separately by its own integration
 * suite against a real server.
 *
 * `upsertCalls` and `pruneCalls` are exposed because the ingestion rules are
 * about *what gets written*, which is only observable at the call boundary.
 */
export class FakeMakeRepository implements MakeRepository {
  readonly stored = new Map<string, { make: Make; syncedAt: Date }>();
  upsertCalls: { makes: readonly Make[]; syncedAt: Date }[] = [];
  pruneCalls: Date[] = [];

  constructor(seed: readonly Make[] = [], syncedAt = new Date(0)) {
    for (const make of seed) this.stored.set(make.makeId, { make, syncedAt });
  }

  ensureIndexes(): Promise<void> {
    return Promise.resolve();
  }

  upsertMany(makes: readonly Make[], syncedAt: Date): Promise<UpsertResult> {
    this.upsertCalls.push({ makes, syncedAt });
    let inserted = 0;
    let matched = 0;
    for (const make of makes) {
      if (this.stored.has(make.makeId)) matched += 1;
      else inserted += 1;
      this.stored.set(make.makeId, { make, syncedAt });
    }
    return Promise.resolve({ matched, modified: matched, inserted });
  }

  deleteStaleBefore(syncedAt: Date): Promise<number> {
    this.pruneCalls.push(syncedAt);
    let deleted = 0;
    for (const [id, entry] of this.stored) {
      if (entry.syncedAt < syncedAt) {
        this.stored.delete(id);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  findMany(query: MakeQuery = {}): Promise<Make[]> {
    const matches = this.match(query).sort((a, b) =>
      a.makeName.localeCompare(b.makeName, 'en', { sensitivity: 'base' }),
    );
    const offset = query.offset ?? 0;
    const end = query.limit === undefined ? undefined : offset + query.limit;
    return Promise.resolve(matches.slice(offset, end));
  }

  findByMakeId(makeId: string): Promise<Make | null> {
    return Promise.resolve(this.stored.get(makeId)?.make ?? null);
  }

  count(query: MakeQuery = {}): Promise<number> {
    return Promise.resolve(this.match(query).length);
  }

  listVehicleTypes(): Promise<VehicleType[]> {
    const byId = new Map<string, VehicleType>();
    for (const { make } of this.stored.values()) {
      for (const type of make.vehicleTypes) {
        if (!byId.has(type.typeId)) byId.set(type.typeId, type);
      }
    }
    return Promise.resolve([...byId.values()].sort((a, b) => compareIds(a.typeId, b.typeId)));
  }

  private match(query: MakeQuery): Make[] {
    const search = query.search?.trim();
    // Escaped exactly like the real implementation, so a test that relies on
    // literal matching fails here too if that guarantee ever regresses.
    const pattern = search ? new RegExp(escapeRegExp(search), 'i') : undefined;

    return [...this.stored.values()]
      .map((entry) => entry.make)
      .filter((make) => {
        if (pattern && !pattern.test(make.makeName)) return false;
        if (query.vehicleTypeId) {
          return make.vehicleTypes.some((type) => type.typeId === query.vehicleTypeId);
        }
        return true;
      });
  }
}
