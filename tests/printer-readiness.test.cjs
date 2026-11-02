const assert = require('node:assert/strict');
const { test } = require('node:test');
const { printerReadiness } = require('../src/shared/printer-readiness.ts');

test('no scan result or no printers is optional and points to simulate print', () => {
  for (const count of [null, 0]) {
    const result = printerReadiness(count);
    assert.equal(result.state, 'optional');
    assert.match(result.detail.th, /จำลองการพิมพ์/);
    assert.match(result.detail.en, /Simulate print/);
  }
});

test('found printers are ready but never claimed as supported or tested', () => {
  const result = printerReadiness(2);
  assert.equal(result.state, 'ready');
  assert.match(result.detail.en, /2 printer/);
  assert.match(result.detail.en, /No model is tested/);
  assert.match(result.detail.th, /ยังไม่ได้ทดสอบ/);
});
