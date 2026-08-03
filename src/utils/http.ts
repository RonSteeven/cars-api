import type { SleepLike } from '@/types/http.js';

export const sleep: SleepLike = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 429 and 5xx are transient by definition; 4xx means we asked wrong, so retrying is pointless. */
export const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * `Retry-After` may be seconds or an HTTP date. Anything unparseable, negative or
 * absurdly far in the future is ignored in favour of our own backoff, so a
 * misbehaving upstream cannot stall ingestion.
 */
export const parseRetryAfter = (header: string | null, maxMs: number): number | undefined => {
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

/** Exponential backoff with full jitter, capped so a long tail cannot stall a run. */
export const backoffDelay = (attempt: number, baseDelayMs: number, capMs = 30_000): number => {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, capMs);
  return Math.round(capped / 2 + Math.random() * (capped / 2));
};
