import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Runner } from '../src/runner/runner.ts';
import type { SchemaShape } from '../src/types.ts';

type StateLike = {
  acquireLock: (holder: string, ttlSeconds: number) => Promise<unknown>;
  releaseLock: (holder: string) => Promise<void>;
  renewLock: (holder: string, ttlSeconds: number) => Promise<void>;
  listApplied: () => Promise<unknown[]>;
  nextBatch: () => Promise<number>;
  record: (record: unknown) => Promise<void>;
};

function makeRunnerState<S extends SchemaShape>(runner: Runner<S>): StateLike {
  return (runner as unknown as { state: StateLike }).state;
}

async function writeMigration(dir: string, name: string, body = ''): Promise<void> {
  await writeFile(
    join(dir, `${name}.mjs`),
    `export default class Migration {
      async up() { ${body} }
      async down() {}
    }`,
    'utf8',
  );
}

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
});

describe('Runner', () => {
  it('rejects unsafe lock TTLs at runner creation', async () => {
    await assert.rejects(
      () =>
        Runner.create(
          { migrationsDir: '/tmp/does-not-matter', lockTtlSeconds: 14 },
          { ddb: { send: async () => ({}) } as never },
        ),
      /lockTtlSeconds must be at least 15 seconds/,
    );
  });

  it('rejects unknown up --to targets during dry runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-runner-'));
    await writeMigration(dir, 'Migration20260415120000-order');

    const runner = await Runner.create(
      { migrationsDir: dir },
      { ddb: { send: async () => ({}) } as never },
    );

    await assert.rejects(
      () => runner.up({ dry: true, to: 'Migration20260415120000-missing' }),
      /Unknown migration target/,
    );
  });

  it('rejects unknown up --to targets and releases the lock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-runner-'));
    await writeMigration(dir, 'Migration20260415120000-order');

    const runner = await Runner.create(
      { migrationsDir: dir },
      { ddb: { send: async () => ({}) } as never },
    );
    const state = makeRunnerState(runner);

    let released = 0;
    state.acquireLock = async () => ({});
    state.listApplied = async () => [];
    state.nextBatch = async () => 1;
    state.record = async () => undefined;
    state.renewLock = async () => undefined;
    state.releaseLock = async () => {
      released += 1;
    };

    await assert.rejects(
      () => runner.up({ to: 'Migration20260415120000-missing' }),
      /Unknown migration target/,
    );
    assert.equal(released, 1);
  });

  it('rejects unknown down --to targets during dry runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-runner-'));
    const migrationName = 'Migration20260415120000-order';
    await writeMigration(dir, migrationName);

    const runner = await Runner.create(
      { migrationsDir: dir },
      { ddb: { send: async () => ({}) } as never },
    );
    const state = makeRunnerState(runner);
    state.listApplied = async () => [
      {
        name: `${migrationName}#up#2026-04-15T12:00:00.000Z`,
        migrationName,
        checksum: '1111111111111111111111111111111111111111111111111111111111111111',
        appliedAt: '2026-04-15T12:00:00.000Z',
        durationMs: 1,
        batch: 1,
        direction: 'up',
      },
    ];

    await assert.rejects(
      () => runner.down({ dry: true, to: 'Migration20260415120000-missing' }),
      /Unknown applied migration target/,
    );
  });

  it('rejects unknown down --to targets and releases the lock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-runner-'));
    const migrationName = 'Migration20260415120000-order';
    await writeMigration(dir, migrationName);

    const runner = await Runner.create(
      { migrationsDir: dir },
      { ddb: { send: async () => ({}) } as never },
    );
    const state = makeRunnerState(runner);

    let released = 0;
    state.acquireLock = async () => ({});
    state.listApplied = async () => [
      {
        name: `${migrationName}#up#2026-04-15T12:00:00.000Z`,
        migrationName,
        checksum: '1111111111111111111111111111111111111111111111111111111111111111',
        appliedAt: '2026-04-15T12:00:00.000Z',
        durationMs: 1,
        batch: 1,
        direction: 'up',
      },
    ];
    state.nextBatch = async () => 1;
    state.record = async () => undefined;
    state.renewLock = async () => undefined;
    state.releaseLock = async () => {
      released += 1;
    };

    await assert.rejects(
      () => runner.down({ to: 'Migration20260415120000-missing' }),
      /Unknown applied migration target/,
    );
    assert.equal(released, 1);
  });

  it('acquires the lock before reading applied migrations during up()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-runner-'));
    await writeMigration(dir, 'Migration20260415120000-order');

    const runner = await Runner.create(
      { migrationsDir: dir },
      { ddb: { send: async () => ({}) } as never },
    );
    const state = makeRunnerState(runner);
    const calls: string[] = [];

    state.acquireLock = async () => {
      calls.push('acquireLock');
      return {};
    };
    state.listApplied = async () => {
      calls.push('listApplied');
      return [];
    };
    state.nextBatch = async () => 1;
    state.record = async () => undefined;
    state.releaseLock = async () => {
      calls.push('releaseLock');
    };
    state.renewLock = async () => undefined;

    await runner.up();

    assert.ok(calls.indexOf('acquireLock') !== -1);
    assert.ok(calls.indexOf('listApplied') !== -1);
    assert.ok(calls.indexOf('acquireLock') < calls.indexOf('listApplied'));
  });

  it('renews the lock while a run is in progress', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-runner-'));
    await writeMigration(
      dir,
      'Migration20260415120000-heartbeat',
      'await new Promise((resolve) => setTimeout(resolve, 0));',
    );

    const runner = await Runner.create(
      { migrationsDir: dir, lockTtlSeconds: 15 },
      { ddb: { send: async () => ({}) } as never },
    );
    const state = makeRunnerState(runner);

    let renewCalls = 0;
    let cleared = false;
    let intervalMs = 0;
    const fakeTimer = {
      unref() {
        return fakeTimer;
      },
    } as unknown as NodeJS.Timeout;

    globalThis.setInterval = ((callback: Parameters<typeof setInterval>[0], delay?: number) => {
      intervalMs = Number(delay ?? 0);
      queueMicrotask(() => {
        if (typeof callback === 'function') callback();
      });
      return fakeTimer;
    }) as typeof setInterval;
    globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
      if (handle === fakeTimer) cleared = true;
    }) as typeof clearInterval;

    state.acquireLock = async () => ({});
    state.listApplied = async () => [];
    state.nextBatch = async () => 1;
    state.record = async () => undefined;
    state.releaseLock = async () => undefined;
    state.renewLock = async () => {
      renewCalls += 1;
    };

    await runner.up();

    assert.ok(renewCalls >= 1);
    assert.ok(cleared);
    assert.equal(intervalMs, 5_000);
  });

  it('releases the lock when checksum enforcement rejects the run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-runner-'));
    const migrationName = 'Migration20260415120000-drift';
    await writeMigration(dir, migrationName);

    const runner = await Runner.create(
      { migrationsDir: dir, checksumPolicy: 'strict' },
      { ddb: { send: async () => ({}) } as never },
    );
    const state = makeRunnerState(runner);

    let released = 0;
    state.acquireLock = async () => ({});
    state.listApplied = async () => [
      {
        name: `${migrationName}#up#2026-04-15T12:00:00.000Z`,
        migrationName,
        checksum: '0000000000000000000000000000000000000000000000000000000000000000',
        appliedAt: '2026-04-15T12:00:00.000Z',
        durationMs: 1,
        batch: 1,
        direction: 'up',
      },
    ];
    state.nextBatch = async () => 1;
    state.record = async () => undefined;
    state.renewLock = async () => undefined;
    state.releaseLock = async () => {
      released += 1;
    };

    await assert.rejects(() => runner.up(), /Refusing to run/);
    assert.equal(released, 1);
  });
});
