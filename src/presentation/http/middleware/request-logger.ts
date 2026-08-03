import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { RequestHandler } from 'express';
import type { Logger } from '../../../shared/logger.js';

/**
 * Attaches a child logger to every request (`req.log`) and emits one structured
 * completion line per request.
 *
 * Correlation: an inbound `x-request-id` is honoured when present, otherwise a
 * UUID is generated, and the value is echoed back on the response so a client
 * can quote it in a bug report.
 */
export const createRequestLogger = (logger: Logger): RequestHandler =>
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const header = req.headers['x-request-id'];
      const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Health checks are noisy and uninteresting unless they fail.
    autoLogging: {
      ignore: (req) => req.url === '/health/live' || req.url === '/health/ready',
    },
    customLogLevel: (_req, res, err) => {
      if (err) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method ?? 'GET'} ${req.url ?? ''} ${res.statusCode}`,
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
