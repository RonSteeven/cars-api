/**
 * Splits an array into fixed-size chunks.
 *
 * Bulk writes need this: MongoDB caps a single `bulkWrite` at 100k operations
 * and 16MB of BSON, and a 12,000-document catalogue sent as one batch is both
 * slow to acknowledge and all-or-nothing to retry.
 */
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  if (size < 1) throw new RangeError(`Chunk size must be at least 1, received ${size}`);

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};
