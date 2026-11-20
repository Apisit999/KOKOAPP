const assert = require('node:assert/strict');
const { test } = require('node:test');
const { looksLikeNoSignal } = require('../src/renderer/camera/no-signal-check.ts');

const frame = (fill) => { const a = new Uint8ClampedArray(160 * 90 * 4); for (let i = 0; i < a.length; i++) a[i] = fill(i); return a; };

test('dark still frame (Canon "not connected" picture) is no signal', () => {
  const a = frame(i => (i % 97 === 0 ? 255 : 8));
  assert.equal(looksLikeNoSignal(a, a.slice()), true);
});

test('dark live frame with sensor noise is a real picture', () => {
  const a = frame(() => 15);
  const b = frame(i => 15 + (i % 3 === 0 ? 3 : 0));
  assert.equal(looksLikeNoSignal(a, b), false);
});

test('bright still frame is a real picture', () => {
  const a = frame(() => 120);
  assert.equal(looksLikeNoSignal(a, a.slice()), false);
});
