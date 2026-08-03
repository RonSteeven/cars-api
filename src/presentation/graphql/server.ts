import { ApolloServer, type ApolloServerOptions } from '@apollo/server';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { expressMiddleware } from '@as-integrations/express5';
import { unwrapResolverError } from '@apollo/server/errors';
import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors.js';
import type { GraphQLContext, GraphQLServerDependencies } from '../../types/graphql.js';

/**
 * Apollo error codes that mean "the caller got it wrong".
 *
 * These pass through untouched even in production: masking a malformed request
 * as INTERNAL_ERROR tells the caller the server is broken when the fix is on
 * their side. `BAD_REQUEST` matters most in practice — it is what a bare
 * `GET /graphql` (no query string) produces.
 */
const CLIENT_ERROR_CODES = new Set([
  'BAD_REQUEST',
  'BAD_USER_INPUT',
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'OPERATION_RESOLUTION_FAILURE',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
]);

export interface GraphQLHandler {
  readonly middleware: RequestHandler;
  stop(): Promise<void>;
}

/**
 * Builds the single GraphQL endpoint.
 *
 * Returns the middleware plus a `stop` so shutdown can drain in-flight
 * operations. Nothing is imported by resolvers directly — the repository and
 * logger arrive through the per-request context, which is what lets the whole
 * API be tested against an in-memory repository.
 */
export const createGraphQLHandler = async (
  dependencies: GraphQLServerDependencies,
  typeDefs: string,
  resolvers: ApolloServerOptions<GraphQLContext>['resolvers'],
): Promise<GraphQLHandler> => {
  const logger = dependencies.logger.child({ component: 'graphql' });

  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    introspection: dependencies.introspection,
    // Stack traces are developer aids, never part of an API response.
    includeStacktraceInErrorResponses: dependencies.exposeInternals,
    plugins: dependencies.introspection ? [] : [ApolloServerPluginLandingPageDisabled()],

    /**
     * Single place where a thrown error becomes a GraphQL error.
     *
     * Apollo wraps resolver errors, so `unwrapResolverError` is needed to see
     * our own AppError underneath. Operational errors keep their code and
     * message; anything else is a bug and is reported generically, with the
     * detail going to the log instead of the client.
     */
    formatError: (formatted, thrown) => {
      const original = unwrapResolverError(thrown);

      // Client faults are safe and useful to return verbatim, in every
      // environment. Checked first: these never originate in our own code, so
      // there is nothing to unwrap or hide.
      const code = formatted.extensions?.['code'];
      if (typeof code === 'string' && CLIENT_ERROR_CODES.has(code)) {
        return formatted;
      }

      if (original instanceof AppError) {
        if (original.isOperational) {
          logger.warn({ err: original.toLogObject() }, `GraphQL error: ${original.message}`);
          return {
            ...formatted,
            message: original.message,
            extensions: { ...formatted.extensions, code: original.code },
          };
        }
        logger.error({ err: original }, `GraphQL failure: ${original.message}`);
      } else if (original instanceof Error) {
        logger.error({ err: original }, `Unexpected GraphQL error: ${original.message}`);
      }

      if (dependencies.exposeInternals) return formatted;

      return {
        message: 'Internal server error',
        extensions: { code: 'INTERNAL_ERROR' },
      };
    },
  });

  await server.start();
  logger.info({ introspection: dependencies.introspection }, 'GraphQL endpoint ready');

  const middleware = expressMiddleware(server, {
    context: ({ req }) =>
      Promise.resolve({
        repository: dependencies.repository,
        // Reuses the per-request child logger, so a GraphQL error carries the
        // same request id as the access log line.
        logger: req.log ?? logger,
      }),
  });

  return {
    middleware,
    stop: () => server.stop(),
  };
};
