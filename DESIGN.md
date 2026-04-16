# amplify-migrations

A [MikroORM][mikro-orm]-style database migration framework for **[AWS Amplify Data (Gen 2)][amplify-data]**, targeting the DynamoDB tables Amplify generates from your `a.schema(...)` definition.

[mikro-orm]: https://github.com/mikro-orm/mikro-orm
[amplify-data]: https://docs.amplify.aws/react/build-a-backend/data/
[amplify-gen2]: https://docs.amplify.aws/react/build-a-backend/

---

## 1. Why this library exists

[Amplify Gen 2][amplify-gen2] is declarative: you edit `amplify/data/resource.ts`, push, and CloudFormation reshapes the DynamoDB tables. That works until you need **data** changes that can't be expressed as schema changes:

- Backfilling a new required attribute onto existing items
- Splitting or merging models (copy items, rewrite keys)
- Renaming an attribute without data loss
- Seeding reference data on first deploy
- One-off cleanups tied to a specific release

Amplify has no built-in answer. Teams today either write ad-hoc Lambda scripts or run scripts from a laptop. This library gives Amplify the migration ergonomics that [MikroORM][mikro-orm] users expect: a `migrations/` folder, `up`/`down`, a state table, and a CLI — with first-class support for the Amplify backend context (IAM creds, table names from `amplify_outputs.json`, CDK resource refs).

---

## 2. Design goals

1. **Drop-in for [Amplify Gen 2][amplify-gen2].** Works with `defineBackend`, reads generated table names from the CDK backend object, no manual ARN plumbing.
2. **Familiar to MikroORM users.** Timestamped files, class-based migrations with `up()` / `down()`, CLI with `create`, `up`, `down`, `pending`, `list`, `fresh`.
3. **Safe on DynamoDB.** Idempotent, resumable, uses `ConditionExpression` for locking. Never relies on relational transactions that DDB can't provide.
4. **Runs everywhere.** Local dev (AWS SDK v3 with your profile), CI (assumed role), in-cluster (Lambda invoked by a CDK custom resource on deploy).
5. **Typed end-to-end.** Migration `up(ctx)` receives a typed `ctx` with the Amplify schema's models, so you get autocomplete for table names and item shapes.
6. **No vendor lock to MikroORM.** We borrow the pattern, not the dependency.

Non-goals: generating migrations by diffing Amplify schemas (Amplify/CDK already diffs infra), SQL backends, GraphQL-side migrations (resolver changes are code).

---

## 3. How it compares

