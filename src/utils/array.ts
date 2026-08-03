/**
 * Normalises an XML repeated element into an array.
 *
 * XML has no notion of a list, so a container with one child parses to an object
 * and a container with none parses to an empty string. vPIC hits both cases in
 * production (`<Results />` for an unknown make id, a single
 * `<VehicleTypesForMakeIds>` for most makes), and treating either as "no data"
 * or crashing on `.map` is a bug we would only find with real traffic.
 */
export const toArray = <T>(value: T | readonly T[] | null | undefined): T[] => {
  if (value === null || value === undefined || (value as unknown) === '') return [];
  return Array.isArray(value) ? [...value] : [value as T];
};
