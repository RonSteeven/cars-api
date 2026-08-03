import { Router } from 'express';
import type { HealthRouterOptions } from '@/types/health.js';

/**
 * Two distinct probes, because orchestrators treat them differently:
 *  - `GET /health/live`  the process is up. Never touches dependencies, so a
 *                        flaky database cannot trigger a pod restart loop.
 *  - `GET /health/ready` the process can serve traffic. Runs every registered
 *                        check and answers 503 if any of them is down.
 */
export const createHealthRouter = (options: HealthRouterOptions): Router => {
  const router = Router();
  const checks = options.checks ?? [];

  router.get('/live', (_req, res) => {
    res.json({
      status: 'ok',
      version: options.version,
      uptimeSeconds: Math.round((Date.now() - options.startedAt) / 1000),
    });
  });

  router.get('/ready', async (_req, res) => {
    const results = await Promise.all(
      checks.map(async (dependency) => {
        try {
          return { name: dependency.name, ...(await dependency.check()) };
        } catch (error) {
          return {
            name: dependency.name,
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    const ok = results.every((result) => result.ok);
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      version: options.version,
      checks: results,
    });
  });

  return router;
};
