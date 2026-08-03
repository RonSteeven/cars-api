/**
 * The GraphQL schema.
 *
 * Written as SDL rather than built programmatically so it doubles as the API
 * reference: every type, field and argument carries a description, and those
 * descriptions are what a client sees in the Apollo sandbox or any generated
 * documentation.
 */
export const typeDefs = `#graphql
  "A category of vehicle, as classified by NHTSA."
  type VehicleType {
    "NHTSA vehicle type identifier, e.g. \\"2\\". Opaque: never treat it as a number."
    typeId: ID!

    "Human readable name, e.g. \\"Passenger Car\\"."
    typeName: String!
  }

  "A vehicle manufacturer together with the vehicle types it produces."
  type Make {
    "NHTSA make identifier, e.g. \\"440\\". Opaque: never treat it as a number."
    makeId: ID!

    "Manufacturer name, e.g. \\"ASTON MARTIN\\". Whitespace-normalised, original casing."
    makeName: String!

    """
    Vehicle types this make produces, ordered by id.

    Embedded in the same document as the make, so requesting it costs no extra
    database round trip. May be empty: NHTSA genuinely reports no types for some
    manufacturers.
    """
    vehicleTypes: [VehicleType!]!
  }

  "A page of makes, plus the metadata needed to walk the rest of them."
  type MakeConnection {
    "The makes on this page, ordered by name (case-insensitive)."
    items: [Make!]!

    """
    Total number of makes matching the filter, ignoring pagination.

    Resolved lazily: the count query only runs when this field is selected, so
    listing a page without it costs a single database read.
    """
    totalCount: Int!

    "The limit that was applied, after clamping to the server maximum."
    limit: Int!

    "The offset that was applied."
    offset: Int!

    "Whether another page exists after this one."
    hasMore: Boolean!
  }

  "Criteria for narrowing a make listing. Omitted fields are not applied."
  input MakeFilter {
    """
    Case-insensitive substring match on the make name.

    Treated as literal text, not a pattern: regular expression metacharacters are
    escaped, so searching \\"1/OFF (KUSTOMS)\\" matches that name exactly.
    """
    search: String

    "Only return makes that produce this vehicle type."
    vehicleTypeId: ID
  }

  type Query {
    """
    List makes with their vehicle types.

    This is the primary query: the shape of \`items\` is the unified structure the
    ingestion pipeline produces.

    Pagination is required by design — the catalogue holds ~12,300 makes, so
    \`limit\` defaults to 50 and is clamped to 200. Both filter criteria are
    index-backed.
    """
    makes(
      "Narrow the result set. Omit for the whole catalogue."
      filter: MakeFilter

      "Page size. Defaults to 50, clamped to a maximum of 200."
      limit: Int = 50

      "Number of makes to skip. Defaults to 0."
      offset: Int = 0
    ): MakeConnection!

    """
    Fetch a single make by its NHTSA identifier.

    Returns null when no such make is stored, rather than erroring: a missing
    make is a normal answer, not a failure.
    """
    make(
      "NHTSA make identifier, e.g. \\"440\\"."
      makeId: ID!
    ): Make

    """
    Every distinct vehicle type present in the catalogue, ordered by id.

    Intended for populating a filter control without paging through all makes.
    """
    vehicleTypes: [VehicleType!]!
  }
`;
