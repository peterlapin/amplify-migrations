import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('cdk dist layout', () => {
  it('ships the runtime handler next to dist/index.js', () => {
    assert.ok(existsSync(join(__dirname, '../dist/index.js')));
    assert.ok(existsSync(join(__dirname, '../dist/runtime/runnerHandler.js')));
  });
});
