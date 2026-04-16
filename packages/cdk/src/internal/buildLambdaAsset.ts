import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveBundledHandlerEntry(moduleDir: string): string {
  return resolve(moduleDir, 'runtime/runnerHandler.js');
}

/**
 * esbuild-backed bundler: compiles the handler and each migration file into
 * runnable CommonJS so Lambda can load it directly.
 */
export function buildLambdaAsset(migrationsDir: string, moduleDir: string): string {
  const req = createRequire(import.meta.url);
  const esbuild = req('esbuild') as typeof import('esbuild');
  const out = mkdtempSync(join(tmpdir(), 'amplify-migrations-'));
  mkdirSync(join(out, 'migrations'), { recursive: true });

  esbuild.buildSync({
    entryPoints: [resolveBundledHandlerEntry(moduleDir)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: join(out, 'handler.js'),
    external: ['aws-sdk'],
    sourcemap: 'inline',
  });

  for (const entry of readdirSync(migrationsDir)) {
    if (!/^Migration\d{14}.*\.(ts|mts|js|mjs)$/.test(entry)) continue;
    if (/\.schema\.(ts|js)$/.test(entry)) continue;
    const sourcePath = resolve(migrationsDir, entry);
    const outBasename = entry.replace(/\.(ts|mts|mjs)$/, '.js');
    esbuild.buildSync({
      entryPoints: [sourcePath],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      outfile: join(out, 'migrations', outBasename),
      external: ['aws-sdk'],
      sourcemap: 'inline',
    });

    const sourceHash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
    writeFileSync(
      join(out, 'migrations', `${outBasename.replace(/\.js$/, '')}.sha256`),
      sourceHash,
    );
  }

  writeFileSync(join(out, '.amplify-migrations-asset'), 'v1');
  return out;
}
