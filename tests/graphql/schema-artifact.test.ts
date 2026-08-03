import { readFileSync } from 'node:fs';
import { buildSchema, printSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { typeDefs } from '@/presentation/graphql/schema.js';

/**
 * Guards the committed schema reference.
 *
 * `schema.graphql` is generated from the SDL in `schema.ts`, so it can drift the
 * moment someone edits the schema and forgets to regenerate — and a stale API
 * reference is worse than none, because it is believed. This makes the drift a
 * test failure with the fix in the message.
 */
describe('schema.graphql', () => {
  it('matches the live schema', () => {
    const committed = readFileSync(new URL('../../schema.graphql', import.meta.url), 'utf8');

    expect(committed.trimEnd(), 'schema.graphql is stale — run `npm run schema:print`').toBe(
      printSchema(buildSchema(typeDefs)),
    );
  });
});
