import { AmplifyMigration, type MigrationContext } from "@amplify-migrations/core";
import type { Schema } from "./Migration20260415130000-seed-more-todos.schema.js";

/**
 * Seeds a batch of demo Todos so the list view has something to show.
 * Demonstrates:
 *   - Many puts in a loop
 *   - Idempotency (re-running this up() is a no-op because each id is stable)
 *   - Clean rollback via down()
 */
const DEMO_TODOS: Array<{ id: string; content: string; owner: string }> = [
  { id: "demo-1", content: "Write the quarterly report", owner: "alice" },
  { id: "demo-2", content: "Review PR #42", owner: "bob" },
  { id: "demo-3", content: "Water the plants", owner: "alice" },
  { id: "demo-4", content: "Plan team offsite", owner: "carol" },
  { id: "demo-5", content: "Upgrade Node to 22", owner: "bob" },
  { id: "demo-6", content: "Call the dentist", owner: "alice" },
  { id: "demo-7", content: "Refactor the auth module", owner: "dave" },
  { id: "demo-8", content: "Buy birthday gift", owner: "carol" },
  { id: "demo-9", content: "Write amplify-migrations docs", owner: "peter" },
  { id: "demo-10", content: "Take a break ☕", owner: "peter" },
];

export default class extends AmplifyMigration<Schema> {
  static override description = "Seed ten demo Todos across a few owners";

  async up(ctx: MigrationContext<Schema>): Promise<void> {
    for (const todo of DEMO_TODOS) {
      await ctx.put("Todo", todo);
      ctx.logger.info({ id: todo.id }, "seeded");
    }
    ctx.logger.info({ count: DEMO_TODOS.length }, "seed complete");
  }

  async down(ctx: MigrationContext<Schema>): Promise<void> {
    for (const todo of DEMO_TODOS) {
      await ctx.delete("Todo", { id: todo.id });
    }
    ctx.logger.info({ count: DEMO_TODOS.length }, "demo todos removed");
  }
}
