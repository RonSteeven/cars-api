import type { Filter } from 'mongodb';
import type { MakeDocument, MakeQuery } from '../../../types/persistence.js';
import type { Make } from '../../../types/vehicle.js';
import { escapeRegExp } from '../../../utils/text.js';

export const toDocument = (make: Make, syncedAt: Date): MakeDocument => ({
  _id: make.makeId,
  makeName: make.makeName,
  vehicleTypes: make.vehicleTypes.map((type) => ({
    typeId: type.typeId,
    typeName: type.typeName,
  })),
  syncedAt,
});

export const toDomain = (document: MakeDocument): Make => ({
  makeId: document._id,
  makeName: document.makeName,
  vehicleTypes: document.vehicleTypes.map((type) => ({
    typeId: type.typeId,
    typeName: type.typeName,
  })),
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
