import { createRequire } from 'node:module';

/**
 * Reads the version out of `package.json` at runtime.
 *
 * `createRequire` resolves relative to this module's own URL, and this file sits
 * two directories below the project root in both the source tree (`src/shared`)
 * and the build output (`dist/shared`), so the same specifier works either way.
 * If the file is missing (a stripped-down image, for example) we degrade to
 * `0.0.0` rather than crash the process over a cosmetic field.
 */
const readVersion = (): string => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
};

export const APP_VERSION = readVersion();
