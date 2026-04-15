import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We cannot import the real StateStore here because it pulls in
// @aws-sdk/lib-dynamodb. Instead we exercise the StateStore's algorithm via
// a fake: a pure in-memory table that honours the same ConditionExpression
// semantics for the lock item. This is the same logic we'd expect to run
// against dynamodb-local in integration tests.

interface Item extends Record<string, unknown> {
  name: string;
}

class FakeTable {
  items = new Map<string, Item>();

  put(item: Item, opts?: { ifAbsent?: boolean; holderMatches?: string }) {
    const existing = this.items.get(item.name);
    if (opts?.ifAbsent && existing) {
      const now = Math.floor(Date.now() / 1000);
      if (typeof existing.expiresAt === "number" && existing.expiresAt >= now) {
        throw Object.assign(new Error("cc"), { name: "ConditionalCheckFailedException" });
      }
    }
    this.items.set(item.name, item);
  }

  delete(name: string, holderMatches?: string) {
    const existing = this.items.get(name);
    if (holderMatches && existing?.holder !== holderMatches) {
      throw Object.assign(new Error("cc"), { name: "ConditionalCheckFailedException" });
    }
    this.items.delete(name);
  }
}

// Port the lock semantics so we test the algorithm itself.
function acquireLock(t: FakeTable, holder: string, ttl: number) {
  t.put({ name: "__lock__", holder, expiresAt: Math.floor(Date.now() / 1000) + ttl }, { ifAbsent: true });
}
function releaseLock(t: FakeTable, holder: string) {
  try {
    t.delete("__lock__", holder);
  } catch (err) {
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
  }
}

describe("state store algorithm (fake table)", () => {
  it("second acquire is rejected while first holds the lock", () => {
    const t = new FakeTable();
    acquireLock(t, "a", 60);
    assert.throws(() => acquireLock(t, "b", 60), /ConditionalCheck/);
  });

  it("second acquire succeeds after release", () => {
    const t = new FakeTable();
    acquireLock(t, "a", 60);
    releaseLock(t, "a");
    acquireLock(t, "b", 60);
    assert.equal((t.items.get("__lock__") as { holder: string }).holder, "b");
  });

  it("second acquire succeeds after TTL expiry", () => {
    const t = new FakeTable();
    acquireLock(t, "a", -1); // already-expired TTL
    acquireLock(t, "b", 60);
    assert.equal((t.items.get("__lock__") as { holder: string }).holder, "b");
  });

  it("release by non-holder is a silent no-op", () => {
    const t = new FakeTable();
    acquireLock(t, "a", 60);
    releaseLock(t, "someone-else"); // should not throw
    assert.ok(t.items.get("__lock__"), "lock must still be held");
  });
});
