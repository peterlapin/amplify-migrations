# @amplify-migrations/cli

Command-line interface for [amplify-migrations](../../README.md) — [MikroORM][mikro-orm]-style migrations for [AWS Amplify Data (Gen 2)][amplify-data].

[mikro-orm]: https://github.com/mikro-orm/mikro-orm
[amplify-data]: https://docs.amplify.aws/react/build-a-backend/data/

## Install

```bash
pnpm add -D @amplify-migrations/cli @amplify-migrations/core
pnpm add -D @swc-node/register   # lets the CLI read amplify-migrations.config.ts
```

## Commands

```
amplify-migrations create <name>                 # scaffold a new migration + frozen schema snapshot
amplify-migrations up [--to NAME] [--dry] [--allow-checksum-mismatch]
amplify-migrations down [--steps N | --to NAME] [--dry] [--allow-checksum-mismatch]
amplify-migrations pending                       # list pending migrations
amplify-migrations list                          # show disk + applied
```

## Configuration

Place an `amplify-migrations.config.ts` at your project root:

```ts
import { defineMigrationsConfig } from "@amplify-migrations/core";

export default defineMigrationsConfig({
  migrationsDir: "./amplify/migrations",
  outputsPath: "./amplify_outputs.json",
  checksumPolicy: "off",   // "off" | "warn" | "strict"
});
```

The CLI resolves AWS creds via the standard SDK chain (profile, env vars, SSO). Region is pulled from `amplify_outputs.json`, falls back to `AWS_REGION` / `AWS_DEFAULT_REGION`.

## License

MIT.
