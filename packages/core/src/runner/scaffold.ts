import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Intentionally duplicated from loader/loader.ts so this module has no
 * cross-package imports — scaffold() must stay runnable from the CLI before
 * the rest of the runner is set up.
 */
function nextTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(now.getUTCFullYear()) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}

export interface ScaffoldResult {
  migrationPath: string;
  schemaSnapshotPath: string;
  name: string;
}

/**
 * Creates a new migration file plus a sibling `.schema.ts` snapshot that
 * freezes the user's Amplify `Schema` type at authoring time. The migration
 * imports `Schema` from the snapshot — never from `amplify/data/resource` —
 * so later schema changes can't retype old migrations.
 */
export async function scaffoldMigration(opts: {
  dir: string;
  name: string;
  /** Contents of the current `amplify/data/resource.ts` schema type (serialized as TS). */
  schemaSnapshotSource?: string;
  now?: Date;
}): Promise<ScaffoldResult> {
  const { dir } = opts;
  const slug = opts.name.replace(/[^A-Za-z0-9-_]/g, '-');
  const ts = nextTimestamp(opts.now);
  const basename = `Migration${ts}${slug ? `-${slug}` : ''}`;
  const absDir = resolve(dir);
  await mkdir(absDir, { recursive: true });

  const schemaSnapshotPath = join(absDir, `${basename}.schema.ts`);
  const migrationPath = join(absDir, `${basename}.ts`);

  const defaultSnapshot = `// Auto-generated schema snapshot — do not edit by hand.
// Captures the Amplify schema type at the moment this migration was created,
// so the migration's types cannot drift when the live schema evolves.
export type Schema = {
  models: {
    // Replace this with the actual snapshot of your Schema at creation time.
    // The CLI will fill this in automatically in a future version.
    [modelName: string]: { identifier: readonly string[] };
  };
};
`;
  await writeFile(schemaSnapshotPath, opts.schemaSnapshotSource ?? defaultSnapshot, 'utf8');

  const migrationSource = `import { AmplifyMigration, type MigrationContext } from "@amplify-migrations/core";
import type { Schema } from "./${basename}.schema.js";

export default class extends AmplifyMigration<Schema> {
  static override description = "${opts.name}";

  async up(ctx: MigrationContext<Schema>): Promise<void> {
    // TODO: implement forward migration
    ctx.logger.info("up not implemented");
  }

  async down(ctx: MigrationContext<Schema>): Promise<void> {
    // TODO: implement rollback
    ctx.logger.info("down not implemented");
  }
}
`;
  await writeFile(migrationPath, migrationSource, 'utf8');
  return { migrationPath, schemaSnapshotPath, name: basename };
}
