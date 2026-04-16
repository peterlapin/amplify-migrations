import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Logger } from 'pino';

/**
 * A minimal shape the runner needs to know about the user's Amplify schema.
 * We don't take a dependency on `@aws-amplify/data-schema` — the authors'
 * migration files pin their own snapshot of `Schema`, so we stay decoupled.
 */
export type SchemaShape = {
  models: Record<string, { identifier: readonly string[] }>;
};

export type ModelName<S extends SchemaShape> = keyof S['models'] & string;

// Authors pin their own Schema snapshot, so we allow a loose record here
// and let their typed `ctx.put<"Todo">(...)` calls narrow it in user code.
export type ItemOf<S extends SchemaShape, M extends ModelName<S>> = Record<string, unknown> & {
  [K in S['models'][M]['identifier'][number]]: string;
};

export interface MigrationContext<S extends SchemaShape = SchemaShape> {
  /** Resolved physical DynamoDB table names keyed by model name. */
  readonly tables: Readonly<Record<ModelName<S>, string>>;
  /** The raw DynamoDB document client, for anything the helpers don't cover. */
  readonly raw: DynamoDBDocumentClient;
  readonly logger: Logger;
  readonly abortSignal?: AbortSignal;

  get<M extends ModelName<S>>(
    model: M,
    key: Record<string, unknown>,
  ): Promise<ItemOf<S, M> | undefined>;
  put<M extends ModelName<S>>(model: M, item: ItemOf<S, M>): Promise<void>;
  update<M extends ModelName<S>>(
    model: M,
    key: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<void>;
  delete<M extends ModelName<S>>(model: M, key: Record<string, unknown>): Promise<void>;
  scan<M extends ModelName<S>>(model: M, opts?: ScanOpts): AsyncIterable<ItemOf<S, M>>;
  transact(ops: TransactOp[]): Promise<void>;
}

export interface ScanOpts {
  filterExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
  limit?: number;
}

export type TransactOp =
  | { type: 'put'; model: string; item: Record<string, unknown>; condition?: string }
  | { type: 'update'; model: string; key: Record<string, unknown>; patch: Record<string, unknown> }
  | { type: 'delete'; model: string; key: Record<string, unknown>; condition?: string };

export abstract class AmplifyMigration<S extends SchemaShape = SchemaShape> {
  static description?: string;
  abstract up(ctx: MigrationContext<S>): Promise<void>;
  abstract down(ctx: MigrationContext<S>): Promise<void>;
}

export interface MigrationRecord {
  /** Storage-unique key: `<migrationName>#<direction>#<appliedAt>`. */
  name: string;
  /** The original migration basename (e.g. `Migration20260415120000-backfill`). */
  migrationName?: string;
  checksum: string;
  appliedAt: string; // ISO
  durationMs: number;
  batch: number;
  direction: 'up' | 'down';
}

/**
 * How to handle migrations whose on-disk bytes no longer match the checksum
 * recorded at apply time.
 *
 *  - "off"    (default): don't check. Silent. Matches the intuition that once
 *                        a migration is applied its file is just archival.
 *  - "warn":  log a warning per drifted migration but keep going.
 *  - "strict": refuse to run. Every mature migration framework defaults here
 *              because drift means new environments will replay a different
 *              script than what actually ran in prod. Opt in when you want
 *              strong guarantees.
 */
export type ChecksumPolicy = 'off' | 'warn' | 'strict';

export interface MigrationsConfig<S extends SchemaShape = SchemaShape> {
  migrationsDir: string;
  /** Name of the private DynamoDB table used for migration state. */
  stateTable?: string;
  /** Path to amplify_outputs.json used to discover the deployed state table name. */
  outputsPath?: string;
  /** TTL for the advisory run lock, in seconds. */
  lockTtlSeconds?: number;
  /** Override table name resolution (bypass amplify_outputs.json). */
  tables?: Readonly<Record<ModelName<S>, string>>;
  /** AWS region override. */
  region?: string;
  /** Optional logger (pino-compatible). */
  logger?: Logger;
  /** How to react to checksum drift on applied migrations. Defaults to "off". */
  checksumPolicy?: ChecksumPolicy;
}

export function defineMigrationsConfig<S extends SchemaShape = SchemaShape>(
  cfg: MigrationsConfig<S>,
): MigrationsConfig<S> {
  return cfg;
}
