import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError, toError } from '../../../shared/errors.js';
import type { Logger } from '../../../shared/logger.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

/** Terminal 404 handler: anything that reached here matched no route. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
};

export const createErrorHandler = (options: {
  logger: Logger;
  exposeMessages: boolean;
}): ErrorRequestHandler => {
  return (err, req, res, _next) => {
    const error = toError(err);
    const appError = error instanceof AppError ? error : undefined;
    const log = req.log ?? options.logger;

    if (appError?.isOperational) {
      log.warn({ err: appError.toLogObject() }, `Request failed: ${error.message}`);
    } else {
      log.error({ err: error }, `Unhandled error: ${error.message}`);
    }

    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    // A bug's message may leak internals, so it is only echoed where we already
    // expose stack traces; an operational error's message is written for callers.
    const status = appError?.status ?? 500;
    const expose = options.exposeMessages || appError?.isOperational === true;

    const body: ErrorBody = {
      error: {
        code: appError?.code ?? 'INTERNAL_ERROR',
        message: expose ? error.message : 'Internal server error',
      },
    };

    if (typeof req.id === 'string') {
      body.error.requestId = req.id;
    }

    res.status(status).json(body);
  };
};
