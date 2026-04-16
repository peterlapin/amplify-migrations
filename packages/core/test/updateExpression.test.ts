import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildUpdateExpression } from '../src/context/updateExpression.ts';

/** Helper: assert non-null and return typed value (avoids `!` operator). */
function assertDefined<T>(val: T | null | undefined): T {
  assert.ok(val != null, 'expected non-null value');
  return val;
}

describe('buildUpdateExpression', () => {
  it('returns null for empty patch', () => {
    assert.equal(buildUpdateExpression({}), null);
  });

  it('produces SET for scalar values', () => {
    const out = assertDefined(buildUpdateExpression({ owner: 'alice', count: 3 }));
    assert.match(out.UpdateExpression, /^SET /);
    assert.equal(out.ExpressionAttributeNames['#k0'], 'owner');
    assert.equal(out.ExpressionAttributeNames['#k1'], 'count');
    assert.deepEqual(out.ExpressionAttributeValues, { ':v0': 'alice', ':v1': 3 });
  });

  it('maps null/undefined to REMOVE', () => {
    const out = assertDefined(buildUpdateExpression({ owner: null, legacy: undefined }));
    assert.match(out.UpdateExpression, /^REMOVE /);
    assert.equal(out.ExpressionAttributeValues, undefined);
  });

  it('produces SET and REMOVE together', () => {
    const out = assertDefined(buildUpdateExpression({ owner: 'alice', legacy: null }));
    assert.match(out.UpdateExpression, /^SET .+ REMOVE /);
  });

  it('ignores order but preserves alias uniqueness', () => {
    const out = assertDefined(buildUpdateExpression({ a: 1, b: 2, c: 3 }));
    const aliases = Object.keys(out.ExpressionAttributeNames);
    assert.equal(new Set(aliases).size, 3);
  });
});
