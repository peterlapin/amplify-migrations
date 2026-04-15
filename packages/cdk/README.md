# @amplify-migrations/cdk

[Amplify Gen 2][amplify-gen2] backend integration for [amplify-migrations](../../README.md).

[amplify-gen2]: https://docs.amplify.aws/react/build-a-backend/

Drop `withMigrations(backend, opts)` into your `amplify/backend.ts` and it will:

- Provision a private DynamoDB state/lock table in a nested `AmplifyMigrations` stack (kept **out** of your GraphQL API)
- Bundle the migration files + runner handler via esbuild
- Grant the runner Lambda IAM read/write on every Amplify-managed data table
- Register a CloudFormation `CustomResource` that runs pending migrations on every `Create`/`Update` deploy (gated against `Delete`)
- Publish the state-table name and data-table map into `amplify_outputs.json` so the CLI can find them

## Install

```bash
pnpm add @amplify-migrations/cdk @amplify-migrations/core aws-cdk-lib constructs
```

## Wire up

```ts
// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend";
import { withMigrations } from "@amplify-migrations/cdk";
import { auth } from "./auth/resource";
import { data } from "./data/resource";

const backend = defineBackend({ auth, data });

withMigrations(backend, {
  migrationsDir: `${__dirname}/migrations`,
  runOnDeploy: "pending",    // or "off"
  checksumPolicy: "off",     // "off" | "warn" | "strict"
});
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `migrationsDir` | required | Absolute path to the migrations folder to bundle |
| `runOnDeploy` | `"pending"` | `"pending"` runs pending migrations; `"off"` deploys the infra but doesn't invoke the runner |
| `timeout` | `Duration.minutes(15)` | Lambda timeout for the runner |
| `stateTableRemovalPolicy` | `RemovalPolicy.RETAIN` | Use `DESTROY` for throwaway sandboxes |
| `stateTableName` | auto-named | Fixed physical name for the state table. Only use when you control the full lifecycle; blocks CloudFormation from recreating the table under the same name |
| `tags` | inherits parent | Extra tags to apply to all resources this creates. Pass `false` to skip auto-inheriting tags from the parent Amplify backend stack |
| `checksumPolicy` | `"off"` | How the runner reacts to migration-file drift |
| `prebuiltAssetDir` | — | Bypass the built-in esbuild bundler; point at an asset directory you built yourself |

## Peer dependencies

`aws-cdk-lib >= 2.140.0` and `constructs >= 10.0.0`. Amplify Gen 2 projects already pull these in transitively.

## License

MIT.
