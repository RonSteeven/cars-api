/**
 * Prints the GraphQL schema as SDL on stdout; `npm run schema:print` writes it to
 * `schema.graphql`.
 *
 * The schema is authored as SDL in `src/presentation/graphql/schema.ts`, but that
 * is a TypeScript template literal: no client tool can read it. This emits the
 * same schema as a plain `.graphql` file that codegen, linters and editors
 * understand, and that shows a readable diff when the API changes.
 *
 * `buildSchema` is enough here — printing the type system needs no resolvers.
 */
import { buildSchema, printSchema } from 'graphql';
import { typeDefs } from '@/presentation/graphql/schema.js';

// graphql-js omits the trailing newline every text file should end with.
process.stdout.write(`${printSchema(buildSchema(typeDefs))}\n`);
