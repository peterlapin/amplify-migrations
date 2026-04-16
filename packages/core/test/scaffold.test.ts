import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { scaffoldMigration } from '../src/runner/scaffold.ts';

describe('scaffoldMigration', () => {
  it('creates paired migration + editable schema stub', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-sc-'));
    const res = await scaffoldMigration({
      dir,
      name: 'backfill owner',
      now: new Date(Date.UTC(2026, 3, 15, 12, 0, 0)),
    });
    assert.equal(res.name, 'Migration20260415120000-backfill-owner');
    const source = await readFile(res.migrationPath, 'utf8');
    assert.match(source, /extends AmplifyMigration<Schema>/);
    assert.match(source, new RegExp(`from ['"]\\./${res.name}\\.schema\\.js['"]`));
    const snap = await readFile(res.schemaSnapshotPath, 'utf8');
    assert.match(snap, /export type Schema/);
  });

  it('respects caller-supplied schemaSnapshotSource', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-sc-'));
    const res = await scaffoldMigration({
      dir,
      name: 'custom',
      schemaSnapshotSource:
        "export type Schema = { models: { Foo: { identifier: readonly ['id'] } } };",
    });
    const snap = await readFile(res.schemaSnapshotPath, 'utf8');
    assert.match(snap, /Foo/);
  });
});
