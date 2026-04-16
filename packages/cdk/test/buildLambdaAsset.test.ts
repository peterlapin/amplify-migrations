import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildLambdaAsset } from '../src/internal/buildLambdaAsset.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('buildLambdaAsset', () => {
  it('bundles the handler and transpiles TypeScript migrations to runnable JS', async () => {
    const migrationsDir = await mkdtemp(join(tmpdir(), 'am-cdk-'));
    const name = 'Migration20260415120000-seed';
    await writeFile(
      join(migrationsDir, `${name}.ts`),
      `const message: string = 'ok';
export default class Migration {
  async up(): Promise<string> { return message; }
  async down(): Promise<void> {}
}
`,
      'utf8',
    );

    const assetDir = buildLambdaAsset(migrationsDir, resolve(__dirname, '../src'));
    const bundledMigration = join(assetDir, 'migrations', `${name}.js`);
    const checksumFile = join(assetDir, 'migrations', `${name}.sha256`);

    assert.ok(existsSync(join(assetDir, '.amplify-migrations-asset')));
    assert.ok(existsSync(join(assetDir, 'handler.js')));
    assert.ok(existsSync(bundledMigration));
    assert.ok(existsSync(checksumFile));

    const source = await readFile(bundledMigration, 'utf8');
    assert.ok(!source.includes('const message: string'));

    const req = createRequire(import.meta.url);
    const mod = req(bundledMigration);
    const Ctor = mod.default ?? mod;
    const instance = new Ctor();
    assert.equal(await instance.up(), 'ok');
  });
});
