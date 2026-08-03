import { describe, expect, it } from 'vitest';
import { compareIds } from './sort.js';

describe('compareIds', () => {
  it('orders numeric ids by value, not as text', () => {
    // A plain string sort would put '1000' before '99'.
    expect(['1000', '99', '7'].sort(compareIds)).toEqual(['7', '99', '1000']);
  });

  it('falls back to lexicographic order for non-numeric ids', () => {
    expect(['b-2', 'a-1'].sort(compareIds)).toEqual(['a-1', 'b-2']);
  });

  it('treats equal ids as equal', () => {
    expect(compareIds('440', '440')).toBe(0);
  });

  it('stays total when only one side is numeric', () => {
    expect(compareIds('440', 'abc')).not.toBeNaN();
  });
});
