import type { AnyBulkWriteOperation, Collection, Db } from 'mongodb';
import { PersistenceError } from '../../../shared/errors.js';
import type { Logger } from '../../../shared/logger.js';
import type {
  MakeDocument,
  MakeQuery,
  MakeRepository,
  UpsertResult,
} from '../../../types/persistence.js';
import type { Make } from '../../../types/vehicle.js';
import { chunk } from '../../../utils/chunk.js';
import { buildFilter, toDocument, toDomain } from './make.mapper.js';

export const MAKES_COLLECTION = 'makes';

const BULK_CHUNK_SIZE = 1_000;

const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;


export class MongoMakeRepository implements MakeRepository {
  private readonly collection: Collection<MakeDocument>;
  private readonly logger: Logger;

  constructor(db: Db, logger: Logger) {
    this.collection = db.collection<MakeDocument>(MAKES_COLLECTION);
    this.logger = logger.child({ component: 'make-repository' });
  }

  async ensureIndexes(): Promise<void> {
    await this.guard('ensureIndexes', async () => {
      await this.collection.createIndexes([
        { key: { makeName: 1 }, name: 'makeName_ci', collation: CASE_INSENSITIVE },
        { key: { 'vehicleTypes.typeId': 1 }, name: 'vehicleTypes_typeId' },
        { key: { syncedAt: 1 }, name: 'syncedAt' },
      ]);
      this.logger.debug('Indexes ensured');
    });
  }

  async upsertMany(makes: readonly Make[], syncedAt: Date): Promise<UpsertResult> {
    if (makes.length === 0) return { matched: 0, modified: 0, inserted: 0 };

    return this.guard('upsertMany', async () => {
      let matched = 0;
      let modified = 0;
      let inserted = 0;

      for (const batch of chunk(makes, BULK_CHUNK_SIZE)) {
        const operations: AnyBulkWriteOperation<MakeDocument>[] = batch.map((make) => {
          const { _id, ...fields } = toDocument(make, syncedAt);
          return {
            updateOne: {
              filter: { _id },
              update: { $set: fields },
              upsert: true,
            },
          };
        });

        const result = await this.collection.bulkWrite(operations, { ordered: false });
        matched += result.matchedCount;
        modified += result.modifiedCount;
        inserted += result.upsertedCount;
      }

      this.logger.debug({ matched, modified, inserted }, 'Upserted makes');
      return { matched, modified, inserted };
    });
  }

  async deleteStaleBefore(syncedAt: Date): Promise<number> {
    return this.guard('deleteStaleBefore', async () => {
      const result = await this.collection.deleteMany({ syncedAt: { $lt: syncedAt } });
      if (result.deletedCount > 0) {
        this.logger.info({ deleted: result.deletedCount }, 'Pruned makes missing upstream');
      }
      return result.deletedCount;
    });
  }

  async findMany(query: MakeQuery = {}): Promise<Make[]> {
    return this.guard('findMany', async () => {
      let cursor = this.collection
        .find(buildFilter(query))
        .collation(CASE_INSENSITIVE)
        .sort({ makeName: 1 });

      if (query.offset !== undefined && query.offset > 0) cursor = cursor.skip(query.offset);
      if (query.limit !== undefined) cursor = cursor.limit(query.limit);

      const documents = await cursor.toArray();
      return documents.map(toDomain);
    });
  }

  async findByMakeId(makeId: string): Promise<Make | null> {
    return this.guard('findByMakeId', async () => {
      const document = await this.collection.findOne({ _id: makeId });
      return document ? toDomain(document) : null;
    });
  }

  async count(query: MakeQuery = {}): Promise<number> {
    return this.guard('count', async () =>
      this.collection.countDocuments(buildFilter(query), { collation: CASE_INSENSITIVE }),
    );
  }

  /** Single place where a driver error becomes a PersistenceError. */
  private async guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (cause) {
      throw new PersistenceError(
        `MongoDB ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause, context: { operation, collection: MAKES_COLLECTION } },
      );
    }
  }
}
