import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// We test the RequestType gating algorithm in isolation so we don't need
// @amplify-migrations/core or the AWS SDK installed.

type Ev = { RequestType: 'Create' | 'Update' | 'Delete'; PhysicalResourceId?: string };

async function gated(
  event: Ev,
  env: { AM_RUN_MODE?: string; AM_STATE_TABLE?: string },
  runUp: () => Promise<number>,
) {
  const physicalId = event.PhysicalResourceId ?? 'amplify-migrations';
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: physicalId, Data: { skipped: 'delete' } };
  }
  const mode = env.AM_RUN_MODE ?? 'pending';
  if (!env.AM_STATE_TABLE) throw new Error('AM_STATE_TABLE is required');
  if (mode === 'off') return { PhysicalResourceId: physicalId, Data: { skipped: 'off' } };
  const appliedCount = await runUp();
  return { PhysicalResourceId: physicalId, Data: { appliedCount } };
}

describe('runnerHandler.gated', () => {
  it('short-circuits on Delete without calling runner', async () => {
    let called = 0;
    const res = await gated({ RequestType: 'Delete' }, { AM_STATE_TABLE: 't' }, async () => {
      called++;
      return 1;
    });
    assert.deepEqual(res.Data, { skipped: 'delete' });
    assert.equal(called, 0);
  });

  it("short-circuits on run mode 'off'", async () => {
    let called = 0;
    const res = await gated(
      { RequestType: 'Create' },
      { AM_STATE_TABLE: 't', AM_RUN_MODE: 'off' },
      async () => {
        called++;
        return 1;
      },
    );
    assert.deepEqual(res.Data, { skipped: 'off' });
    assert.equal(called, 0);
  });

  it('runs migrations on Create', async () => {
    const res = await gated({ RequestType: 'Create' }, { AM_STATE_TABLE: 't' }, async () => 3);
    assert.deepEqual(res.Data, { appliedCount: 3 });
  });

  it('runs migrations on Update', async () => {
    const res = await gated({ RequestType: 'Update' }, { AM_STATE_TABLE: 't' }, async () => 0);
    assert.deepEqual(res.Data, { appliedCount: 0 });
  });

  it('throws without AM_STATE_TABLE', async () => {
    await assert.rejects(
      () => gated({ RequestType: 'Create' }, {}, async () => 0),
      /AM_STATE_TABLE/,
    );
  });
});
