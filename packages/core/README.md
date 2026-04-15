# @amplify-migrations/core

Core migration runner for [AWS Amplify Data (Gen 2)][amplify-data]. Provides the `Runner`, `StateStore`, `MigrationContext`, migration loader, and scaffolding primitives — no CLI dependencies, safe to bundle into a Lambda.

[amplify-data]: https://docs.amplify.aws/react/build-a-backend/data/
[mikro-orm]: https://github.com/mikro-orm/mikro-orm

Most users pick up this package transitively via [`@amplify-migrations/cli`](../cli) or [`@amplify-migrations/cdk`](../cdk). See the [repo README](../../README.md) for the full quickstart and architecture.

## Public API

```ts
import {
  AmplifyMigration,
  Runner,
  defineMigrationsConfig,
  type MigrationContext,
  type MigrationsConfig,
  type ChecksumPolicy,
} from "@amplify-migrations/core";
```

- `AmplifyMigration<Schema>` — abstract class migrations extend.
- `MigrationContext<Schema>` — passed to `up(ctx)` / `down(ctx)`, exposes typed `get/put/update/delete/scan/transact` helpers plus `ctx.raw` for the underlying DynamoDBDocumentClient.
- `Runner` — execute `up()`, `down()`, `pending()`, `list()` programmatically.
- `defineMigrationsConfig()` — typed config-file helper.

## Authoring a migration

```ts
import { AmplifyMigration, type MigrationContext } from "@amplify-migrations/core";
import type { Schema } from "./Migration20260415120000-seed.schema.js";

export default class extends AmplifyMigration<Schema> {
  static override description = "Seed Todos";

  async up(ctx: MigrationContext<Schema>) {
    await ctx.put("Todo", { id: "welcome", content: "Hi" });
  }

  async down(ctx: MigrationContext<Schema>) {
    await ctx.delete("Todo", { id: "welcome" });
  }
}
```

The sibling `.schema.ts` file is a **frozen** snapshot of your Amplify `Schema` type at creation time, so later schema changes can't retype old migrations.

## License

MIT.
