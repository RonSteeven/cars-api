import { describe, expect, it } from 'vitest';
import { chunk } from './chunk.js';

describe('chunk', () => {
  it('splits evenly when the size divides the length', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('leaves a short final chunk', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it('returns nothing for an empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('returns one chunk when the size exceeds the length', () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]]);
  });

  it('preserves order and every element', () => {
    const items = Array.from({ length: 12_312 }, (_, index) => index);

    const chunks = chunk(items, 1_000);

    expect(chunks).toHaveLength(13);
    expect(chunks.flat()).toEqual(items);
    expect(chunks.at(-1)).toHaveLength(312);
  });

  it('does not mutate the input', () => {
    const items = [1, 2, 3];
    chunk(items, 2);
    expect(items).toEqual([1, 2, 3]);
  });

  it.each([0, -1])('rejects a size of %i', (size) => {
    expect(() => chunk([1], size)).toThrow(RangeError);
  });
});
