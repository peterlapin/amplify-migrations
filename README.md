# amplify-migrations

> **⚠️ Alpha** — `1.0.0-alpha.0`. Works end-to-end and has live-deploy test coverage, but the public API, state-table schema, and config file shape may still change before `1.0.0` stable. Not recommended for production workloads yet. Feedback welcome via GitHub issues.

[MikroORM][mikro-orm]-style database migrations for **[AWS Amplify Data (Gen 2)][amplify-data]**, targeting the DynamoDB tables Amplify generates from your `a.schema(...)`.

[mikro-orm]: https://github.com/mikro-orm/mikro-orm
[amplify-data]: https://docs.amplify.aws/react/build-a-backend/data/
[amplify-gen2]: https://docs.amplify.aws/react/build-a-backend/

- `migrations/` folder with timestamped files
- Class-based `up(ctx)` / `down(ctx)` with typed model access
- State + advisory lock stored in a private DynamoDB table owned by the library
- CLI: `create`, `up`, `down`, `pending`, `list`
- CDK helper: `withMigrations(backend, opts)` runs pending migrations automatically on every deploy via a CloudFormation `CustomResource`

See [`DESIGN.md`](./DESIGN.md) for the full architecture.

## Try it end-to-end in a real AWS sandbox

Fastest way to see the library work against real DynamoDB + Lambda:

```bash
pnpm install              # at the repo root
pnpm -w build             # builds core, cli, and cdk packages
cd examples/gen2-todo
pnpm sandbox              # runs `ampx sandbox` — needs an AWS profile
```

CloudFormation will provision a nested `AmplifyMigrations` stack (state table + runner Lambda), and the runner will execute `Migration20260415120000-seed-todos.ts` automatically. See [`examples/gen2-todo/README.md`](./examples/gen2-todo/README.md) for the full walkthrough.

To tear everything down: `pnpm sandbox:delete`.

## Quickstart (manual wiring)

```bash
pnpm add -D @lapinsoft/data-migrations-cli
pnpm add @lapinsoft/data-migrations-core @lapinsoft/data-migrations-cdk
```

Your `amplify/data/resource.ts` stays **untouched** — the library owns its state/lock table internally and keeps it out of your GraphQL API, client-generated types, and auth rules. All you need is:

```ts
import { defineBackend } from "@aws-amplify/backend";
import { withMigrations } from "@lapinsoft/data-migrations-cdk";
import { auth } from "./auth/resource";
import { data } from "./data/resource";

const backend = defineBackend({ auth, data });
withMigrations(backend, {
  migrationsDir: `${__dirname}/migrations`,
  runOnDeploy: "pending",
});
```

Create a migration:

```bash
pnpm amplify-migrations create backfill-todo-owner
```

Edit the generated file:

```ts
// amplify/migrations/Migration20260415120000-backfill-todo-owner.ts
import { AmplifyMigration, type MigrationContext } from "@lapinsoft/data-migrations-core";
// Note: `.js` specifier is correct even though the file is `.schema.ts` —
// that's how Node ESM + TypeScript NodeNext resolution works. See FAQ below.
import type { Schema } from "./Migration20260415120000-backfill-todo-owner.schema.js";

export default class extends AmplifyMigration<Schema> {
  static override description = "Backfill Todo.owner from legacy createdBy";

  async up(ctx: MigrationContext<Schema>) {
    for await (const todo of ctx.scan("Todo")) {
      if (!todo.owner && todo.createdBy) {
        await ctx.update("Todo", { id: todo.id }, { owner: todo.createdBy });
      }
    }
  }
  async down(ctx: MigrationContext<Schema>) {
    for await (const todo of ctx.scan("Todo")) {
      await ctx.update("Todo", { id: todo.id }, { owner: null });
    }
  }
}
```

Run locally against your sandbox:

```bash
pnpm amplify-migrations pending
pnpm amplify-migrations up
```

## Why each migration gets a sibling `Schema` file

`amplify-migrations create` writes **two** files:

```
Migration20260415120000-backfill-todo-owner.ts
Migration20260415120000-backfill-todo-owner.schema.ts   ← generated editable schema stub
```

The migration imports `Schema` from its sibling file, **not** from `amplify/data/resource`. Today the CLI generates that sibling file as an editable stub unless you supply a real schema snapshot programmatically through the core scaffolding API. That keeps the migration self-contained, but it is not yet an automatic frozen snapshot guarantee.

