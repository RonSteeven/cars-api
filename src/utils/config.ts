/** Splits a comma separated CORS allow-list, keeping `*` (or empty) as a wildcard. */
export const parseCorsOrigins = (raw: string): string[] | '*' => {
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed === '') return '*';
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};
