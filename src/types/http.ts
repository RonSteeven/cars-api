import type { Server } from 'node:http';
import type { Logger } from 'pino';

/** Transport-level types: the outbound HTTP client and the inbound server handle. */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number) => Promise<void>;

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly logger: Logger;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetch?: FetchLike;
  /** Injectable for tests, so retry behaviour can be asserted without real delays. */
  readonly sleep?: SleepLike;
  readonly userAgent?: string;
}

export interface HttpServerHandle {
  readonly server: Server;
  readonly address: string;
  /** Stops accepting connections and waits for in-flight requests to finish. */
  close(): Promise<void>;
}
