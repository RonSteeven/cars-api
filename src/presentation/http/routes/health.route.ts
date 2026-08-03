import { Router } from 'express';

export interface HealthCheckResult {
  readonly ok: boolean;
  readonly detail?: string;
}

export interface HealthCheck {
  readonly name: string;
  check(): Promise<HealthCheckResult>;
}

export interface HealthRouterOptions {
  readonly version: string;
  readonly startedAt: number;
  readonly checks?: readonly HealthCheck[];
}

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
