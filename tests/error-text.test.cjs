const assert = require('node:assert/strict');
const { test } = require('node:test');
const { friendlyErrorText } = require('../src/renderer/error-text.ts');

test('explains a full disk in both languages, whichever layer reported it', () => {
  const raw = "Error invoking remote method 'koko:begin-capture': Error: ENOSPC: no space left on device, write";
  assert.match(friendlyErrorText(raw, false), /disk is full/);
  assert.match(friendlyErrorText(raw, true), /พื้นที่จัดเก็บเต็ม/);
  assert.match(friendlyErrorText('Not enough free space to save this photo. Free space or choose another folder.', true), /พื้นที่จัดเก็บเต็ม/);
  assert.match(friendlyErrorText('EDQUOT: disk quota exceeded', false), /disk is full/);
});

test('drops the IPC wrapper from other errors and leaves plain messages alone', () => {
  assert.equal(friendlyErrorText("Error invoking remote method 'koko:save-photo': Error: Invalid JPEG image", false), 'Invalid JPEG image');
  assert.equal(friendlyErrorText('Capture session canceled', false), 'Capture session canceled');
});
