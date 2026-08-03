import { toError } from '../shared/errors.js';

export interface ConcurrentSuccess<T, R> {
  readonly index: number;
  readonly item: T;
  readonly value: R;
}

export interface ConcurrentFailure<T> {
  readonly index: number;
  readonly item: T;
  readonly error: Error;
}

export interface ConcurrentOutcome<T, R> {
  readonly results: ConcurrentSuccess<T, R>[];
  readonly failures: ConcurrentFailure<T>[];
  readonly aborted: boolean;
}

export interface ConcurrencyOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (completed: number, total: number) => void;
}

export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: ConcurrencyOptions = {},
): Promise<ConcurrentOutcome<T, R>> => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`Concurrency limit must be a positive integer, received ${limit}`);
  }

  const results: ConcurrentSuccess<T, R>[] = [];
  const failures: ConcurrentFailure<T>[] = [];
  let cursor = 0;
  let completed = 0;
  let aborted = false;

  const runWorker = async (): Promise<void> => {
    while (true) {
      if (options.signal?.aborted) {
        aborted = true;
        return;
      }

      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;

      const item = items[index] as T;
      try {
        results.push({ index, item, value: await worker(item, index) });
      } catch (error) {
        failures.push({ index, item, error: toError(error) });
      }

      completed += 1;
      options.onProgress?.(completed, items.length);
    }
  };

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  results.sort((a, b) => a.index - b.index);
  failures.sort((a, b) => a.index - b.index);

  return { results, failures, aborted };
};
