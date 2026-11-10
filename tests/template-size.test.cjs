const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TEMPLATE_SIZES, allowedCounts, bestSizeFor, canvasSize, countAfterSizeChange, countAllowed, isTemplateSize, sizeInfo } = require('../src/shared/template-size.ts');
const { defaultPhotoSlots, isValidPhotoSlot, slotGrid } = require('../src/renderer/template-layout.ts');

test('a template without a size is the original layout and keeps its original canvas', () => {
  assert.deepEqual(canvasSize(undefined, 1), { width: 1200, height: 1500 });
  assert.deepEqual(canvasSize(undefined, 2), { width: 1200, height: 1800 });
  assert.deepEqual(canvasSize(undefined, 4), { width: 1200, height: 1600 });
  assert.deepEqual(canvasSize('classic', 2), { width: 1200, height: 1800 });
  assert.equal(sizeInfo('nope').id, 'classic');
  assert.equal(isTemplateSize('strip'), true); assert.equal(isTemplateSize('huge'), false); assert.equal(isTemplateSize(undefined), false);
});

test('each size has the canvas and photo counts the booth needs, led by the vertical strip', () => {
  assert.deepEqual(canvasSize('strip', 3), { width: 1200, height: 3600 });
  assert.deepEqual(canvasSize('postcard', 2), { width: 1200, height: 1800 });
  assert.deepEqual(canvasSize('landscape', 3), { width: 1800, height: 1200 });
  assert.deepEqual(canvasSize('square', 4), { width: 1200, height: 1200 });
  assert.deepEqual(canvasSize('story', 3), { width: 1080, height: 1920 });
  assert.deepEqual(canvasSize('photo5x7', 1), { width: 1200, height: 1680 });
  assert.equal(TEMPLATE_SIZES[0].id, 'strip');
  assert.deepEqual(allowedCounts('strip'), [2, 3, 4]);
  assert.deepEqual(allowedCounts('classic'), [1, 2, 4]);
  assert.equal(countAllowed('strip', 3), true); assert.equal(countAllowed('strip', 1), false); assert.equal(countAllowed('classic', 3), false); assert.equal(countAllowed('square', 5), false);
  assert.equal(countAfterSizeChange('strip', 1), 3); assert.equal(countAfterSizeChange('strip', 4), 3); assert.equal(countAfterSizeChange('postcard', 4), 4); assert.equal(countAfterSizeChange('square', 3), 1); assert.equal(countAfterSizeChange('story', 4), 1);
});

test('chooses the size closest to a design made elsewhere, or none when the shape does not fit', () => {
  assert.equal(bestSizeFor(1200, 3600, 3), 'strip');
  assert.equal(bestSizeFor(600, 1800, 4), 'strip');
  assert.equal(bestSizeFor(1500, 2250, 2), 'postcard');
  assert.equal(bestSizeFor(1800, 1200, 3), 'landscape');
  assert.equal(bestSizeFor(1080, 1920, 3), 'story');
  assert.equal(bestSizeFor(1000, 1000, 4), 'square');
  assert.equal(bestSizeFor(3000, 1000, 4), null);
  assert.equal(bestSizeFor(1920, 1080, 4), 'landscape');
  assert.equal(bestSizeFor(0, 100, 2), null);
});

// The original formula, kept here as the reference so existing templates are proven to look exactly as before.
function originalSlots(count, title, logo, footer, showDate) {
  const width = 1200; const height = count === 1 ? 1500 : count === 2 ? 1800 : 1600;
  const top = title || logo ? 190 : 90; const footerHeight = footer || showDate ? 190 : 90; const gap = 24; const side = 82;
  const areaHeight = height - top - footerHeight - side;
  const boxes = count === 1 ? [{ x: side, y: top, width: width - side * 2, height: areaHeight }]
    : count === 2 ? [0, 1].map(index => ({ x: side, y: top + index * (areaHeight + gap) / 2, width: width - side * 2, height: (areaHeight - gap) / 2 }))
      : [0, 1, 2, 3].map(index => ({ x: side + (index % 2) * (width - side * 2 + gap) / 2, y: top + Math.floor(index / 2) * (areaHeight + gap) / 2, width: (width - side * 2 - gap) / 2, height: (areaHeight - gap) / 2 }));
  return boxes.map(box => ({ x: box.x / width * 100, y: box.y / height * 100, width: box.width / width * 100, height: box.height / height * 100 }));
}

