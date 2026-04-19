import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import pino, { type Logger } from 'pino';
import { readAmplifyOutputs } from '../config/outputs.js';
import { createContext } from '../context/context.js';
import { type DiscoveredMigration, discoverMigrations } from '../loader/loader.js';
import { StateStore } from '../state/store.js';
import type {
  MigrationContext,
  MigrationRecord,
  MigrationsConfig,
  ModelName,
  SchemaShape,
} from '../types.js';

export interface UpOptions {
  to?: string;
  dry?: boolean;
  /** Proceed even if an applied migration's on-disk checksum has drifted. */
  allowChecksumMismatch?: boolean;
}
export interface DownOptions {
  steps?: number;
  to?: string;
  dry?: boolean;
  allowChecksumMismatch?: boolean;
}

export interface RunResult {
  applied: MigrationRecord[];
  pending: string[];
  skipped: string[];
  warnings: string[];
}

const MIN_LOCK_TTL_SECONDS = 15;

export class Runner<S extends SchemaShape = SchemaShape> {
  private readonly logger: Logger;
  private readonly ddb: DynamoDBDocumentClient;
  private readonly state: StateStore;
  private readonly stateTableName: string;
  private readonly modelTables: Readonly<Record<ModelName<S>, string>>;
  private readonly lockTtl: number;
  private readonly holderId: string;

  private constructor(
    private readonly config: MigrationsConfig<S>,
    ddb: DynamoDBDocumentClient,
    stateTableName: string,
    modelTables: Readonly<Record<ModelName<S>, string>>,
  ) {
    this.logger = config.logger ?? pino({ name: 'amplify-migrations' });
    this.ddb = ddb;
    this.stateTableName = stateTableName;
    this.modelTables = modelTables;
    this.state = new StateStore(ddb, stateTableName);
    this.lockTtl = config.lockTtlSeconds ?? 600;
    this.holderId = `${hostname()}#${process.pid}#${randomUUID()}`;
  }

  static async create<S extends SchemaShape = SchemaShape>(
    config: MigrationsConfig<S>,
    deps?: { ddb?: DynamoDBDocumentClient },
  ): Promise<Runner<S>> {
    const lockTtlSeconds = config.lockTtlSeconds ?? 600;
    if (lockTtlSeconds < MIN_LOCK_TTL_SECONDS) {
      throw new Error(
        `lockTtlSeconds must be at least ${MIN_LOCK_TTL_SECONDS} seconds so the advisory lock can be renewed before it expires.`,
      );
    }

    let stateTableName: string | undefined;
    let modelTables: Record<string, string> = {};
    let region = config.region;

    if (config.outputsPath) {
      try {
        const outputs = await readAmplifyOutputs(config.outputsPath);
        region ??= outputs.data?.aws_region ?? outputs.auth?.aws_region;
        const custom = outputs.custom?.amplifyMigrations;
        if (custom) {
          stateTableName = custom.stateTable;
          if (custom.tables) modelTables = { ...custom.tables };
        }
      } catch (err) {
        console.warn(
          `amplify-migrations: could not read ${config.outputsPath}: ${(err as Error).message}`,
        );
      }
    }

    if (config.tables) {
      modelTables = { ...modelTables, ...(config.tables as Record<string, string>) };
    }
    stateTableName ??= config.stateTable ?? 'AmplifyMigration';
    region ??= process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;

    const ddb =
      deps?.ddb ??
      DynamoDBDocumentClient.from(new DynamoDBClient(region ? { region } : {}), {
        marshallOptions: { removeUndefinedValues: true },
      });

    return new Runner<S>(
      config,
      ddb,
      stateTableName,
      modelTables as Readonly<Record<ModelName<S>, string>>,
    );
  }

  async pending(): Promise<DiscoveredMigration<S>[]> {
    const [disk, applied] = await Promise.all([
      discoverMigrations<S>(this.config.migrationsDir),
      this.state.listApplied(),
    ]);
    const appliedNames = new Set(applied.map((r) => r.migrationName ?? r.name));
    return disk.filter((m) => !appliedNames.has(m.name));
  }

  async list(): Promise<{ disk: DiscoveredMigration<S>[]; applied: MigrationRecord[] }> {
    const [disk, applied] = await Promise.all([
      discoverMigrations<S>(this.config.migrationsDir),
      this.state.listApplied(),
    ]);
    return { disk, applied };
  }