| Concern | MikroORM | amplify-migrations |
|---|---|---|
| File naming | `Migration20240101120000.ts` | same |
| Class shape | `extends Migration` with `up/down` | `extends AmplifyMigration` with `up(ctx)/down(ctx)` |
| State | `mikro_orm_migrations` SQL table | `AmplifyMigration` DynamoDB table (defined as an Amplify model) |
| Transactions | Wrap batch in one SQL tx | Per-migration `TransactWriteItems` where possible; advisory lock item for the whole run |
| Diff generation | Entity → SQL autogenerate | Not included (CDK handles schema infra); `create` scaffolds a blank file |
| Config | `mikro-orm.config.ts` | `amplify-migrations.config.ts`, or inline inside `amplify/backend.ts` |

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  amplify/data/resource.ts      (user's Amplify schema)       │
│  amplify/backend.ts            (user calls withMigrations()) │
└───────────────┬──────────────────────────────────────────────┘
                │ CDK resource refs (table names, IAM role)
                ▼
┌──────────────────────────────────────────────────────────────┐
│  @lapinsoft/data-migrations-core                             │
│                                                              │
│   Runner ──► StateStore (DDB)       MigrationLoader (fs)     │
│     │          │                         │                   │
│     │          ▼                         ▼                   │
│     │     Lock item (PK=__lock__)   ./migrations/*.ts        │
│     ▼                                                        │
│   MigrationContext { ddb, tables, schema, logger }           │
└──────────────────────────────────────────────────────────────┘
                │
                ├── @lapinsoft/data-migrations-cli   (local dev, CI)
                └── @lapinsoft/data-migrations-cdk   (auto-run on deploy
                                                via CustomResource)
```

### Package layout (monorepo, pnpm workspaces)

```
amplify-migrations/
├── packages/
│   ├── core/          # Runner, StateStore, context, types — zero CLI deps
│   ├── cli/           # `amplify-migrations` bin, uses core
│   └── cdk/           # CDK construct: wraps a Lambda that calls core
├── examples/
│   └── gen2-todo/     # Minimal Amplify Gen 2 project using the library
└── DESIGN.md
```

Publishing the runner separately from the CLI keeps Lambda bundles small — the deploy-time construct only needs `core`.

---

## 5. Public API

### 5.1 Config

```ts
// amplify-migrations.config.ts
import { defineMigrationsConfig } from "@lapinsoft/data-migrations-core";

export default defineMigrationsConfig({
  migrationsDir: "./amplify/migrations",
  outputsPath: "./amplify_outputs.json", // state-table name is read from here
  lockTtlSeconds: 600,
});
```

The state table's physical name is never hardcoded; `withMigrations()` writes it into `amplify_outputs.json` under `custom.amplifyMigrations.stateTable` at deploy time, and the CLI reads it back.

`defineMigrationsConfig` is generic over the user's `Schema` so migration authors get typed `ctx.models.Todo` access downstream.

### 5.2 Writing a migration

```ts
// amplify/migrations/Migration20260415120000-backfill-todo-owner.ts
import { AmplifyMigration, type MigrationContext } from "@lapinsoft/data-migrations-core";
// Schema is imported from the FROZEN sibling snapshot, not from
// `../data/resource`. See §5.5 for why.
import type { Schema } from "./Migration20260415120000-backfill-todo-owner.schema.js";

export default class extends AmplifyMigration<Schema> {
  static override description = "Backfill Todo.owner from legacy createdBy";

  async up(ctx: MigrationContext<Schema>) {
    for await (const todo of ctx.scan("Todo")) {
      const t = todo as { id: string; owner?: string; createdBy?: string };
      if (!t.owner && t.createdBy) {
        await ctx.update("Todo", { id: t.id }, { owner: t.createdBy });
      }
    }
  }

  async down(ctx: MigrationContext<Schema>) {
    for await (const todo of ctx.scan("Todo")) {
      const t = todo as { id: string };
      await ctx.update("Todo", { id: t.id }, { owner: null });
    }
  }
}
```

`MigrationContext` exposes a thin, typed façade over the AWS SDK v3 `DynamoDBDocumentClient`:

- `ctx.get(model, key)`, `ctx.put(model, item)`, `ctx.update(model, key, patch)`, `ctx.delete(model, key)`
- `ctx.scan(model, opts?)` — async iterator, auto-paginates
- `ctx.transact([...ops])` — compiled to `TransactWriteItems`
- `ctx.raw` — escape hatch returning the underlying `DynamoDBDocumentClient` (use this for `Query`, BatchGet, etc.)
- `ctx.tables.Todo` — resolved physical table name
- `ctx.logger`, `ctx.abortSignal`

Planned for later releases: dedicated `ctx.query()` with `KeyConditionExpression` helpers, `ctx.putIfAbsent()`, `ctx.updateIfMatches()`.

Model names are literal union types derived from `Schema`, so typos fail at compile time.

### 5.3 Wiring into Amplify

```ts
// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend";
import { withMigrations } from "@lapinsoft/data-migrations-cdk";
import { auth } from "./auth/resource";
import { data } from "./data/resource";

const backend = defineBackend({ auth, data });

// Adds: migration state model, deploy-time Lambda, CustomResource, IAM grants
withMigrations(backend, {
  migrationsDir: "./amplify/migrations",
  runOnDeploy: "pending",   // "pending" | "off"
});
```

Under the hood, `withMigrations`:

1. Creates a nested `AmplifyMigrations` stack and provisions a private DynamoDB state table inside it (not exposed through the Amplify schema — stays out of GraphQL/ClientSchema).
2. Bundles the `migrations/` folder into a Lambda.
3. Grants that Lambda IAM read/write on every table in `backend.data.resources.tables` plus the state table.
4. Adds a CloudFormation `CustomResource` that invokes the Lambda on every deploy; the Lambda runs `runner.up({ to: "latest" })`.
5. Calls `backend.addOutput({ custom: { amplifyMigrations: { stateTable, tables, version } } })` so the CLI can find things locally.

### 5.4 CLI

```
amplify-migrations create <name>         # scaffold timestamped file + editable schema stub
amplify-migrations up [--to NAME] [--dry] [--allow-checksum-mismatch]
amplify-migrations down [--steps N] [--to NAME] [--dry] [--allow-checksum-mismatch]
amplify-migrations pending
amplify-migrations list
```

Planned: `fresh` (down-all + up, sandbox only) and `status` (shows lock holder + drift summary).

All commands load `amplify_outputs.json` to discover the state-table name and region, then resolve creds via the standard AWS SDK credential chain (profile, env vars, SSO, etc.).

---

## 6. State table (DynamoDB)

**Owned by the library, not by the user's Amplify schema.** `withMigrations()` provisions a plain `aws-cdk-lib/aws-dynamodb` `Table` in its own nested stack (`AmplifyMigrations`). This keeps it out of AppSync, out of `ClientSchema`, and out of any auth rule surface the user maintains. Same principle as MikroORM's `mikro_orm_migrations` — it's plumbing, not an entity.

```ts
// inside withMigrations(backend, opts)
new Table(migrationStack, "StateTable", {
  partitionKey: { name: "name", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expiresAt",    // auto-expires orphaned locks
  pointInTimeRecovery: true,
  removalPolicy: RemovalPolicy.RETAIN, // opt-in DESTROY for sandboxes
});
```

Items stored:

| `name` (PK)                                 | fields                                                                 |
|---|---|
| `<migrationName>#<up\|down>#<ISO>`          | `migrationName`, `checksum`, `appliedAt`, `durationMs`, `batch`, `direction` |
| `__lock__`                                  | `holder`, `expiresAt` (TTL)                                            |

Plus one reserved item used as a lock:

```
{ name: "__lock__", holder: "<hostname/pid/deployId>", expiresAt: <epoch> }
```

Acquired via `PutItem` with `ConditionExpression: "attribute_not_exists(#name) OR expiresAt < :now"`. Released on success/failure. TTL attribute on `expiresAt` cleans up orphaned locks if a Lambda crashes.

---

## 7. Runner algorithm

```
1. loadConfig() → resolve tables, creds, migrationsDir
2. acquireLock(holderId)
3. executed = scan AmplifyMigration where direction="up" ∖ any "down"
4. onDisk   = readdir(migrationsDir) matching /^Migration\d{14}-.+\.(t|j)s$/
5. pending  = onDisk \ executed  (sorted by timestamp)
6. for each pending up to `--to`:
     a. import module, instantiate class
     b. run up(ctx) with a per-migration logger
     c. on success: put AmplifyMigration record (ConditionExpression: attribute_not_exists)
     d. on failure: log, release lock, exit non-zero; DO NOT record
7. releaseLock()
```

`down` mirrors this in reverse order, recording a row with `direction="down"`.

Checksum mismatch between disk and recorded row causes a loud warning (and refuses to run in CI) — same safety MikroORM gives you via snapshots.

### Transaction semantics

DynamoDB can't wrap an entire migration in one transaction (25-item limit, no cross-region). Instead:

- Each migration runs to completion or throws — no partial "applied" state is recorded unless it fully succeeded.
- `ctx.transact([...])` gives authors DDB's native `TransactWriteItems` for small atomic groups.
- Idempotency is the author's responsibility; the library makes it easy by exposing `ctx.putIfAbsent`, `ctx.updateIfMatches`, etc.
- Sandbox `fresh` uses the fact that Amplify sandboxes are disposable — it just calls `down` in reverse.

---

## 8. Dependencies

Core (runtime, shipped to Lambda):

- `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/util-dynamodb`
- `zod` — config + `amplify_outputs.json` parsing
- `pino` — structured logging (replaceable via the `logger` option)

CLI:

- `commander` — argument parsing (lighter than yargs, already used by Amplify CLI)
- `@swc-node/register` — on-the-fly TS execution of migration files without a build step
- `picocolors`, `prompts`

CDK package:

- `aws-cdk-lib`, `constructs` — peer deps
- `@aws-amplify/backend` — peer dep

Dev:

- `tsup` for builds, `vitest` for tests, `aws-sdk-client-mock` for DDB mocking, `biome` for lint/format, `changesets` for release.

No runtime dependency on MikroORM.

---

## 9. Testing strategy

1. **Unit** (`vitest` + `aws-sdk-client-mock`): state store, lock acquisition, pending-set computation, checksum logic.
2. **Integration** against [`amazon/dynamodb-local`](https://hub.docker.com/r/amazon/dynamodb-local) in CI — a `docker-compose.yml` spins it up; tests exercise real `TransactWriteItems`, paginated scans, TTL semantics.
3. **End-to-end** in `examples/gen2-todo` using Amplify sandbox (`npx ampx sandbox`) + a GitHub Actions workflow.
4. **Snapshot** tests for CLI stdout.

---

## 10. Implementation plan

Phased, each phase leaves the library usable.

**Phase 0 — Repo bootstrap** (0.5 day)
- pnpm workspace, tsconfig base, biome, changesets, CI skeleton
- `packages/core`, `packages/cli`, `packages/cdk` with empty builds

**Phase 1 — Core runner, local only** (2 days)
- `StateStore` (DDB) with lock
- `MigrationLoader` (filesystem, swc-node)
- `MigrationContext` + typed CRUD helpers
- `Runner.up/down/pending/list`
- Unit tests against mocked DDB

**Phase 2 — CLI** (1 day)
- `create`, `up`, `down`, `pending`, `list`, `status`, `fresh`
- Reads `amplify_outputs.json`; credential chain via SDK defaults
- Integration tests against dynamodb-local

**Phase 3 — CDK integration** (1.5 days)
- `withMigrations(backend, opts)` helper
- `AmplifyMigration` model injection
- Lambda bundling of `migrationsDir` (esbuild)
- `CustomResource` that invokes the Lambda on deploy
- IAM grants scoped to discovered tables only

**Phase 4 — DX polish** (1 day)
- Checksum drift detection + `--allow-checksum-mismatch`
- `--dry` prints planned operations
- `status` shows lock holder, last batch, pending count
- Rich error messages pointing at the failing migration file + stack

**Phase 5 — Example + docs** (1 day)
- `examples/gen2-todo` full walkthrough
- README with quickstart, config reference, recipes (backfill, rename, split model)
- Published to GitHub with MIT license, Actions release workflow via changesets

Total: ~7 engineering days to a publishable alpha.

---

## 11. Open questions (flag for review before Phase 1)

1. **Should `withMigrations` also run on `ampx sandbox`?** Default yes for parity with production, but watch out for long migrations slowing hot-reload. Probably gate by `runOnDeploy: "pending"` but allow `"off"` per-env.
2. **Auto-generation from Amplify schema diffs** — deliberately out of scope for 0.1; revisit once the core is stable. CDK already handles infra; we'd only ever generate *data* migrations, and those are hard to infer safely.
3. **Multi-region / replicated tables** — current design assumes one region per run. Multi-region would need a leader-election story; park for 1.0.
4. **Seed vs migration distinction** — MikroORM has both. Start with migrations only; add `seeders/` in 0.2 if demand appears.
