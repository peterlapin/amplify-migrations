import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Minimal Amplify Gen 2 schema for the migration example.
 * Note: there is NO AmplifyMigration model here — migration state lives
 * in a private DynamoDB table owned by `withMigrations()`, outside the
 * GraphQL API.
 */
const schema = a.schema({
  Todo: a
    .model({
      content: a.string(),
      owner: a.string(),
      // Legacy field kept around so the seed migration has something to
      // read. Delete once the backfill has rolled out.
      createdBy: a.string(),
    })
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;
export const data = defineData({ schema });
