import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CustomResource, Duration, RemovalPolicy, type Stack, Tags } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AmplifyBackendLike {
  stack: Stack;
  data: {
    resources: {
      tables: Record<string, { tableName: string; tableArn: string }>;
    };
  };
  addOutput(output: Record<string, unknown>): void;
  createStack(name: string): Stack;
}

export interface WithMigrationsOptions {
  /** Absolute path to the migrations directory to bundle into the runner Lambda. */
  migrationsDir: string;
  /** Behaviour on deploy. Default: "pending" (run pending migrations). */
  runOnDeploy?: 'pending' | 'off';
  /** Lambda timeout; default 15 minutes. */
  timeout?: Duration;
  /** Retention policy for the internal state table. Defaults to RETAIN. */
  stateTableRemovalPolicy?: RemovalPolicy;
  /**
   * How the runner should react to an applied migration whose on-disk bytes
   * have changed. Defaults to "off" (silent). Set to "strict" for the
   * paranoid-by-default behaviour used by MikroORM/Flyway/etc.
   */
  checksumPolicy?: 'off' | 'warn' | 'strict';
  /**
   * Explicit physical name for the state table. Defaults to CDK auto-naming
   * (which produces long hashed names like `amplify-foo-sandbox-xxx-Amplify
   * MigrationsXXX-StateTableXXX-XXX`).
   *
   * Trade-off: a fixed name is cleaner to read but prevents CloudFormation
   * from replacing the table without conflict. If you ever need to recreate
   * it (e.g. after DELETEing the stack with `RETAIN` retention) you'll hit
   * a naming collision. Only set this in environments where you control the
   * full lifecycle (a personal sandbox, a single prod).
   */
  stateTableName?: string;
  /**
   * Extra tags to apply to every resource `withMigrations()` creates
   * (nested stack, state table, runner Lambda, IAM role). These are layered
   * on top of whatever tags have been propagated from the parent Amplify
   * backend stack.
   *
   * Set to `false` to skip auto-inheriting the parent stack's tags.
   */
  tags?: Record<string, string> | false;
  /**
   * Pre-built Lambda asset directory. Supply this when you want to control
   * the bundler yourself; otherwise `withMigrations` uses esbuild at synth
   * time to produce a handler + per-migration bundles.
   */
  prebuiltAssetDir?: string;
}

/**
 * Wires the migration runner into an Amplify Gen 2 backend:
 *   - Creates an internal DynamoDB state table in a dedicated nested stack
 *     (not declared as an Amplify model — stays out of your GraphQL API).
 *   - Bundles the migrations folder + runner handler into a Lambda asset.
 *   - Grants the Lambda read/write on every Amplify-managed data table plus the state table.
 *   - Registers a CloudFormation CustomResource that runs on Create/Update only.
 *   - Publishes state-table + data-table mappings into `amplify_outputs.json`.
 */
export function withMigrations(backend: AmplifyBackendLike, opts: WithMigrationsOptions): void {
  const runOnDeploy = opts.runOnDeploy ?? 'pending';
  const migrationStack = backend.createStack('AmplifyMigrations');

  // Tag propagation:
  // 1. Inherit every tag already on the parent Amplify backend stack
  //    (Amplify adds things like `amplify:app-id`, `amplify:branch`, and any
  //    customer-defined tags on the App/Stage flow down here).
  // 2. Layer the user-supplied `tags` on top so they win on collisions.
  if (opts.tags !== false) {
    const parentTags = backend.stack.tags.tagValues();
    for (const [k, v] of Object.entries(parentTags)) {
      Tags.of(migrationStack).add(k, v);
    }
  }
  if (opts.tags && typeof opts.tags === 'object') {
    for (const [k, v] of Object.entries(opts.tags)) {
      Tags.of(migrationStack).add(k, v);
    }
  }

  const stateTable = new Table(migrationStack, 'StateTable', {
    partitionKey: { name: 'name', type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'expiresAt',
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    removalPolicy: opts.stateTableRemovalPolicy ?? RemovalPolicy.RETAIN,
    ...(opts.stateTableName ? { tableName: opts.stateTableName } : {}),
  });

  const dataTables = backend.data.resources.tables;
  const tableMap: Record<string, string> = {};
  for (const [model, ref] of Object.entries(dataTables)) tableMap[model] = ref.tableName;

  const assetDir = opts.prebuiltAssetDir ?? buildLambdaAsset(opts.migrationsDir);

  const runner = new LambdaFunction(migrationStack, 'RunnerFn', {
    runtime: Runtime.NODEJS_20_X,
    handler: 'handler.handler',
    code: Code.fromAsset(assetDir),
    timeout: opts.timeout ?? Duration.minutes(15),
    memorySize: 1024,
    environment: {
      AM_STATE_TABLE: stateTable.tableName,
      AM_TABLES_JSON: JSON.stringify(tableMap),
      AM_MIGRATIONS_DIR: '/var/task/migrations',
      AM_RUN_MODE: runOnDeploy,
      AM_CHECKSUM_POLICY: opts.checksumPolicy ?? 'off',
    },
  });

  stateTable.grantReadWriteData(runner);

  const dataTableArns = Object.values(dataTables).flatMap((ref) => [
    ref.tableArn,
    `${ref.tableArn}/index/*`,
  ]);
  if (dataTableArns.length > 0) {
    runner.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Scan',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:TransactWriteItems',
          'dynamodb:TransactGetItems',
        ],
        resources: dataTableArns,
      }),
    );
  }

  if (runOnDeploy !== 'off') {
    const provider = new Provider(migrationStack, 'RunnerProvider', { onEventHandler: runner });
    new CustomResource(migrationStack, 'RunOnDeploy', {
      serviceToken: provider.serviceToken,
      // Change on every synth so CFN triggers an Update; Delete events are
      // short-circuited inside the handler.
      properties: { nonce: Date.now().toString() },
    });
  }

  backend.addOutput({
    custom: {
      amplifyMigrations: {
        stateTable: stateTable.tableName,
        tables: tableMap,
        version: '1.0.0-alpha.0',
      },
    },
  });
}

/**
 * esbuild-backed bundler: compiles the handler and each migration file into
 * plain ESM JS inside a temp directory that Lambda can load directly.
 * We require esbuild lazily so the CDK package doesn't force it on users who
 * supply a `prebuiltAssetDir`.
 */
function buildLambdaAsset(migrationsDir: string): string {
  // We run under both tsup's bundle (where `require` exists in the cjs
  // emission) and directly under ESM via ampx. Prefer createRequire so it
  // works in both modes.
  const req = createRequire(import.meta.url);
  const esbuild = req('esbuild') as typeof import('esbuild');
  const out = mkdtempSync(join(tmpdir(), 'amplify-migrations-'));
  mkdirSync(join(out, 'migrations'), { recursive: true });

  const handlerEntry = resolve(__dirname, 'runtime/runnerHandler.js');
  esbuild.buildSync({
    entryPoints: [handlerEntry],
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

    // Write the source checksum as a sidecar so the runtime loader records
    // the same hash the CLI sees on disk — otherwise esbuild's bundled
    // output would have a different hash and checksum-drift checks would
    // always fail.
    const sourceHash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
    writeFileSync(
      join(out, 'migrations', `${outBasename.replace(/\.js$/, '')}.sha256`),
      sourceHash,
    );
  }

  // Marker file so we can assert the asset layout in tests.
  writeFileSync(join(out, '.amplify-migrations-asset'), 'v1');
  return out;
}
