import { describe, expect, it } from 'vitest';
import { buildFilter, toDocument, toDomain } from './make.mapper.js';
import type { MakeDocument } from '@/types/persistence.js';
import type { Make } from '@/types/vehicle.js';

const SYNCED_AT = new Date('2026-01-01T00:00:00.000Z');

const ASTON: Make = {
  makeId: '440',
  makeName: 'ASTON MARTIN',
  vehicleTypes: [
    { typeId: '2', typeName: 'Passenger Car' },
    { typeId: '7', typeName: 'MPV' },
  ],
};

describe('toDocument', () => {
  it('stores the make id as the document key', () => {
    // _id as the natural key is what makes upserts idempotent.
    expect(toDocument(ASTON, SYNCED_AT)._id).toBe('440');
  });

  it('stamps the sync timestamp used by the prune step', () => {
    expect(toDocument(ASTON, SYNCED_AT).syncedAt).toBe(SYNCED_AT);
  });

  it('keeps the embedded vehicle types', () => {
    expect(toDocument(ASTON, SYNCED_AT).vehicleTypes).toEqual([
      { typeId: '2', typeName: 'Passenger Car' },
      { typeId: '7', typeName: 'MPV' },
    ]);
  });

  it('does not store a redundant makeId field', () => {
    expect(Object.keys(toDocument(ASTON, SYNCED_AT))).toEqual([
      '_id',
      'makeName',
      'vehicleTypes',
      'syncedAt',
    ]);
  });
});

describe('toDomain', () => {
  const document: MakeDocument = {
    _id: '440',
    makeName: 'ASTON MARTIN',
    vehicleTypes: [{ typeId: '2', typeName: 'Passenger Car' }],
    syncedAt: SYNCED_AT,
  };

  it('projects _id back onto makeId', () => {
    expect(toDomain(document).makeId).toBe('440');
  });

  it('hides storage-only fields from the domain', () => {
    expect(Object.keys(toDomain(document))).toEqual(['makeId', 'makeName', 'vehicleTypes']);
  });

  it('round trips a make unchanged', () => {
    expect(toDomain(toDocument(ASTON, SYNCED_AT))).toEqual(ASTON);
  });
});

describe('buildFilter', () => {
  it('is empty when nothing is asked for', () => {
    expect(buildFilter()).toEqual({});
    expect(buildFilter({})).toEqual({});
  });

  it('matches names case-insensitively', () => {
    expect(buildFilter({ search: 'aston' })).toEqual({
      makeName: { $regex: 'aston', $options: 'i' },
    });
  });

  it('escapes regex metacharacters in the search term', () => {
    // '1/OFF KUSTOMS, LLC' and similar names are real vPIC data; unescaped
    // parentheses would be parsed as a capture group and match the wrong rows.
    expect(buildFilter({ search: 'KUSTOMS (LLC)' })).toEqual({
      makeName: { $regex: 'KUSTOMS \\(LLC\\)', $options: 'i' },
    });
  });

  it('neutralises a catastrophic-backtracking pattern', () => {
    const filter = buildFilter({ search: '(a+)+$' }) as { makeName: { $regex: string } };

    expect(filter.makeName.$regex).toBe('\\(a\\+\\)\\+\\$');
  });

  it('filters by embedded vehicle type id', () => {
    expect(buildFilter({ vehicleTypeId: '2' })).toEqual({ 'vehicleTypes.typeId': '2' });
  });

  it('combines both criteria', () => {
    expect(buildFilter({ search: 'aston', vehicleTypeId: '2' })).toEqual({
      makeName: { $regex: 'aston', $options: 'i' },
      'vehicleTypes.typeId': '2',
    });
  });

  it.each(['', '   '])('ignores a blank search term (%j)', (search) => {
    expect(buildFilter({ search })).toEqual({});
  });

  it('trims a padded search term', () => {
    expect(buildFilter({ search: '  aston  ' })).toEqual({
      makeName: { $regex: 'aston', $options: 'i' },
    });
  });

  it('ignores pagination, which is not part of the filter', () => {
    expect(buildFilter({ limit: 10, offset: 20 })).toEqual({});
  });
});
