import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { buildConfig } from '../../src/config/index.js';
import { createApp } from '../../src/presentation/http/app.js';

const logger = pino({ level: 'silent' });
const config = buildConfig({ NODE_ENV: 'test' });

const app = (overrides: Partial<Parameters<typeof createApp>[0]> = {}) =>
  createApp({ config, logger, version: '0.0.0-test', ...overrides });

describe('HTTP application', () => {
  it('reports liveness without touching dependencies', async () => {
    const response = await request(app()).get('/health/live').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', version: '0.0.0-test' });
  });

  it('reports readiness as ok when every registered check passes', async () => {
    const response = await request(
      app({ healthChecks: [{ name: 'mongo', check: () => Promise.resolve({ ok: true }) }] }),
    )
      .get('/health/ready')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      checks: [{ name: 'mongo', ok: true }],
    });
  });

  it('answers 503 when a readiness check fails', async () => {
    const response = await request(
      app({
        healthChecks: [
          { name: 'mongo', check: () => Promise.resolve({ ok: false, detail: 'not connected' }) },
        ],
      }),
    )
      .get('/health/ready')
      .expect(503);

    expect(response.body.status).toBe('degraded');
    expect(response.body.checks[0].detail).toBe('not connected');
  });

  it('treats a throwing readiness check as a failure rather than a 500', async () => {
    const response = await request(
      app({
        healthChecks: [
          {
            name: 'mongo',
            check: () => Promise.reject(new Error('connection refused')),
          },
        ],
      }),
    )
      .get('/health/ready')
      .expect(503);

    expect(response.body.checks[0]).toMatchObject({ ok: false, detail: 'connection refused' });
  });

  it('describes the service at the root path', async () => {
    const response = await request(app()).get('/').expect(200);

    expect(response.body).toMatchObject({ service: 'cars-api' });
    expect(response.body.endpoints.graphql).toBe('/graphql');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app()).get('/does-not-exist').expect(404);

    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.body.error.message).toContain('/does-not-exist');
  });

  it('echoes a correlation id on every response', async () => {
    const response = await request(app()).get('/').set('x-request-id', 'abc-123').expect(200);

    expect(response.headers['x-request-id']).toBe('abc-123');
  });
});
