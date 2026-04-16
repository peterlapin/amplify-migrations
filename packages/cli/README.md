# @lapinsoft/data-migrations-cli

Command-line interface for [amplify-migrations](../../README.md) — [MikroORM][mikro-orm]-style migrations for [AWS Amplify Data (Gen 2)][amplify-data].

[mikro-orm]: https://github.com/mikro-orm/mikro-orm
[amplify-data]: https://docs.amplify.aws/react/build-a-backend/data/

## Install

```bash
pnpm add -D @lapinsoft/data-migrations-cli @lapinsoft/data-migrations-core
```

## Commands

```
amplify-migrations create <name>                 # scaffold a new migration + editable schema stub
amplify-migrations up [--to NAME] [--dry] [--allow-checksum-mismatch]
amplify-migrations down [--steps N | --to NAME] [--dry] [--allow-checksum-mismatch]
amplify-migrations pending                       # list pending migrations
amplify-migrations list                          # show disk + applied
```

## Configuration

Place an `amplify-migrations.config.ts` at your project root:

```ts
import { defineMigrationsConfig } from "@lapinsoft/data-migrations-core";

export default defineMigrationsConfig({
  migrationsDir: "./amplify/migrations",
  outputsPath: "./amplify_outputs.json",
  checksumPolicy: "off",   // "off" | "warn" | "strict"
});
```

`create` generates a sibling `.schema.ts` file as an editable schema stub. It does not yet freeze a real Amplify schema snapshot automatically.

The CLI resolves AWS creds via the standard SDK chain (profile, env vars, SSO). Region is pulled from `amplify_outputs.json`, falls back to `AWS_REGION` / `AWS_DEFAULT_REGION`.

## License

MIT.
