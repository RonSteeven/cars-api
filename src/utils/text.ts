/** Trims and collapses internal whitespace runs. Casing is left alone. */
export const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');
