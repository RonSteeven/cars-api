/**
 * The query the Apollo sandbox opens with.
 *
 * Apollo's own default is an empty tab, which makes the endpoint look inert:
 * the first thing a newcomer meets is a blank editor and a schema they have not
 * read yet. Seeding the document means opening the sandbox and pressing ▶ is a
 * complete first interaction, and the four operations together cover the whole
 * API surface — every query, both filter criteria, pagination, and the null
 * case.
 *
 * The values in `variables` are chosen to work after the capped ingestion the
 * README recommends (`INGEST_MAKE_LIMIT=200`), not just after a full pass, so
 * the example does not answer with an empty page on a first run.
 *
 * This is a developer aid only. It ships behind the same `introspection` flag as
 * the landing page itself, so nothing here is reachable in a deployment that has
 * introspection switched off.
 */

/** Make id 475 is ACURA, which has three vehicle types and lands in the first 200 makes. */
const EXAMPLE_MAKE_ID = '475';

// Deliberately not tagged `#graphql`: unlike the SDL in schema.ts, this string is
// rendered verbatim into the user's editor, where the marker would read as noise
// on line 1.
export const sandboxDocument = `# cars-api — the whole API is three queries.
#
# Pick an operation from the dropdown above and press ▶. The Variables panel
# is already filled in for the operations that take arguments.
#
# A fresh datastore is empty, so these answer with totalCount 0 until you run:
#   INGEST_MAKE_LIMIT=200 npm run ingest

# The primary query: makes with their vehicle types in a single round trip.
# Vehicle types are embedded in the make document, so nesting them here adds
# no per-make lookup — there is no N+1 to avoid.
query ListMakes {
  makes(limit: 10) {
    totalCount
    hasMore
    items {
      makeId
      makeName
      vehicleTypes {
        typeId
        typeName
      }
    }
  }
}

# Both filter criteria are index-backed: "search" is a case-insensitive
# substring on the name, matched as literal text rather than a pattern, and
# "vehicleTypeId" uses the multikey index. Pagination is not optional — limit
# defaults to 50, and a request above 200 is rejected rather than truncated.
query FilterMakes($filter: MakeFilter, $limit: Int, $offset: Int) {
  makes(filter: $filter, limit: $limit, offset: $offset) {
    totalCount
    limit
    offset
    hasMore
    items {
      makeId
      makeName
      vehicleTypes {
        typeName
      }
    }
  }
}

# A single make by its natural key. Change makeId to something that was never
# ingested: the answer is null rather than an error, because a missing make is
# a normal result and not a failure.
query OneMake($makeId: ID!) {
  make(makeId: $makeId) {
    makeId
    makeName
    vehicleTypes {
      typeId
      typeName
    }
  }
}

# Every distinct type in the catalogue — enough to populate the filter control
# that feeds vehicleTypeId above, without paging through all the makes.
query ListVehicleTypes {
  vehicleTypes {
    typeId
    typeName
  }
}
`;

/**
 * Shared across the document: the sandbox keeps one variables panel for all
 * operations, so every variable any operation declares has to be present.
 */
export const sandboxVariables = {
  filter: { search: 'moto', vehicleTypeId: '1' },
  limit: 10,
  offset: 0,
  makeId: EXAMPLE_MAKE_ID,
};
