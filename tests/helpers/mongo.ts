import { MongoClient, type Db } from 'mongodb';

/**
 * Test harness for MongoDB-backed suites.
 *
 * Integration tests need a real server (an in-memory fake would not exercise
 * collations, multikey indexes or bulkWrite semantics — precisely the parts most
 * likely to be wrong). When no server is reachable the suite is skipped rather
 * than failed, so `npm test` still passes on a machine without Docker while CI,
 * which does run one, gets full coverage.
 */

const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017';

export const isMongoAvailable = async (timeoutMs = 1_500): Promise<boolean> => {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: timeoutMs,
    connectTimeoutMS: timeoutMs,
  });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
};

export interface TestDatabase {
  readonly db: Db;
  close(): Promise<void>;
}

/**
 * Connects to a uniquely named database so parallel suites cannot collide, and
 * drops it on close.
 */
export const createTestDatabase = async (name: string): Promise<TestDatabase> => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const db = client.db(`cars_test_${name}`);

  return {
    db,
    close: async () => {
      await db.dropDatabase();
      await client.close();
    },
  };
};
