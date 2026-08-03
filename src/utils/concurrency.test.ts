import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

const tick = (ms = 0): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('mapWithConcurrency', () => {
  it('maps every item', async () => {
    const outcome = await mapWithConcurrency([1, 2, 3], 2, (n) => Promise.resolve(n * 2));

    expect(outcome.results.map((r) => r.value)).toEqual([2, 4, 6]);
    expect(outcome.failures).toEqual([]);
  });

  it('returns results in input order, not completion order', async () => {
    // The first item finishes last; output order must not depend on timing.
    const outcome = await mapWithConcurrency([30, 0, 0], 3, async (ms, index) => {
      await tick(ms);
      return index;
    });

    expect(outcome.results.map((r) => r.value)).toEqual([0, 1, 2]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(1);
        active -= 1;
      },
    );

    expect(peak).toBe(4);
  });

  it('uses fewer workers than the limit when there are fewer items', async () => {
    let peak = 0;
    let active = 0;

    await mapWithConcurrency([1, 2], 10, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(1);
      active -= 1;
    });

    expect(peak).toBe(2);
  });

  it('processes more items than the limit', async () => {
    const outcome = await mapWithConcurrency(
      Array.from({ length: 100 }, (_, i) => i),
      8,
      (n) => Promise.resolve(n),
    );

    expect(outcome.results).toHaveLength(100);
  });

  it('handles an empty input', async () => {
    const worker = vi.fn();

    const outcome = await mapWithConcurrency([], 4, worker);

    expect(outcome).toEqual({ results: [], failures: [], aborted: false });
    expect(worker).not.toHaveBeenCalled();
  });

  describe('failure isolation', () => {
    it('collects a failure instead of rejecting', async () => {
      const outcome = await mapWithConcurrency([1, 2, 3], 2, (n) =>
        n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n),
      );

      expect(outcome.results.map((r) => r.value)).toEqual([1, 3]);
      expect(outcome.failures).toHaveLength(1);
      expect(outcome.failures[0]?.item).toBe(2);
      expect(outcome.failures[0]?.error.message).toBe('boom');
    });

    it('keeps processing every remaining item after a failure', async () => {
      const outcome = await mapWithConcurrency([1, 2, 3, 4, 5], 2, (n) =>
        n % 2 === 0 ? Promise.reject(new Error('even')) : Promise.resolve(n),
      );

      expect(outcome.results).toHaveLength(3);
      expect(outcome.failures).toHaveLength(2);
    });

    it('records which item failed, by index', async () => {
      const outcome = await mapWithConcurrency(['a', 'b'], 1, (letter) =>
        Promise.reject(new Error(letter)),
      );

      expect(outcome.failures.map((f) => f.index)).toEqual([0, 1]);
    });

    it('normalises a non-Error rejection', async () => {
      // Rejecting with a bare string is exactly the case under test: a worker
      // may throw anything, and the outcome must still carry a real Error.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const outcome = await mapWithConcurrency([1], 1, () => Promise.reject('just a string'));

      expect(outcome.failures[0]?.error).toBeInstanceOf(Error);
      expect(outcome.failures[0]?.error.message).toBe('just a string');
    });
  });

  describe('abortion', () => {
    it('stops early and reports it', async () => {
      const controller = new AbortController();
      const worker = vi.fn().mockImplementation(async () => {
        await tick(1);
      });

      const promise = mapWithConcurrency(
        Array.from({ length: 100 }, (_, i) => i),
        2,
        worker,
        { signal: controller.signal },
      );
      await tick(5);
      controller.abort();
      const outcome = await promise;

      expect(outcome.aborted).toBe(true);
      expect(worker.mock.calls.length).toBeLessThan(100);
    });

    it('does nothing at all when already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const worker = vi.fn();

      const outcome = await mapWithConcurrency([1, 2, 3], 2, worker, {
        signal: controller.signal,
      });

      expect(worker).not.toHaveBeenCalled();
      expect(outcome.aborted).toBe(true);
    });

    it('is not marked aborted on a clean run', async () => {
      const controller = new AbortController();

      const outcome = await mapWithConcurrency([1], 1, (n) => Promise.resolve(n), {
        signal: controller.signal,
      });

      expect(outcome.aborted).toBe(false);
    });
  });

  describe('progress reporting', () => {
    it('reports once per completed item with a running total', async () => {
      const onProgress = vi.fn();

      await mapWithConcurrency([1, 2, 3], 1, (n) => Promise.resolve(n), { onProgress });

      expect(onProgress.mock.calls).toEqual([
        [1, 3],
        [2, 3],
        [3, 3],
      ]);
    });

    it('counts failures as progress too', async () => {
      const onProgress = vi.fn();

      await mapWithConcurrency([1, 2], 1, () => Promise.reject(new Error('x')), { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(2);
    });
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid limit (%s)', async (limit) => {
    await expect(mapWithConcurrency([1], limit, (n) => Promise.resolve(n))).rejects.toThrow(
      RangeError,
    );
  });
});
