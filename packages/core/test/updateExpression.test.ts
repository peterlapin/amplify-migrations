import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUpdateExpression } from "../src/context/updateExpression.ts";

describe("buildUpdateExpression", () => {
  it("returns null for empty patch", () => {
    assert.equal(buildUpdateExpression({}), null);
  });

  it("produces SET for scalar values", () => {
    const out = buildUpdateExpression({ owner: "alice", count: 3 });
    assert.ok(out);
    assert.match(out!.UpdateExpression, /^SET /);
    assert.equal(out!.ExpressionAttributeNames["#k0"], "owner");
    assert.equal(out!.ExpressionAttributeNames["#k1"], "count");
    assert.deepEqual(out!.ExpressionAttributeValues, { ":v0": "alice", ":v1": 3 });
  });

  it("maps null/undefined to REMOVE", () => {
    const out = buildUpdateExpression({ owner: null, legacy: undefined });
    assert.ok(out);
    assert.match(out!.UpdateExpression, /^REMOVE /);
    assert.equal(out!.ExpressionAttributeValues, undefined);
  });

  it("produces SET and REMOVE together", () => {
    const out = buildUpdateExpression({ owner: "alice", legacy: null });
    assert.ok(out);
    assert.match(out!.UpdateExpression, /^SET .+ REMOVE /);
  });

  it("ignores order but preserves alias uniqueness", () => {
    const out = buildUpdateExpression({ a: 1, b: 2, c: 3 });
    assert.ok(out);
    const aliases = Object.keys(out!.ExpressionAttributeNames);
    assert.equal(new Set(aliases).size, 3);
  });
});
