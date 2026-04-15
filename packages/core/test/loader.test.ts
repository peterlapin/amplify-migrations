import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverMigrations, nextTimestamp } from "../src/loader/loader.ts";

describe("loader", () => {
  it("nextTimestamp is 14-digit UTC", () => {
    const ts = nextTimestamp(new Date(Date.UTC(2026, 3, 15, 12, 34, 56)));
    assert.equal(ts, "20260415123456");
  });

  it("returns [] for non-existent dir", async () => {
    const out = await discoverMigrations("/tmp/definitely-does-not-exist-amplify-migrations-xyz");
    assert.deepEqual(out, []);
  });

  it("discovers migrations, skips schema snapshots, sorts by timestamp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "am-loader-"));
    await writeFile(join(dir, "Migration20260415120000-a.ts"), "export default class {}");
    await writeFile(join(dir, "Migration20260414120000-b.ts"), "export default class {}");
    await writeFile(join(dir, "Migration20260415120000-a.schema.ts"), "export type Schema = {};");
    await writeFile(join(dir, "not-a-migration.ts"), "");
    const found = await discoverMigrations(dir);
    assert.deepEqual(
      found.map((f) => f.name),
      ["Migration20260414120000-b", "Migration20260415120000-a"],
    );
    for (const m of found) assert.match(m.checksum, /^[a-f0-9]{64}$/);
  });

  it("changes checksum when file contents change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "am-loader-"));
    const file = join(dir, "Migration20260415120000-x.ts");
    await writeFile(file, "v1");
    const before = (await discoverMigrations(dir))[0]!.checksum;
    await writeFile(file, "v2");
    const after = (await discoverMigrations(dir))[0]!.checksum;
    assert.notEqual(before, after);
  });
});
