import { Runner, scaffoldMigration } from '@lapinsoft/data-migrations-core';
import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig } from './loadConfig.js';

// Allow `.ts` migration files to be imported at runtime when executed via the CLI.
await import('@swc-node/register/esm-register').catch(() => {
  /* optional */
});

const program = new Command();
program
  .name('amplify-migrations')
  .description('MikroORM-style migrations for AWS Amplify Data (Gen 2)')
  .version('1.0.0-alpha.0');

program
  .command('create <name>')
  .description('scaffold a new migration + editable schema type companion')
  .action(async (name: string) => {
    const cfg = await loadConfig();
    const res = await scaffoldMigration({ dir: cfg.migrationsDir, name });
    console.log(pc.green('created'), res.migrationPath);
    console.log(pc.green('created'), res.schemaSnapshotPath);
  });

program
  .command('up')
  .description('apply pending migrations')
  .option('--to <name>', 'run up to and including this migration')
  .option('--dry', "print the plan, don't execute")
  .option('--allow-checksum-mismatch', 'proceed even if applied migrations drifted on disk')
  .action(async (opts: { to?: string; dry?: boolean; allowChecksumMismatch?: boolean }) => {
    const runner = await Runner.create(await loadConfig());
    const result = await runner.up(opts);
    if (opts.dry) {
      console.log(pc.cyan('would run:'));
      for (const n of result.pending) console.log('  ', n);
    } else {
      for (const r of result.applied) console.log(pc.green('applied'), r.migrationName ?? r.name);
      if (result.applied.length === 0) console.log(pc.dim('nothing to do'));
    }
  });

program
  .command('down')
  .description('roll back migrations')
  .option('--steps <n>', 'number of migrations to roll back', (v) => Number.parseInt(v, 10), 1)
  .option('--to <name>', 'roll back until this migration is the newest applied')
  .option('--dry', "print the plan, don't execute")
  .option('--allow-checksum-mismatch', 'proceed even if the applied checksum differs from disk')
  .action(
    async (opts: {
      steps?: number;
      to?: string;
      dry?: boolean;
      allowChecksumMismatch?: boolean;
    }) => {
      const runner = await Runner.create(await loadConfig());
      const result = await runner.down(opts);
      if (opts.dry) {
        console.log(pc.cyan('would roll back:'));
        for (const n of result.pending) console.log('  ', n);
      } else {
        for (const r of result.applied)
          console.log(pc.yellow('rolled back'), r.migrationName ?? r.name);
      }
    },
  );

program
  .command('pending')
  .description('list pending migrations')
  .action(async () => {
    const runner = await Runner.create(await loadConfig());
    const pending = await runner.pending();
    if (pending.length === 0) console.log(pc.dim('no pending migrations'));
    for (const m of pending) console.log(' ', m.name);
  });

program
  .command('list')
  .description('list all migrations (disk + applied)')
  .action(async () => {
    const runner = await Runner.create(await loadConfig());
    const { disk, applied } = await runner.list();
    const appliedNames = new Set(applied.map((a) => a.migrationName ?? a.name));
    for (const m of disk) {
      const mark = appliedNames.has(m.name) ? pc.green('✓') : pc.dim('·');
      console.log(mark, m.name);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(pc.red('error:'), err.message);
  process.exit(1);
});
