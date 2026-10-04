const assert = require('node:assert/strict');
const { test } = require('node:test');
const { waitForCaptureDelay } = require('../src/renderer/camera/capture-delay.ts');

test('countdown wait settles early when session is canceled', async () => {
  const controller = new AbortController();
  const wait = waitForCaptureDelay(5000, controller.signal);
  controller.abort();
  await assert.rejects(wait, error => error.name === 'AbortError');
});

test('countdown wait rejects immediately when already canceled', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForCaptureDelay(10, controller.signal), error => error.name === 'AbortError');
});

test('countdown wait completes when not canceled', async () => {
  const controller = new AbortController();
  await waitForCaptureDelay(1, controller.signal);
});
