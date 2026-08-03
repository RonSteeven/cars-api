import { UpstreamBadResponseError, UpstreamUnavailableError } from '@/shared/errors.js';
import type { Logger } from '@/shared/logger.js';
import type { FetchLike, HttpClientOptions, SleepLike } from '@/types/http.js';
import { backoffDelay, isRetryableStatus, parseRetryAfter, sleep } from '@/utils/http.js';

/**
 * Minimal resilient HTTP client for outbound calls.
 *
 * It exists because ingestion issues tens of thousands of requests against a
 * public API we do not control: a single transient blip must not fail a whole
 * run, and a hung connection must not pin a worker forever.
 *
 * Guarantees:
 *  - every request is bounded by `timeoutMs` (AbortSignal, so the socket is
 *    actually torn down, not just abandoned),
 *  - transient failures (network errors, timeouts, 429, 5xx) are retried up to
 *    `maxRetries` times with exponential backoff plus full jitter,
 *  - permanent failures (4xx) fail fast,
 *  - every failure surfaces as a typed AppError, never a raw fetch rejection.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;
  private readonly logger: Logger;

  constructor(private readonly options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? sleep;
    this.logger = options.logger.child({ component: 'http-client' });
  }

  /**
   * Performs a GET and returns the raw response body.
   *
   * @throws {UpstreamUnavailableError} the host could not be reached in time.
   * @throws {UpstreamBadResponseError} the host answered with an unusable status.
   */
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

        const delay = error.retryAfterMs ?? backoffDelay(attempt, this.options.retryBaseDelayMs);
        this.logger.warn(
          { url, attempt, maxAttempts, delayMs: delay, reason: error.message },
          'Upstream request failed, retrying',
        );
        await this.sleep(delay);
      }
    }

    // Unreachable: the loop either returns or throws. Present so the compiler and
    // any future refactor both have a defined outcome.
    throw lastError ?? new UpstreamUnavailableError(`Request to ${url} failed`);
  }

  /** One attempt: perform the request and classify the outcome. */
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
}

/**
 * Internal control-flow wrapper marking a failure as worth another attempt. It
 * never escapes {@link HttpClient}: the retry loop rethrows the wrapped
 * `AppError` once attempts are exhausted.
 */
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
