/** Trims and collapses internal whitespace runs. Casing is left alone. */
export const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');

/**
 * Escapes a string so a RegExp matches it literally.
 *
 * Required before interpolating caller input into a MongoDB `$regex`: a search
 * for `1/OFF (KUSTOMS)` would otherwise be parsed as a pattern, and a crafted
 * input like `(a+)+$` turns a name search into a CPU-burning backtrack.
 */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
