/**
 * Orders ids numerically when both are numeric, lexicographically otherwise.
 *
 * vPIC ids are numeric strings, so a plain string sort would put make 1000
 * before make 99. The fallback keeps the comparator total for any future
 * non-numeric id.
 */
export const compareIds = (a: string, b: string): number => {
  const left = Number(a);
  const right = Number(b);

  if (Number.isInteger(left) && Number.isInteger(right) && left !== right) {
    return left - right;
  }
  return a.localeCompare(b);
};
