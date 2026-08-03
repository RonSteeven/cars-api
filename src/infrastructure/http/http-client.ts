import { UpstreamBadResponseError, UpstreamUnavailableError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number) => Promise<void>;

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly logger: Logger;
  readonly fetch?: FetchLike;
  readonly sleep?: SleepLike;
  readonly userAgent?: string;
}

const defaultSleep: SleepLike = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 429 and 5xx are transient by definition; 4xx means we asked wrong, so retrying is pointless. */
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

const parseRetryAfter = (header: string | null, maxMs: number): number | undefined => {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    const ms = seconds * 1000;
    return ms >= 0 && ms <= maxMs ? ms : undefined;
  }

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;

  const ms = date - Date.now();
  return ms >= 0 && ms <= maxMs ? ms : undefined;
};

export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;
  private readonly logger: Logger;

  constructor(private readonly options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger.child({ component: 'http-client' });
  }

  async getText(path: string, init: RequestInit = {}): Promise<string> {
    const url = path.startsWith('http')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const maxAttempts = this.options.maxRetries + 1;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.attempt(url, init, attempt, maxAttempts);
      } catch (error) {
        lastError = error as Error;

        const retryable = error instanceof RetryableError;
        if (!retryable || attempt === maxAttempts) {
          throw retryable ? error.cause : error;
        }

        const delay = error.retryAfterMs ?? this.backoffDelay(attempt);
        this.logger.warn(
          { url, attempt, maxAttempts, delayMs: delay, reason: error.message },
          'Upstream request failed, retrying',
        );
        await this.sleep(delay);
      }
    }

    throw lastError ?? new UpstreamUnavailableError(`Request to ${url} failed`);
  }

  private async attempt(
    url: string,
    init: RequestInit,
    attempt: number,
    maxAttempts: number,
  ): Promise<string> {
    const context = { url, attempt, maxAttempts };
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.options.timeoutMs),
        headers: {
          accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
          'user-agent': this.options.userAgent ?? 'cars-api',
          ...init.headers,
        },
      });
    } catch (cause) {
      // fetch rejects for DNS failures, connection resets and aborts. All of
      // those are worth another try.
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      throw new RetryableError(
        timedOut ? `Request timed out after ${this.options.timeoutMs}ms` : 'Network request failed',
        new UpstreamUnavailableError(
          timedOut
            ? `Upstream request to ${url} timed out after ${this.options.timeoutMs}ms`
            : `Upstream request to ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause, context },
        ),
      );
    }

    if (!response.ok) {
      const error = new UpstreamBadResponseError(
        `Upstream responded ${response.status} for ${url}`,
        { context: { ...context, status: response.status } },
      );

      if (isRetryableStatus(response.status)) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get('retry-after'),
          this.options.timeoutMs,
        );
        throw new RetryableError(`HTTP ${response.status}`, error, retryAfterMs);
      }
      throw error;
    }

    try {
      return await response.text();
    } catch (cause) {
      // The status was fine but the body never fully arrived: a dropped
      // connection mid-stream. Worth retrying.
      throw new RetryableError(
        'Failed to read response body',
        new UpstreamUnavailableError(`Failed to read response body from ${url}`, {
          cause,
          context,
        }),
      );
    }
  }

  private backoffDelay(attempt: number): number {
    const exponential = this.options.retryBaseDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(exponential, 30_000);
    return Math.round(capped / 2 + Math.random() * (capped / 2));
  }
}

class RetryableError extends Error {
  constructor(
    message: string,
    override readonly cause: Error,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}
