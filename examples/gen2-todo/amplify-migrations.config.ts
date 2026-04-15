import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineMigrationsConfig } from "@amplify-migrations/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineMigrationsConfig({
  migrationsDir: resolve(__dirname, "amplify/migrations"),
  // ampx sandbox writes this file at the project root after each deploy.
  outputsPath: resolve(__dirname, "amplify_outputs.json"),
});
