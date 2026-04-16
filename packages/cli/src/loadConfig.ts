import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MigrationsConfig } from '@amplify-migrations/core';

const CANDIDATES = [
  'amplify-migrations.config.ts',
  'amplify-migrations.config.js',
  'amplify-migrations.config.mjs',
];

export async function loadConfig(cwd: string = process.cwd()): Promise<MigrationsConfig> {
  for (const c of CANDIDATES) {
    const abs = resolve(cwd, c);
    if (existsSync(abs)) {
      if (c.endsWith('.ts')) {
        try {
          await import('@swc-node/register/esm-register');
        } catch {
          throw new Error(
            `Found ${c} but @swc-node/register is not installed.\nAdd it to your project: pnpm add -D @swc-node/register\nOr rename the file to amplify-migrations.config.js / .mjs.`,
          );
        }
      }
      const mod = await import(pathToFileURL(abs).href);
      const cfg = mod.default ?? mod.config;
      if (!cfg) throw new Error(`Config ${c} must have a default export`);
      return cfg;
    }
  }
  // Fall back to sensible defaults.
  return {
    migrationsDir: resolve(cwd, 'amplify/migrations'),
    outputsPath: resolve(cwd, 'amplify_outputs.json'),
  };
}
