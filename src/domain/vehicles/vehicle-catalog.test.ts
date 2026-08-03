import { describe, expect, it } from 'vitest';
import { buildVehicleCatalog } from './vehicle-catalog.js';
import { TransformationError } from '@/shared/errors.js';
import type { CatalogInput, MakeInput, VehicleType } from '@/types/vehicle.js';

const build = (
  makes: readonly MakeInput[],
  types: Record<string, readonly VehicleType[]> = {},
): CatalogInput => ({
  makes,
  vehicleTypesByMakeId: new Map(Object.entries(types)),
});

const ASTON: MakeInput = { makeId: '440', makeName: 'ASTON MARTIN' };
const BENTLEY: MakeInput = { makeId: '441', makeName: 'BENTLEY' };

describe('buildVehicleCatalog', () => {
  describe('the required output shape', () => {
    it('produces exactly the structure specified by the contract', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON], {
          '440': [
            { typeId: '2', typeName: 'Passenger Car' },
            { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
          ],
        }),
      );

      expect(makes).toEqual([
        {
          makeId: '440',
          makeName: 'ASTON MARTIN',
          vehicleTypes: [
            { typeId: '2', typeName: 'Passenger Car' },
            { typeId: '7', typeName: 'Multipurpose Passenger Vehicle (MPV)' },
          ],
        },
      ]);
    });

    it('emits no keys beyond the contract', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON], { '440': [{ typeId: '2', typeName: 'Passenger Car' }] }),
      );

      expect(Object.keys(makes[0] ?? {})).toEqual(['makeId', 'makeName', 'vehicleTypes']);
      expect(Object.keys(makes[0]?.vehicleTypes[0] ?? {})).toEqual(['typeId', 'typeName']);
    });

    it('keeps ids as strings', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON], { '440': [{ typeId: '2', typeName: 'Passenger Car' }] }),
      );

      expect(typeof makes[0]?.makeId).toBe('string');
      expect(typeof makes[0]?.vehicleTypes[0]?.typeId).toBe('string');
    });

    it('survives a JSON round trip unchanged', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON], { '440': [{ typeId: '2', typeName: 'Passenger Car' }] }),
      );

      expect(JSON.parse(JSON.stringify(makes))).toEqual(makes);
    });
  });

  describe('combining makes with their types', () => {
    it('attaches each make its own types', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON, BENTLEY], {
          '440': [{ typeId: '2', typeName: 'Passenger Car' }],
          '441': [{ typeId: '7', typeName: 'MPV' }],
        }),
      );

      expect(makes[0]?.vehicleTypes).toEqual([{ typeId: '2', typeName: 'Passenger Car' }]);
      expect(makes[1]?.vehicleTypes).toEqual([{ typeId: '7', typeName: 'MPV' }]);
    });

    it('keeps a make that has no vehicle types', () => {
      // vPIC really does return none for some makes; dropping them would leave
      // the catalogue quietly incomplete.
      const { makes, stats } = buildVehicleCatalog(build([ASTON]));

      expect(makes).toEqual([{ makeId: '440', makeName: 'ASTON MARTIN', vehicleTypes: [] }]);
      expect(stats.makesWithoutVehicleTypes).toBe(1);
    });

    it('ignores types keyed to a make that was not supplied', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON], { '999': [{ typeId: '2', typeName: 'Orphan' }] }),
      );

      expect(makes).toHaveLength(1);
      expect(makes[0]?.vehicleTypes).toEqual([]);
    });

    it('returns an empty catalogue for empty input', () => {
      const { makes, stats } = buildVehicleCatalog(build([]));

      expect(makes).toEqual([]);
      expect(stats.makesIn).toBe(0);
    });
  });

  describe('deterministic ordering', () => {
    it('orders makes numerically, not lexicographically', () => {
      // A plain string sort would put '1000' before '99'.
      const { makes } = buildVehicleCatalog(
        build([
          { makeId: '1000', makeName: 'C' },
          { makeId: '99', makeName: 'B' },
          { makeId: '7', makeName: 'A' },
        ]),
      );

      expect(makes.map((m) => m.makeId)).toEqual(['7', '99', '1000']);
    });

    it('orders vehicle types within a make', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON], {
          '440': [
            { typeId: '10', typeName: 'Ten' },
            { typeId: '2', typeName: 'Two' },
          ],
        }),
      );

      expect(makes[0]?.vehicleTypes.map((t) => t.typeId)).toEqual(['2', '10']);
    });

    it('falls back to lexicographic order for non-numeric ids', () => {
      const { makes } = buildVehicleCatalog(
        build([
          { makeId: 'b-2', makeName: 'B' },
          { makeId: 'a-1', makeName: 'A' },
        ]),
      );

      expect(makes.map((m) => m.makeId)).toEqual(['a-1', 'b-2']);
    });

    it('produces identical output regardless of input order', () => {
      // Idempotent upserts depend on this.
      const first = buildVehicleCatalog(build([ASTON, BENTLEY]));
      const second = buildVehicleCatalog(build([BENTLEY, ASTON]));

      expect(first.makes).toEqual(second.makes);
    });
  });

  describe('de-duplication', () => {
    it('keeps the first of two makes sharing an id and counts the rest', () => {
      const { makes, stats } = buildVehicleCatalog(
        build([ASTON, { makeId: '440', makeName: 'ASTON MARTIN DUPLICATE' }]),
      );

      expect(makes).toHaveLength(1);
      expect(makes[0]?.makeName).toBe('ASTON MARTIN');
      expect(stats.duplicateMakes).toBe(1);
    });

    it('de-duplicates vehicle types within a make', () => {
      const { makes, stats } = buildVehicleCatalog(
        build([ASTON], {
          '440': [
            { typeId: '2', typeName: 'Passenger Car' },
            { typeId: '2', typeName: 'Passenger Car' },
          ],
        }),
      );

      expect(makes[0]?.vehicleTypes).toHaveLength(1);
      expect(stats.duplicateVehicleTypes).toBe(1);
    });

    it('does not treat the same type under different makes as a duplicate', () => {
      const { makes, stats } = buildVehicleCatalog(
        build([ASTON, BENTLEY], {
          '440': [{ typeId: '2', typeName: 'Passenger Car' }],
          '441': [{ typeId: '2', typeName: 'Passenger Car' }],
        }),
      );

      expect(makes[0]?.vehicleTypes).toHaveLength(1);
      expect(makes[1]?.vehicleTypes).toHaveLength(1);
      expect(stats.duplicateVehicleTypes).toBe(0);
    });
  });

  describe('normalisation', () => {
    it('collapses whitespace runs in names', () => {
      const { makes } = buildVehicleCatalog(build([{ makeId: '1', makeName: 'ASTON   MARTIN' }]));

      expect(makes[0]?.makeName).toBe('ASTON MARTIN');
    });

    it('trims surrounding whitespace from names and ids', () => {
      const { makes } = buildVehicleCatalog(
        build([{ makeId: ' 440 ', makeName: '  ASTON MARTIN  ' }]),
      );

      expect(makes[0]).toMatchObject({ makeId: '440', makeName: 'ASTON MARTIN' });
    });

    it('preserves casing and punctuation', () => {
      const { makes } = buildVehicleCatalog(
        build([{ makeId: '1', makeName: '1/OFF KUSTOMS, LLC' }]),
      );

      expect(makes[0]?.makeName).toBe('1/OFF KUSTOMS, LLC');
    });

    it('normalises vehicle type names too', () => {
      const { makes } = buildVehicleCatalog(
        build([ASTON], { '440': [{ typeId: '2', typeName: '  Passenger   Car ' }] }),
      );

      expect(makes[0]?.vehicleTypes[0]?.typeName).toBe('Passenger Car');
    });
  });

  describe('rejecting bad records', () => {
    it.each([
      ['an empty id', { makeId: '', makeName: 'NO ID' }],
      ['a whitespace-only id', { makeId: '   ', makeName: 'BLANK ID' }],
      ['an empty name', { makeId: '1', makeName: '' }],
      ['a whitespace-only name', { makeId: '1', makeName: '   ' }],
    ])('skips a make with %s and counts it', (_label, bad) => {
      const { makes, stats } = buildVehicleCatalog(build([ASTON, bad]));

      expect(makes).toHaveLength(1);
      expect(stats.invalidMakes).toBe(1);
    });

    it('skips a malformed vehicle type without losing the make', () => {
      const { makes, stats } = buildVehicleCatalog(
        build([ASTON], {
          '440': [
            { typeId: '2', typeName: 'Passenger Car' },
            { typeId: '', typeName: 'Broken' },
          ],
        }),
      );

      expect(makes[0]?.vehicleTypes).toHaveLength(1);
      expect(stats.invalidVehicleTypes).toBe(1);
    });

    it('throws when every make is invalid, rather than reporting an empty catalogue', () => {
      // One bad row is noise; all of them means the upstream contract changed,
      // and an empty result here would look like a successful run.
      expect(() => buildVehicleCatalog(build([{ makeId: '', makeName: '' }]))).toThrow(
        TransformationError,
      );
    });

    it('does not throw when at least one make survives', () => {
      expect(() => buildVehicleCatalog(build([ASTON, { makeId: '', makeName: '' }]))).not.toThrow();
    });
  });

  describe('reported statistics', () => {
    it('accounts for every input record', () => {
      const { stats } = buildVehicleCatalog(
        build(
          [
            ASTON,
            BENTLEY,
            { makeId: '440', makeName: 'DUPLICATE' },
            { makeId: '', makeName: 'BAD' },
          ],
          {
            '440': [
              { typeId: '2', typeName: 'Passenger Car' },
              { typeId: '2', typeName: 'Duplicate' },
              { typeId: '', typeName: 'Invalid' },
            ],
          },
        ),
      );

      expect(stats).toEqual({
        makesIn: 4,
        makesOut: 2,
        invalidMakes: 1,
        duplicateMakes: 1,
        makesWithoutVehicleTypes: 1,
        vehicleTypesOut: 1,
        invalidVehicleTypes: 1,
        duplicateVehicleTypes: 1,
      });
    });
  });

  it('does not mutate its input', () => {
    const makes: MakeInput[] = [BENTLEY, ASTON];
    const types = [
      { typeId: '10', typeName: 'Ten' },
      { typeId: '2', typeName: 'Two' },
    ];
    const snapshot = structuredClone({ makes, types });

    buildVehicleCatalog(build(makes, { '440': types }));

    expect({ makes, types }).toEqual(snapshot);
  });
});
