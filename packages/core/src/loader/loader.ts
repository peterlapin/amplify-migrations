import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import type { AmplifyMigration, SchemaShape } from "../types.js";

const MIGRATION_FILE = /^Migration(\d{14})(?:-([A-Za-z0-9-_]+))?\.(?:ts|js|mjs|cjs)$/;

export interface DiscoveredMigration<S extends SchemaShape = SchemaShape> {
  name: string;          // full basename without extension, e.g. Migration20260415120000-backfill
  timestamp: string;     // 14-digit
  filePath: string;      // absolute
  checksum: string;      // sha256 of file contents
  load: () => Promise<new () => AmplifyMigration<S>>;
}

export async function discoverMigrations<S extends SchemaShape = SchemaShape>(
  dir: string,
): Promise<DiscoveredMigration<S>[]> {
  const abs = resolve(dir);
  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const out: DiscoveredMigration<S>[] = [];
  for (const entry of entries) {
    const m = MIGRATION_FILE.exec(entry);
    if (!m) continue;
    if (entry.endsWith(".schema.ts") || entry.endsWith(".schema.js")) continue;
    const timestamp = m[1] as string;
    const filePath = join(abs, entry);
    const name = entry.replace(/\.(ts|js|mjs|cjs)$/, "");

    // Prefer a `<name>.sha256` sidecar if present — the CDK bundler writes
    // these next to the esbuild output so the Lambda records the SOURCE
    // checksum, not the bundled-JS checksum. Without this, CLI-vs-Lambda
    // hashes would always diverge.
    let checksum: string;
    try {
      checksum = (await readFile(join(abs, `${name}.sha256`), "utf8")).trim();
    } catch {
      const buf = await readFile(filePath);
      checksum = createHash("sha256").update(buf).digest("hex");
    }
    out.push({
      name,
      timestamp,
      filePath,
      checksum,
      load: async () => {
        const mod = await import(pathToFileURL(filePath).href);
        // Handle: ESM default export, CJS via esbuild (mod.default = module.exports,
        // so the class lives at mod.default.default), named export, or
        // module.exports = class.
        const candidates: unknown[] = [
          mod?.default?.default,
          mod?.default,
          mod?.Migration,
          mod?.[name],
          mod,
        ];
        const cls = candidates.find((c) => typeof c === "function");
        if (typeof cls !== "function") {
          throw new Error(
            `Migration "${name}" must default-export a class extending AmplifyMigration`,
          );
        }
        return cls as new () => AmplifyMigration<S>;
      },
    });
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

export function nextTimestamp(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    String(now.getUTCFullYear()) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}
