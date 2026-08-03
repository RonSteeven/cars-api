/**
 * Error taxonomy types.
 *
 * `code` is machine readable and stable (it doubles as the GraphQL error
 * extension code), `status` is the HTTP status to surface, and `isOperational`
 * separates expected failures from genuine bugs — which is what decides the log
 * level and whether the message is safe to return to a caller.
 */

export type ErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_BAD_RESPONSE'
  | 'XML_PARSE_ERROR'
  | 'TRANSFORMATION_ERROR'
  | 'PERSISTENCE_ERROR'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

export interface AppErrorOptions {
  readonly cause?: unknown;
  readonly status?: number;
  readonly isOperational?: boolean;
  readonly context?: Readonly<Record<string, unknown>>;
}