  /** Returns a list of warnings if applied migrations have drifted on disk. */
  async checksumDrift(): Promise<string[]> {
    const { disk, applied } = await this.list();
    return this.checksumDriftFrom(disk, applied);
  }

  async up(opts: UpOptions = {}): Promise<RunResult> {
    if (opts.dry) {
      const { disk, applied } = await this.list();
      this.assertKnownUpTarget(opts.to, disk);
      const pending = this.pendingFrom(disk, applied);
      const upTo = opts.to;
      const toRun = upTo ? pending.filter((m) => m.name <= upTo) : pending;
      return {
        applied: [],
        pending: toRun.map((m) => m.name),
        skipped: [],
        warnings: this.checksumDriftFrom(disk, applied),
      };
    }

    // Acquire lock FIRST so our pending-set read is consistent with the run.
    await this.state.acquireLock(this.holderId, this.lockTtl);
    const applied: MigrationRecord[] = [];
    let warnings: string[] = [];
    let heartbeat: NodeJS.Timeout | undefined;
    let lockLostReason: string | undefined;
    try {
      const { disk, applied: alreadyApplied } = await this.list();
      this.assertKnownUpTarget(opts.to, disk);
      warnings = this.checksumDriftFrom(disk, alreadyApplied);
      this.enforceChecksumPolicy(warnings, opts.allowChecksumMismatch);
      heartbeat = this.startHeartbeat((reason) => {
        lockLostReason = reason;
      });
      const pending = this.pendingFrom(disk, alreadyApplied);
      const upTo = opts.to;
      const toRun = upTo ? pending.filter((m) => m.name <= upTo) : pending;
      const batch = await this.state.nextBatch();
      for (const m of toRun) {
        if (lockLostReason) {
          throw new Error(`Aborting: migration lock was lost (${lockLostReason})`);
        }
        const record = await this.runOne(m, 'up', batch);
        applied.push(record);
      }
      return { applied, pending: [], skipped: [], warnings };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await this.state.releaseLock(this.holderId);
    }
  }

  async down(opts: DownOptions = {}): Promise<RunResult> {
    if (opts.dry) {
      const { applied } = await this.list();
      this.assertKnownDownTarget(opts.to, applied);
      const mname = (r: MigrationRecord) => r.migrationName ?? r.name;
      const sorted = [...applied].sort((a, b) => mname(b).localeCompare(mname(a)));
      const downTo = opts.to;
      const targets = downTo
        ? sorted.filter((r) => mname(r) > downTo)
        : sorted.slice(0, opts.steps ?? 1);
      return { applied: [], pending: targets.map(mname), skipped: [], warnings: [] };
    }

    await this.state.acquireLock(this.holderId, this.lockTtl);
    let lockLostReason: string | undefined;
    const heartbeat = this.startHeartbeat((reason) => {
      lockLostReason = reason;
    });
    const results: MigrationRecord[] = [];
    try {
      const { disk, applied } = await this.list();
      this.assertKnownDownTarget(opts.to, applied);
      const diskByName = new Map(disk.map((m) => [m.name, m]));
      const mname = (r: MigrationRecord) => r.migrationName ?? r.name;
      const sorted = [...applied].sort((a, b) => mname(b).localeCompare(mname(a)));
      const downTo = opts.to;
      const targets = downTo
        ? sorted.filter((r) => mname(r) > downTo)
        : sorted.slice(0, opts.steps ?? 1);

      const batch = await this.state.nextBatch();
      for (const r of targets) {
        if (lockLostReason) {
          throw new Error(`Aborting: migration lock was lost (${lockLostReason})`);
        }
        const found = diskByName.get(mname(r));
        if (!found) {
          throw new Error(
            `Cannot down "${mname(r)}": file not found in ` +
              `${this.config.migrationsDir}. Restore the file before rolling back.`,
          );
        }
        if (r.checksum && found.checksum !== r.checksum) {
          const applied = r.checksum.slice(0, 12);
          const disk = found.checksum.slice(0, 12);
          const msg = `checksum drift for "${mname(r)}": applied ${applied} disk ${disk}`;
          this.enforceChecksumPolicy([msg], opts.allowChecksumMismatch);
        }
        const rec = await this.runOne(found, 'down', batch);
        results.push(rec);
      }
    } finally {
      clearInterval(heartbeat);
      await this.state.releaseLock(this.holderId);
    }
    return { applied: results, pending: [], skipped: [], warnings: [] };
  }

