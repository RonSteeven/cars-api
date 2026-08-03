/**
 * Global test setup.
 *
 * Tests must never inherit a developer's local `.env` or point at a real
 * database, so the environment is pinned here before any module is imported.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.LOG_PRETTY = 'false';
process.env.MONGODB_URI ??= 'mongodb://localhost:27017';
process.env.MONGODB_DB_NAME ??= 'cars_test';
