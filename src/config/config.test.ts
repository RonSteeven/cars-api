import { describe, expect, it } from 'vitest';
import { buildConfig, ConfigurationError } from './index.js';

const baseEnv = { NODE_ENV: 'test' } satisfies NodeJS.ProcessEnv;

describe('buildConfig', () => {
  it('applies documented defaults when only NODE_ENV is provided', () => {
    const config = buildConfig(baseEnv);

    expect(config.env).toBe('test');
    expect(config.http.port).toBe(4000);
    expect(config.http.host).toBe('0.0.0.0');
    expect(config.logging.level).toBe('info');
    expect(config.mongo.dbName).toBe('cars');
    expect(config.nhtsa.baseUrl).toBe('https://vpic.nhtsa.dot.gov/api/vehicles');
    expect(config.graphql.path).toBe('/graphql');
    expect(config.features.ingestOnStartup).toBe(false);
  });

  it('coerces numeric variables from their string representation', () => {
    const config = buildConfig({ ...baseEnv, PORT: '8080', NHTSA_CONCURRENCY: '16' });

    expect(config.http.port).toBe(8080);
    expect(config.nhtsa.concurrency).toBe(16);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
  ])('parses the boolean flag %s as %s', (raw, expected) => {
    expect(buildConfig({ ...baseEnv, INGEST_ON_STARTUP: raw }).features.ingestOnStartup).toBe(
      expected,
    );
  });

  it('strips trailing slashes from the upstream base URL', () => {
    const config = buildConfig({ ...baseEnv, NHTSA_BASE_URL: 'https://example.test/api/' });

    expect(config.nhtsa.baseUrl).toBe('https://example.test/api');
  });

  it('splits a comma separated CORS allow-list and keeps "*" as a wildcard', () => {
    expect(
      buildConfig({ ...baseEnv, CORS_ORIGINS: 'https://a.test, https://b.test' }).http.corsOrigins,
    ).toEqual(['https://a.test', 'https://b.test']);
    expect(buildConfig({ ...baseEnv, CORS_ORIGINS: '*' }).http.corsOrigins).toBe('*');
  });

  it('disables GraphQL introspection by default in production only', () => {
    expect(buildConfig({ NODE_ENV: 'production' }).graphql.introspection).toBe(false);
    expect(buildConfig({ NODE_ENV: 'development' }).graphql.introspection).toBe(true);
  });

  it('honours an explicit introspection override in production', () => {
    const config = buildConfig({ NODE_ENV: 'production', GRAPHQL_INTROSPECTION: 'true' });

    expect(config.graphql.introspection).toBe(true);
  });

  it('rejects a port outside the valid TCP range', () => {
    expect(() => buildConfig({ ...baseEnv, PORT: '70000' })).toThrow(ConfigurationError);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => buildConfig({ NODE_ENV: 'staging' })).toThrow(ConfigurationError);
  });

  it('reports every offending variable in the thrown error', () => {
    try {
      buildConfig({ NODE_ENV: 'test', PORT: 'not-a-number', NHTSA_BASE_URL: 'not-a-url' });
      expect.unreachable('buildConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const issues = (error as ConfigurationError).issues.join('\n');
      expect(issues).toContain('PORT');
      expect(issues).toContain('NHTSA_BASE_URL');
    }
  });
});
