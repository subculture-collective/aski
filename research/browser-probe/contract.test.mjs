import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delayAt, validateJob, visibleColumns } from './contract.mjs';

test('reject allocation requests before creating a canvas', () => {
  for (const job of [{ width: 0 }, { width: 1025 }, { frames: 0 }, { frames: NaN }]) {
    assert.throws(() => validateJob({ width: 512, height: 192, frames: 40, ...job }));
  }
  assert.throws(() => validateJob({ width: 1024, height: 512, frames: 240 }), /budget/);
});
test('centisecond scheduling avoids cumulative 24fps rounding drift', () => {
  const delays = Array.from({ length: 48 }, (_, i) => delayAt(i, 48, 24, 200));
  assert.equal(delays.reduce((a, b) => a + b), 2200);
  assert(delays.every(x => x >= 40 && x % 10 === 0));
});
test('seeking is deterministic and the final reveal reaches the last column', () => {
  assert.equal(visibleColumns(7, 40, 48), visibleColumns(7, 40, 48));
  assert.equal(visibleColumns(39, 40, 48), 48);
});
