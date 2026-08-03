import { describe, expect, it } from 'vitest';
import { toArray } from './array.js';

describe('toArray', () => {
  it('passes an array through', () => {
    expect(toArray([1, 2])).toEqual([1, 2]);
  });

  it('wraps the single object XML produces for a one-element list', () => {
    expect(toArray({ id: '1' })).toEqual([{ id: '1' }]);
  });

  it('treats the empty string from a self-closing element as no records', () => {
    // `<Results />` parses to '', which is what vPIC returns for an unknown make.
    expect(toArray('' as unknown as { id: string })).toEqual([]);
  });

  it.each([undefined, null])('treats %s as no records', (value) => {
    expect(toArray(value)).toEqual([]);
  });

  it('returns a copy rather than the caller’s array', () => {
    const source = [1, 2];
    expect(toArray(source)).not.toBe(source);
  });
});
