import { MongoClient, type Db } from 'mongodb';
import { PersistenceError } from '@/shared/errors.js';
import type { AppConfig } from '@/types/config.js';
import type { HealthCheck, HealthCheckResult } from '@/types/health.js';
import type { Logger } from '@/shared/logger.js';

export class MongoConnection {
  private readonly client: MongoClient;
  private readonly logger: Logger;
  private connected = false;

  constructor(
    private readonly config: AppConfig,
    logger: Logger,
  ) {
    this.logger = logger.child({ component: 'mongo' });
    this.client = new MongoClient(config.mongo.uri, {
      connectTimeoutMS: config.mongo.connectTimeoutMs,
      serverSelectionTimeoutMS: config.mongo.connectTimeoutMs,
      socketTimeoutMS: config.mongo.connectTimeoutMs * 3,
      retryWrites: true,
      retryReads: true,
    });
  }

  async connect(): Promise<Db> {
    try {
      await this.client.connect();
      await this.client.db(this.config.mongo.dbName).command({ ping: 1 });
      this.connected = true;
      this.logger.info({ database: this.config.mongo.dbName }, 'Connected to MongoDB');
      return this.db();
    } catch (cause) {
      throw new PersistenceError(
        `Failed to connect to MongoDB: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause, context: { database: this.config.mongo.dbName } },
      );
    }
  }

  db(): Db {
    return this.client.db(this.config.mongo.dbName);
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.client.close();
    this.logger.info('MongoDB connection closed');
  }

  /** Readiness probe: a real command, so a broken connection is actually noticed. */
  healthCheck(): HealthCheck {
    return {
      name: 'mongodb',
      check: async (): Promise<HealthCheckResult> => {
        try {
          await this.db().command({ ping: 1 });
          return { ok: true };
        } catch (cause) {
          return {
            ok: false,
            detail: cause instanceof Error ? cause.message : String(cause),
          };
        }
      },
    };
  }
}
