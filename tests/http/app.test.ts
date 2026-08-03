import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { buildConfig } from '@/config/index.js';
import { createApp } from '@/presentation/http/app.js';

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

  describe('security headers', () => {
    const appFor = (env: Record<string, string>) =>
      createApp({ config: buildConfig(env), logger, version: '0.0.0-test' });

    it('sets Helmet headers and hides the framework', async () => {
      const response = await request(app()).get('/').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('does not enforce a CSP outside production, where it only breaks tooling', async () => {
      const response = await request(appFor({ NODE_ENV: 'development' }))
        .get('/')
        .expect(200);

      expect(response.headers['content-security-policy']).toBeUndefined();
    });

    it('enforces a strict CSP in production', async () => {
      const response = await request(
        appFor({ NODE_ENV: 'production', GRAPHQL_INTROSPECTION: 'false' }),
      )
        .get('/')
        .expect(200);

      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['content-security-policy']).not.toContain('apollographql.com');
    });

    it("allows Apollo's CDN in production only when the landing page is served", async () => {
      // Enabling introspection in production serves Apollo's landing page, which
      // loads its own assets; a default CSP would block them and the page would
      // render broken.
      const response = await request(
        appFor({ NODE_ENV: 'production', GRAPHQL_INTROSPECTION: 'true' }),
      )
        .get('/')
        .expect(200);

      const csp = response.headers['content-security-policy'] ?? '';
      expect(csp).toContain('apollo-server-landing-page.cdn.apollographql.com');
      expect(csp).toContain("default-src 'self'");
    });
  });

  it('echoes a correlation id on every response', async () => {
    const response = await request(app()).get('/').set('x-request-id', 'abc-123').expect(200);

    expect(response.headers['x-request-id']).toBe('abc-123');
  });
});
