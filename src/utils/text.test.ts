import { describe, expect, it } from 'vitest';
import { normalizeText } from './text.js';

describe('normalizeText', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeText('  ASTON MARTIN  ')).toBe('ASTON MARTIN');
  });

  it('collapses internal whitespace runs', () => {
    expect(normalizeText('ASTON   MARTIN')).toBe('ASTON MARTIN');
  });

  it('collapses tabs and newlines too', () => {
    expect(normalizeText('ASTON\t\nMARTIN')).toBe('ASTON MARTIN');
  });

  it('leaves casing and punctuation alone', () => {
    expect(normalizeText('1/OFF KUSTOMS, LLC')).toBe('1/OFF KUSTOMS, LLC');
  });
});
