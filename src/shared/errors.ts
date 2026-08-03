import type { AppErrorOptions, ErrorCode } from '../types/error.js';

/**
 * Error taxonomy for the service.
 *
 * Anything that does NOT extend AppError is treated as an unexpected exception:
 * logged in full, reported to the caller as a generic internal error.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly isOperational: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = options.status ?? 500;
    this.isOperational = options.isOperational ?? true;
    this.context = options.context ?? {};
    Error.captureStackTrace?.(this, new.target);
  }

  /** Log-friendly, JSON-serialisable projection of the error. */
  toLogObject(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      isOperational: this.isOperational,
      ...this.context,
    };
  }
}

// The upstream API could not be reached at all: DNS, connection reset, timeout.
export class UpstreamUnavailableError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('UPSTREAM_UNAVAILABLE', message, { status: 503, ...options });
  }
}

// The upstream API answered, but with a status or payload we cannot use.
export class UpstreamBadResponseError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('UPSTREAM_BAD_RESPONSE', message, { status: 502, ...options });
  }
}

// The response body was not well-formed XML, or lacked the expected envelope.
export class XmlParseError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('XML_PARSE_ERROR', message, { status: 502, ...options });
  }
}

// Parsed XML did not map onto the domain model (missing ids, wrong shape, ...)
export class TransformationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('TRANSFORMATION_ERROR', message, { status: 422, ...options });
  }
}

// A read or write against the datastore failed.
export class PersistenceError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('PERSISTENCE_ERROR', message, { status: 503, ...options });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('NOT_FOUND', message, { status: 404, ...options });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('BAD_REQUEST', message, { status: 400, ...options });
  }
}
