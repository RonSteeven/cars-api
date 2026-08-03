/**
 * Waits for a promise, giving up after `timeoutMs`.
 *
 * Returns `true` when the promise settled in time and `false` when it did not.
 * The promise is not cancelled on timeout — nothing in JavaScript can do that —
 * so this is for "wait, but not forever" situations such as draining work during
 * shutdown, where the alternative is hanging until the orchestrator SIGKILLs us.
 */
export const settleWithin = async (
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    // Never let the timer alone keep the event loop alive.
    timer.unref();
  });

  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
