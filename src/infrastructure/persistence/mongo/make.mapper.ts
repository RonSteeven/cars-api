import type { Filter } from 'mongodb';
import type { MakeDocument, MakeQuery } from '../../../types/persistence.js';
import type { Make } from '../../../types/vehicle.js';
import { escapeRegExp } from '../../../utils/text.js';

/**
 * Domain ↔ document translation, which is only ever the key: `makeId` is stored
 * as `_id` so the natural key is the primary key and upserts stay idempotent.
 * Embedded vehicle types are the same shape on both sides, and both sides are
 * read-only, so they are carried across rather than rebuilt field by field.
 */
export const toDocument = (make: Make, syncedAt: Date): MakeDocument => ({
  _id: make.makeId,
  makeName: make.makeName,
  vehicleTypes: make.vehicleTypes,
  syncedAt,
});

/** Drops storage-only fields (`_id` becomes `makeId`, `syncedAt` disappears). */
export const toDomain = ({ _id, makeName, vehicleTypes }: MakeDocument): Make => ({
  makeId: _id,
  makeName,
  vehicleTypes,
});

export const buildFilter = (query: MakeQuery = {}): Filter<MakeDocument> => {
  const filter: Record<string, unknown> = {};

  const search = query.search?.trim();
  if (search) {
    filter.makeName = { $regex: escapeRegExp(search), $options: 'i' };
  }

  const vehicleTypeId = query.vehicleTypeId?.trim();
  if (vehicleTypeId) {
    filter['vehicleTypes.typeId'] = vehicleTypeId;
  }

  return filter;
};
