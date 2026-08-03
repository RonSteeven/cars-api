import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { HttpClient } from './http-client.js';
import type { FetchLike } from '@/types/http.js';
import { UpstreamBadResponseError, UpstreamUnavailableError } from '@/shared/errors.js';

const logger = pino({ level: 'silent' });

/** Builds a client whose network and clock are both fake, so tests are instant. */
const createClient = (fetchImpl: FetchLike, overrides: { maxRetries?: number } = {}) => {
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  const client = new HttpClient({
    baseUrl: 'https://vpic.test/api/vehicles',
    timeoutMs: 1_000,
    maxRetries: overrides.maxRetries ?? 2,
    retryBaseDelayMs: 100,
    logger,
    fetch: fetchImpl,
    sleep,
  });
  return { client, sleep };
};

const ok = (body: string): Response => new Response(body, { status: 200 });
const status = (code: number, headers: Record<string, string> = {}): Response =>
  new Response('error', { status: code, headers });

/** An abort/timeout rejection shaped the way AbortSignal.timeout produces one. */
const timeoutError = (): Error =>
  Object.assign(new Error('The operation was aborted'), {
    name: 'TimeoutError',
  });

describe('HttpClient', () => {
  describe('happy path', () => {
    it('returns the response body', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(ok('<Response />'));
      const { client } = createClient(fetchImpl);

      await expect(client.getText('/getallmakes')).resolves.toBe('<Response />');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('joins the base URL and path, with or without a leading slash', async () => {
      // A Response body can only be read once, so each call needs a fresh one.
      const fetchImpl = vi.fn<FetchLike>().mockImplementation(() => Promise.resolve(ok('x')));
      const { client } = createClient(fetchImpl);

      await client.getText('/getallmakes?format=XML');
      await client.getText('getallmakes?format=XML');

      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        'https://vpic.test/api/vehicles/getallmakes?format=XML',
      );
      expect(fetchImpl.mock.calls[1]?.[0]).toBe(
        'https://vpic.test/api/vehicles/getallmakes?format=XML',
      );
    });

    it('sends an XML accept header and identifies the client', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(ok('x'));
      const { client } = createClient(fetchImpl);

      await client.getText('/makes');

      const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers.accept).toContain('application/xml');
      expect(headers['user-agent']).toBe('cars-api');
    });

    it('bounds every request with an abort signal', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(ok('x'));
      const { client } = createClient(fetchImpl);

      await client.getText('/makes');

      expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('retrying transient failures', () => {
    it('retries a 500 and returns the eventual success', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(status(500))
        .mockResolvedValueOnce(ok('<Response />'));
      const { client, sleep } = createClient(fetchImpl);

      await expect(client.getText('/makes')).resolves.toBe('<Response />');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('retries a 429', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(status(429))
        .mockResolvedValueOnce(ok('done'));
      const { client } = createClient(fetchImpl);

      await expect(client.getText('/makes')).resolves.toBe('done');
    });

    it('retries a network error', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(ok('done'));
      const { client } = createClient(fetchImpl);

      await expect(client.getText('/makes')).resolves.toBe('done');
    });

    it('backs off for longer on each successive attempt', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(status(503));
      const { client, sleep } = createClient(fetchImpl, { maxRetries: 3 });

      await expect(client.getText('/makes')).rejects.toThrow(UpstreamBadResponseError);

      const delays = sleep.mock.calls.map(([ms]) => ms);
      expect(delays).toHaveLength(3);
      // Full jitter keeps each delay in [half, full] of the exponential term,
      // so growth is asserted on those bounds rather than on exact values.
      expect(delays[0]).toBeGreaterThanOrEqual(50);
      expect(delays[0]).toBeLessThanOrEqual(100);
      expect(delays[2]).toBeGreaterThanOrEqual(200);
      expect(delays[2]).toBeLessThanOrEqual(400);
    });

    it('honours a Retry-After header in seconds', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(status(429, { 'retry-after': '0.5' }))
        .mockResolvedValueOnce(ok('done'));
      const { client, sleep } = createClient(fetchImpl);

      await client.getText('/makes');

      expect(sleep).toHaveBeenCalledWith(500);
    });

    it('ignores an implausible Retry-After and falls back to its own backoff', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(status(429, { 'retry-after': '86400' }))
        .mockResolvedValueOnce(ok('done'));
      const { client, sleep } = createClient(fetchImpl);

      await client.getText('/makes');

      expect(sleep.mock.calls[0]?.[0]).toBeLessThanOrEqual(100);
    });

    it('gives up after maxRetries and surfaces a typed error', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new TypeError('fetch failed'));
      const { client } = createClient(fetchImpl, { maxRetries: 2 });

      await expect(client.getText('/makes')).rejects.toBeInstanceOf(UpstreamUnavailableError);
      expect(fetchImpl).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    });

    it('performs exactly one attempt when retries are disabled', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(status(500));
      const { client, sleep } = createClient(fetchImpl, { maxRetries: 0 });

      await expect(client.getText('/makes')).rejects.toThrow(UpstreamBadResponseError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });

  describe('permanent failures', () => {
    it('does not retry a 404', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(status(404));
      const { client, sleep } = createClient(fetchImpl);

      await expect(client.getText('/nope')).rejects.toBeInstanceOf(UpstreamBadResponseError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('does not retry a 400', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(status(400));
      const { client } = createClient(fetchImpl);

      await expect(client.getText('/bad')).rejects.toThrow(UpstreamBadResponseError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('records the upstream status on the error for triage', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(status(404));
      const { client } = createClient(fetchImpl);

      await expect(client.getText('/nope')).rejects.toMatchObject({
        code: 'UPSTREAM_BAD_RESPONSE',
        status: 502,
        context: { status: 404 },
      });
    });
  });

  describe('timeouts', () => {
    it('reports a timeout as an unavailable upstream', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(timeoutError());
      const { client } = createClient(fetchImpl, { maxRetries: 0 });

      await expect(client.getText('/slow')).rejects.toMatchObject({
        code: 'UPSTREAM_UNAVAILABLE',
      });
    });

    it('names the elapsed budget in the message', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(timeoutError());
      const { client } = createClient(fetchImpl, { maxRetries: 0 });

      await expect(client.getText('/slow')).rejects.toThrow(/timed out after 1000ms/);
    });

    it('retries a timeout like any other transient failure', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockRejectedValueOnce(timeoutError())
        .mockResolvedValueOnce(ok('done'));
      const { client } = createClient(fetchImpl);

      await expect(client.getText('/slow')).resolves.toBe('done');
    });
  });

  it('retries a body that fails mid-stream', async () => {
    const brokenBody = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.reject(new Error('socket hang up')),
    } as unknown as Response;

    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(brokenBody)
      .mockResolvedValueOnce(ok('done'));
    const { client } = createClient(fetchImpl);

    await expect(client.getText('/makes')).resolves.toBe('done');
  });
});