test('original layouts come out exactly as before', () => {
  for (const count of [1, 2, 4]) for (const [title, logo, footer, date] of [['T', '', 'F', true], ['', '', '', false], ['', 'logo', '', true]]) {
    const expected = originalSlots(count, title, logo, footer, date);
    for (const size of [undefined, 'classic']) {
      const actual = defaultPhotoSlots(count, title, logo, footer, date, size);
      assert.equal(actual.length, count);
      actual.forEach((slot, i) => ['x', 'y', 'width', 'height'].forEach(key => assert.ok(Math.abs(slot[key] - expected[i][key]) < 1e-9, `${count} ${key}`)));
    }
  }
});

test('every size and photo count gives valid, non-overlapping openings inside the canvas', () => {
  for (const info of TEMPLATE_SIZES) for (const count of info.counts) {
    const slots = defaultPhotoSlots(count, 'Title', '', 'Footer', true, info.id);
    assert.equal(slots.length, count, `${info.id} ${count}`);
    assert.ok(slots.every(isValidPhotoSlot), `${info.id} ${count} valid`);
    for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
      const p = slots[a]; const q = slots[b];
      const overlap = p.x < q.x + q.width - 1e-6 && q.x < p.x + p.width - 1e-6 && p.y < q.y + q.height - 1e-6 && q.y < p.y + p.height - 1e-6;
      assert.equal(overlap, false, `${info.id} ${count} ${a}/${b}`);
    }
  }
});

test('strips stack photos top to bottom with usable, evenly sized openings', () => {
  const { width, height } = canvasSize('strip', 3);
  const slots = defaultPhotoSlots(3, '', '', '', false, 'strip');
  assert.deepEqual(slotGrid(3, 'strip'), { columns: 1, rows: 3 });
  assert.deepEqual(slotGrid(4, 'strip'), { columns: 1, rows: 4 });
  const pixels = slots.map(slot => ({ w: slot.width / 100 * width, h: slot.height / 100 * height }));
  pixels.forEach(p => { assert.ok(p.w > 900); assert.ok(p.h > 600 && p.h < 1100); });
  assert.ok(Math.abs(pixels[0].h - pixels[2].h) < 1e-6);
  assert.ok(slots[0].y < slots[1].y && slots[1].y < slots[2].y);
  const four = defaultPhotoSlots(4, '', '', '', false, 'strip');
  assert.ok(four.every(slot => Math.abs(slot.x - four[0].x) < 1e-9));
});

test('landscape sizes put two photos side by side, three as one large plus two small, and four in a grid', () => {
  assert.deepEqual(slotGrid(2, 'landscape'), { columns: 2, rows: 1 });
  assert.deepEqual(slotGrid(4, 'landscape'), { columns: 2, rows: 2 });
  assert.deepEqual(slotGrid(4, 'portrait'), { columns: 2, rows: 2 });
  const { width, height } = canvasSize('landscape', 3);
  const [big, topRight, bottomRight] = defaultPhotoSlots(3, '', '', '', false, 'landscape');
  assert.ok(big.x < topRight.x && Math.abs(topRight.x - bottomRight.x) < 1e-9);
  assert.ok(topRight.y < bottomRight.y && Math.abs(big.y - topRight.y) < 1e-9);
  assert.ok(big.width > topRight.width && big.height > topRight.height);
  // Large photo and small photos are close to a landscape camera picture's shape, not tall slivers.
  const aspect = slot => (slot.width / 100 * width) / (slot.height / 100 * height);
  assert.ok(aspect(big) > 1.0 && aspect(big) < 1.9, `large ${aspect(big)}`);
  assert.ok(aspect(topRight) > 1.0 && aspect(topRight) < 2.2, `small ${aspect(topRight)}`);
  assert.ok(Math.abs(aspect(topRight) - aspect(bottomRight)) < 1e-9);
});
