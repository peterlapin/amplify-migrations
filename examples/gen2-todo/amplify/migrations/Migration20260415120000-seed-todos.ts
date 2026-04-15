import { AmplifyMigration, type MigrationContext } from "@amplify-migrations/core";
import type { Schema } from "./Migration20260415120000-seed-todos.schema.js";

/**
 * Demo migration: seeds a welcome Todo and backfills `owner` from the
 * legacy `createdBy` attribute so you can see both write patterns.
 */
export default class extends AmplifyMigration<Schema> {
  static override description = "Seed welcome Todo + backfill owner from createdBy";

  async up(ctx: MigrationContext<Schema>): Promise<void> {
    await ctx.put("Todo", {
      id: "welcome",
      content: "Welcome to Amplify Gen 2",
      owner: "system",
    });

    for await (const todo of ctx.scan("Todo")) {
      const item = todo as { id: string; owner?: string; createdBy?: string };
      if (!item.owner && item.createdBy) {
        await ctx.update("Todo", { id: item.id }, { owner: item.createdBy });
      }
    }
  }

  async down(ctx: MigrationContext<Schema>): Promise<void> {
    await ctx.delete("Todo", { id: "welcome" });
  }
}
