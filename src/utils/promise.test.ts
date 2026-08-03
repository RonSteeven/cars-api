import { describe, expect, it } from 'vitest';
import { settleWithin } from './promise.js';

const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

describe('settleWithin', () => {
  it('reports true when the promise resolves in time', async () => {
    await expect(settleWithin(after(1, 'done'), 100)).resolves.toBe(true);
  });

  it('reports false when the promise is still pending', async () => {
    await expect(settleWithin(after(100, 'slow'), 5)).resolves.toBe(false);
  });

  it('reports true for an already resolved promise', async () => {
    await expect(settleWithin(Promise.resolve(), 10)).resolves.toBe(true);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    await expect(settleWithin(Promise.reject(new Error('boom')), 100)).rejects.toThrow('boom');
  });

  it('does not keep the event loop alive after resolving', async () => {
    // The timer is unref'd, so a long timeout cannot delay process exit.
    await expect(settleWithin(Promise.resolve(), 60_000)).resolves.toBe(true);
  });
});
