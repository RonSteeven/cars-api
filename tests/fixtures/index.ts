import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads a fixture captured from the real vPIC API.
 *
 * The fixtures are verbatim responses (namespaces, self-closing `<Results />`
 * and all) rather than hand-written XML, so the parser is exercised against what
 * production actually returns.
 */
export const loadFixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./nhtsa/${name}`, import.meta.url)), 'utf8');
