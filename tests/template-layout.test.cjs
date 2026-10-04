const assert = require('node:assert/strict');
const { test } = require('node:test');
const { defaultPhotoSlots, isValidPhotoSlot, movePhotoSlot, normalizedRectToPixels, resizePhotoSlot } = require('../src/renderer/template-layout.ts');

test('default photo openings match each print layout and stay within the canvas', () => {
  for (const count of [1, 2, 4]) {
    const slots = defaultPhotoSlots(count, 'Title', '', 'Footer', true);
    assert.equal(slots.length, count);
    assert.ok(slots.every(isValidPhotoSlot));
  }
});

test('moving and resizing a photo opening clamps it to the printable canvas', () => {
  const slot = { x: 20, y: 25, width: 30, height: 35 };
  assert.deepEqual(movePhotoSlot(slot, 100, 100), { ...slot, x: 70, y: 65 });
  assert.deepEqual(movePhotoSlot(slot, -100, -100), { ...slot, x: 0, y: 0 });
  assert.deepEqual(resizePhotoSlot(slot, 100, 100), { ...slot, width: 80, height: 75 });
  assert.deepEqual(resizePhotoSlot(slot, -100, -100), { ...slot, width: 8, height: 6 });
  assert.ok(isValidPhotoSlot(resizePhotoSlot(slot, 100, 100)));
  assert.equal(isValidPhotoSlot({ x: -1, y: 0, width: 20, height: 20 }), false);
});

test('maps normalized frame placement to the expected output pixels for portrait and landscape clips', () => {
  const rect = { x: 10, y: 20, width: 50, height: 60 };
  assert.deepEqual(normalizedRectToPixels(rect, 1920, 1080), { x: 192, y: 216, width: 960, height: 648 });
  assert.deepEqual(normalizedRectToPixels(rect, 1080, 1920), { x: 108, y: 384, width: 540, height: 1152 });
  assert.throws(() => normalizedRectToPixels({ ...rect, width: 200 }, 1920, 1080), /geometry/);
});