Automatic schema freezing is still planned work.

## FAQ

**Why do migrations import `./...schema.js` when the file is `.ts`?**
TypeScript's `NodeNext` / `Node16` module resolution requires the specifier to match the **emitted** extension, which is `.js` — not the source extension. The compiler resolves `./foo.js` to `./foo.ts` at build time. This is the standard ESM-TS convention; see the TypeScript handbook on [ESM in Node](https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-nodenext). If your project uses `"moduleResolution": "Bundler"` instead, drop the extension.

**Where is the migration state stored — do I need to add a model to my schema?**
No. `withMigrations()` provisions a dedicated, private DynamoDB table in a nested stack (`AmplifyMigrations`). It is not part of your [Amplify Data][amplify-data] schema, doesn't show up in AppSync, and doesn't leak into `ClientSchema<typeof schema>`. It's treated like infrastructure plumbing, the same way [MikroORM][mikro-orm]'s `mikro_orm_migrations` is invisible to your entities.

**Can I destroy my Amplify sandbox without losing migration history?**
By default the state table uses `RemovalPolicy.RETAIN`. Override with `stateTableRemovalPolicy: RemovalPolicy.DESTROY` for throwaway sandboxes.

## Troubleshooting

**"The region eu-central-1 has not been bootstrapped"**
First-time-only per region. Run `npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>` with your admin profile.

**"Cannot find package 'aws-cdk-lib' imported from backend.ts"**
Add it to your project's dependencies: `pnpm add aws-cdk-lib constructs`.

**"Dynamic require of 'esbuild' is not supported"**
`@lapinsoft/data-migrations-cdk` bundles migrations with `esbuild` at synth time. If you see this in a local workspace, rebuild and reinstall the package artifacts: `pnpm -w build && pnpm install`.

**"Cannot find package '@swc-node/register'"**
The CLI ships its own TypeScript config loader. If this error appears, your local install is likely stale or incomplete. Reinstall `@lapinsoft/data-migrations-cli`, or rename `amplify-migrations.config.ts` to `.mjs` / `.js`.

**"Migration ... must default-export a class extending AmplifyMigration"**
The runner couldn't find the exported class — usually because the bundler output a CJS module and the default-export landed at `mod.default.default`. Current alpha builds handle both shapes. If you still see this, rebuild: `pnpm -w build && touch amplify/backend.ts`.

**"Refusing to run: ... applied migration(s) have drifted on disk"**
Someone edited an already-applied migration. Default policy is `"off"` so you won't normally see this — if you opted into `checksumPolicy: "strict"`, either revert the edit, write a new migration for the change, or pass `--allow-checksum-mismatch` once to unblock.

**"Region is missing"**
The runner couldn't resolve an AWS region. It reads `data.aws_region` or `auth.aws_region` from `amplify_outputs.json`, then falls back to `AWS_REGION` / `AWS_DEFAULT_REGION`. Either make sure the sandbox has finished writing `amplify_outputs.json` or `export AWS_REGION=<your-region>`.

**"Received response status [FAILED] from custom resource"**
The runner Lambda itself errored during `up()`. Check CloudWatch Logs under `/aws/lambda/amplify-<stack>-RunnerFn-*`. Failed CFN stacks land in `ROLLBACK_COMPLETE` and must be deleted before redeploying: `aws cloudformation delete-stack --stack-name <name> --region <region>`.

## Publishing alpha builds

The planned npm scope is `@lapinsoft`. Until the packages stabilize:

- publishes stay manual
- prereleases publish under the `next` dist-tag, not `latest`
- enable npm 2FA before the first real publish

The release workflow remains manual and currently shells out to `changeset publish --tag next`.

## Layout

```
packages/
  core/   # Runner, StateStore, MigrationContext — zero CLI deps, safe for Lambda
  cli/    # `amplify-migrations` binary
  cdk/    # `withMigrations(backend, opts)` + runtime Lambda handler
examples/
  gen2-todo/
```

## Status

`1.0.0-alpha.0` — manual prerelease only. Use the `next` dist-tag while the API is still moving. See [DESIGN.md §10](./DESIGN.md) for the roadmap.

## License

MIT.
