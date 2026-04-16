import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/loadConfig.ts';

describe('loadConfig', () => {
  it('returns the default paths when no config file exists', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'am-cli-'));
    const cfg = await loadConfig(cwd);

    assert.deepEqual(cfg, {
      migrationsDir: resolve(cwd, 'amplify/migrations'),
      outputsPath: resolve(cwd, 'amplify_outputs.json'),
    });
  });

  it('loads config from amplify-migrations.config.mjs', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'am-cli-'));
    await writeFile(
      resolve(cwd, 'amplify-migrations.config.mjs'),
      `export default { migrationsDir: './custom/migrations', outputsPath: './custom/amplify_outputs.json' };`,
      'utf8',
    );

    const cfg = await loadConfig(cwd);

    assert.deepEqual(cfg, {
      migrationsDir: './custom/migrations',
      outputsPath: './custom/amplify_outputs.json',
    });
  });
});
