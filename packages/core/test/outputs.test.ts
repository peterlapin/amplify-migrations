import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readAmplifyOutputs } from '../src/config/outputs.ts';

describe('readAmplifyOutputs', () => {
  it('preserves extensible output fields and string table mappings', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'am-outputs-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'outputs.json');
    const outputs = {
      version: '1.4',
      auth: { aws_region: 'eu-central-1', user_pool_id: 'pool' },
      data: { url: 'https://example.test/graphql', custom_setting: true },
      custom: {
        otherFeature: { enabled: true },
        amplifyMigrations: { stateTable: 'state', tables: { Todo: 'todo-table' } },
      },
    };
    await writeFile(path, JSON.stringify(outputs));
    assert.deepEqual(await readAmplifyOutputs(path), outputs);
  });

  it('rejects non-string table names', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'am-outputs-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'outputs.json');
    await writeFile(
      path,
      JSON.stringify({
        custom: { amplifyMigrations: { stateTable: 'state', tables: { Todo: 42 } } },
      }),
    );
    await assert.rejects(readAmplifyOutputs(path), { name: 'ZodError' });
  });
});
