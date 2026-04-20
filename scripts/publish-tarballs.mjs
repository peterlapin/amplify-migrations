import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : 'next';

const publishablePackages = ['packages/core', 'packages/cli', 'packages/cdk'];

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    if (options.capture) {
      const stderr = (result.stderr || result.stdout || '').trim();
      const error = new Error(stderr || `${command} ${commandArgs.join(' ')} failed`);
      error.status = result.status;
      throw error;
    }
    process.exit(result.status ?? 1);
  }

  return result.stdout?.trim() ?? '';
}

function normalizeTarballName(packageName, version) {
  return `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
}

function isMissingVersionError(message) {
  return message.includes('E404') || message.includes('404 Not Found');
}

for (const packageDir of publishablePackages) {
  const manifestPath = join(repoRoot, packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const tarballPath = join(
    repoRoot,
    '.tmp/pack',
    normalizeTarballName(manifest.name, manifest.version),
  );

  if (!existsSync(tarballPath)) {
    throw new Error(`Missing tarball for ${manifest.name}: ${tarballPath}`);
  }

  let alreadyPublished = false;
  try {
    run('npm', ['view', `${manifest.name}@${manifest.version}`, 'version', '--json'], {
      capture: true,
    });
    alreadyPublished = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isMissingVersionError(message)) {
      throw error;
    }
  }

  if (alreadyPublished) {
    console.log(`Skipping ${manifest.name}@${manifest.version}; version already exists on npm.`);
    continue;
  }

  const publishArgs = ['publish', tarballPath, '--access', 'public', '--tag', tag];
  if (dryRun) publishArgs.push('--dry-run');

  console.log(`Publishing ${manifest.name}@${manifest.version} from ${tarballPath}`);
  run('npm', publishArgs);
}
