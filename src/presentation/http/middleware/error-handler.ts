import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError } from '../../../shared/errors.js';
import { isAppError, toError } from '../../../utils/error.js';
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
    const error = isAppError(err) ? err : toError(err);
    const log = req.log ?? options.logger;

    if (error instanceof AppError && error.isOperational) {
      log.warn({ err: error.toLogObject() }, `Request failed: ${error.message}`);
    } else {
      log.error({ err: error }, `Unhandled error: ${error.message}`);
    }

    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    const status = error instanceof AppError ? error.status : 500;
    const expose = options.exposeMessages || (error instanceof AppError && error.isOperational);

    const body: ErrorBody = {
      error: {
        code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
        message: expose ? error.message : 'Internal server error',
      },
    };

    if (typeof req.id === 'string') {
      body.error.requestId = req.id;
    }

    res.status(status).json(body);
  };
};
