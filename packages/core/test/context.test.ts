import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createContext } from '../src/context/context.ts';

describe('createContext.transact', () => {
  it('rejects update ops with an empty patch before calling DynamoDB', async () => {
    let calls = 0;
    const ctx = createContext({
      ddb: {
        send: async () => {
          calls += 1;
          return {};
        },
      } as never,
      tables: { Todo: 'TodoTable' },
      logger: { child: () => undefined } as never,
    });

    await assert.rejects(
      () => ctx.transact([{ type: 'update', model: 'Todo', key: { id: '1' }, patch: {} }]),
      /empty patch/,
    );
    assert.equal(calls, 0);
  });
});
