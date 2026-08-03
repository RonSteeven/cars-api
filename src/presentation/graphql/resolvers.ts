import { BadRequestError } from '@/shared/errors.js';
import type {
  GraphQLContext,
  MakeArgs,
  MakeConnection,
  MakeFilterArgs,
  MakesArgs,
} from '@/types/graphql.js';
import type { MakeQuery } from '@/types/persistence.js';
import type { Make, VehicleType } from '@/types/vehicle.js';

/**
 * Hard ceiling on page size.
 *
 * The catalogue is ~12,300 makes with their types embedded, so an unbounded
 * `limit` is an easy way for one query to pull the entire collection into memory
 * and serialise it. Requests above the ceiling are rejected rather than silently
 * truncated, so a client is never misled about what it received.
 */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

const toQuery = (filter: MakeFilterArgs | null | undefined): MakeQuery => {
  const query: { search?: string; vehicleTypeId?: string } = {};
  if (filter?.search) query.search = filter.search;
  if (filter?.vehicleTypeId) query.vehicleTypeId = filter.vehicleTypeId;
  return query;
};

const validatePagination = (limit: number, offset: number): void => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadRequestError(`limit must be a positive integer, received ${limit}`);
  }
  if (limit > MAX_PAGE_SIZE) {
    throw new BadRequestError(`limit must not exceed ${MAX_PAGE_SIZE}, received ${limit}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestError(`offset must be zero or a positive integer, received ${offset}`);
  }
};

export const resolvers = {
  Query: {
    makes: async (
      _parent: unknown,
      args: MakesArgs,
      context: GraphQLContext,
    ): Promise<MakeConnection> => {
      const limit = args.limit ?? DEFAULT_PAGE_SIZE;
      const offset = args.offset ?? 0;
      validatePagination(limit, offset);

      const query = toQuery(args.filter);
      // One extra row tells us whether another page exists without a count.
      const items = await context.repository.findMany({ ...query, limit: limit + 1, offset });

      return { items, limit, offset, query };
    },

    make: (_parent: unknown, args: MakeArgs, context: GraphQLContext): Promise<Make | null> =>
      context.repository.findByMakeId(args.makeId),

    vehicleTypes: (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext,
    ): Promise<VehicleType[]> => context.repository.listVehicleTypes(),
  },

  MakeConnection: {
    // The resolver over-fetched by one row to detect a following page; trim it
    // back so the client sees exactly the page size it asked for.
    items: (connection: MakeConnection): Make[] => connection.items.slice(0, connection.limit),

    hasMore: (connection: MakeConnection): boolean => connection.items.length > connection.limit,

    /**
     * Lazy on purpose: counting matching documents is a second query, and a
     * client paging through results usually does not need the total on every
     * page. GraphQL only invokes this when `totalCount` is selected.
     */
    totalCount: (connection: MakeConnection, _args: unknown, context: GraphQLContext) =>
      context.repository.count(connection.query),
  },
};
