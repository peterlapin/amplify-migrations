# @lapinsoft/data-migrations-core

Core migration runner for [AWS Amplify Data (Gen 2)][amplify-data]. Provides the `Runner`, `StateStore`, `MigrationContext`, migration loader, and scaffolding primitives — no CLI dependencies, safe to bundle into a Lambda.

[amplify-data]: https://docs.amplify.aws/react/build-a-backend/data/
[mikro-orm]: https://github.com/mikro-orm/mikro-orm

Most users pick up this package transitively via [`@lapinsoft/data-migrations-cli`](../cli) or [`@lapinsoft/data-migrations-cdk`](../cdk). See the [repo README](../../README.md) for the full quickstart and architecture.

## Public API

```ts
import {
  AmplifyMigration,
  Runner,
  defineMigrationsConfig,
  type MigrationContext,
  type MigrationsConfig,
  type ChecksumPolicy,
} from "@lapinsoft/data-migrations-core";
```

- `AmplifyMigration<Schema>` — abstract class migrations extend.
- `MigrationContext<Schema>` — passed to `up(ctx)` / `down(ctx)`, exposes typed `get/put/update/delete/scan/transact` helpers plus `ctx.raw` for the underlying DynamoDBDocumentClient.
- `Runner` — execute `up()`, `down()`, `pending()`, `list()` programmatically.
- `defineMigrationsConfig()` — typed config-file helper.

## Authoring a migration

```ts
import { AmplifyMigration, type MigrationContext } from "@lapinsoft/data-migrations-core";
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

The sibling `.schema.ts` file is generated as an editable schema stub by the CLI. If you use the scaffolding API programmatically, you can supply a real snapshot source yourself.

## License

MIT.
