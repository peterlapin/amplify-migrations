import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    '--no-warnings',
    '--import',
    new URL('./register-typescript.mjs', import.meta.url).href,
    '--test',
    '--test-reporter=spec',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