  private pendingFrom(
    disk: DiscoveredMigration<S>[],
    applied: MigrationRecord[],
  ): DiscoveredMigration<S>[] {
    const appliedNames = new Set(applied.map((r) => r.migrationName ?? r.name));
    return disk.filter((m) => !appliedNames.has(m.name));
  }

  private assertKnownUpTarget(target: string | undefined, disk: DiscoveredMigration<S>[]): void {
    if (!target) return;
    if (disk.some((m) => m.name === target)) return;
    const available = disk.map((m) => m.name);
    throw new Error(
      `Unknown migration target "${target}". Available on disk: ${available.join(', ') || '(none)'}`,
    );
  }

  private assertKnownDownTarget(target: string | undefined, applied: MigrationRecord[]): void {
    if (!target) return;
    const appliedNames = [...new Set(applied.map((r) => r.migrationName ?? r.name))];
    if (appliedNames.includes(target)) return;
    throw new Error(
      `Unknown applied migration target "${target}". Currently applied: ${appliedNames.join(', ') || '(none)'}`,
    );
  }

  /** Applies the configured ChecksumPolicy to a set of drift warnings. */
  private enforceChecksumPolicy(warnings: string[], allowOverride?: boolean): void {
    if (warnings.length === 0) return;
    const policy = this.config.checksumPolicy ?? 'off';
    if (policy === 'off' || allowOverride) return;
    if (policy === 'warn') {
      for (const w of warnings) this.logger.warn(w);
      return;
    }
    // strict
    const detail = warnings.join('\n  ');
    throw new Error(
      `Refusing to run: ${warnings.length} applied migration(s) have drifted on disk.\n  ${detail}\nPass --allow-checksum-mismatch, relax checksumPolicy, or restore the files.`,
    );
  }

  private checksumDriftFrom(disk: DiscoveredMigration<S>[], applied: MigrationRecord[]): string[] {
    const byName = new Map(disk.map((d) => [d.name, d]));
    const warnings: string[] = [];
    for (const rec of applied) {
      const mname = rec.migrationName ?? rec.name;
      const d = byName.get(mname);
      if (d && rec.checksum && d.checksum !== rec.checksum) {
        const appliedChecksum = rec.checksum.slice(0, 12);
        const diskChecksum = d.checksum.slice(0, 12);
        warnings.push(
          `checksum drift for "${mname}": applied ${appliedChecksum} disk ${diskChecksum}`,
        );
      }
    }
    return warnings;
  }

  /**
   * Renews the lock at 1/3 of the TTL so long migrations don't lose it.
   * Returns a handle the caller must clear before releasing the lock.
   * After two consecutive renewal failures we consider the lock lost and
   * invoke the supplied `onLost` callback — the caller is expected to abort.
   */
  private startHeartbeat(onLost: (reason: string) => void): NodeJS.Timeout {
    const intervalMs = Math.min(5_000, (this.lockTtl * 1000) / 3);
    let consecutiveFailures = 0;
    return setInterval(() => {
      this.state.renewLock(this.holderId, this.lockTtl).then(
        () => {
          consecutiveFailures = 0;
        },
        (err) => {
          consecutiveFailures += 1;
          const msg = (err as Error).message;
          this.logger.warn({ err: msg, consecutiveFailures }, 'lock renewal failed');
          if (consecutiveFailures >= 2) onLost(msg);
        },
      );
    }, intervalMs).unref();
  }

  private async runOne(
    m: DiscoveredMigration<S>,
    direction: 'up' | 'down',
    batch: number,
  ): Promise<MigrationRecord> {
    const child = this.logger.child({ migration: m.name, direction });
    child.info('starting');
    const t0 = Date.now();

    const Ctor = await m.load();
    const instance = new Ctor();
    const ctx: MigrationContext<S> = createContext<S>({
      ddb: this.ddb,
      tables: this.modelTables,
      logger: child,
    });

    if (direction === 'up') await instance.up(ctx);
    else await instance.down(ctx);

    const durationMs = Date.now() - t0;
    const record: MigrationRecord = {
      name: m.name,
      migrationName: m.name,
      checksum: m.checksum,
      appliedAt: new Date().toISOString(),
      durationMs,
      batch,
      direction,
    };
    await this.state.record(record);
    child.info({ durationMs }, 'completed');
    return record;
  }
}
