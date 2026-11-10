const assert = require('node:assert/strict');
const { test } = require('node:test');
const { detectOpenings, inReadingOrder, stretchNeeded, canvasHeightFor, posterize } = require('../src/renderer/frame-import.ts');

// An opaque frame of the given size with transparent rectangles (given in pixels) cut out of it.
function frame(width, height, holes, shape = 'rect') {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = 200; data[i * 4 + 1] = 160; data[i * 4 + 2] = 60; data[i * 4 + 3] = 255; }
  for (const [x, y, w, h] of holes) {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
      if (shape === 'ellipse') { const dx = (px - (x + w / 2)) / (w / 2); const dy = (py - (y + h / 2)) / (h / 2); if (dx * dx + dy * dy > 1) continue; }
      data[(py * width + px) * 4 + 3] = 0;
    }
  }
  return { width, height, data };
}
const near = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('finds a single photo window and reports it in percent of the image', () => {
  const found = detectOpenings(frame(300, 450, [[30, 60, 240, 240]]));
  assert.equal(found.length, 1);
  near(found[0].x, 10, 0.6); near(found[0].y, 60 / 450 * 100, 0.6); near(found[0].width, 80, 1); near(found[0].height, 240 / 450 * 100, 1);
});

test('finds two stacked windows and four windows in a grid, in reading order', () => {
  const two = detectOpenings(frame(300, 600, [[30, 300, 240, 200], [30, 40, 240, 200]]));
  assert.equal(two.length, 2);
  assert.ok(two[0].y < two[1].y);
  const four = detectOpenings(frame(400, 400, [[20, 20, 160, 160], [220, 20, 160, 160], [20, 220, 160, 160], [220, 220, 160, 160]]));
  assert.equal(four.length, 4);
  assert.deepEqual(four.map(item => [item.x < 50, item.y < 50]), [[true, true], [false, true], [true, false], [false, false]]);
});

test('accepts rounded and oval windows, ignores specks and a fully transparent image', () => {
  assert.equal(detectOpenings(frame(300, 300, [[30, 30, 240, 240]], 'ellipse')).length, 1);
  assert.equal(detectOpenings(frame(300, 300, [[10, 10, 4, 4], [100, 100, 200, 200]])).length, 1);
  assert.equal(detectOpenings(frame(200, 200, [[0, 0, 200, 200]])).length, 0);
  assert.equal(detectOpenings(frame(200, 200, [])).length, 0);
  assert.equal(detectOpenings({ width: 2, height: 2, data: new Uint8ClampedArray(16) }).length, 0);
});

test('semi-transparent shading is not treated as a window, thin gaps are ignored', () => {
  const image = frame(300, 300, [[30, 30, 240, 240]]);
  for (let i = 0; i < 300 * 300; i++) if (image.data[i * 4 + 3] === 255 && i % 7 === 0) image.data[i * 4 + 3] = 120;
  assert.equal(detectOpenings(image).length, 1);
  assert.equal(detectOpenings(frame(300, 300, [[0, 100, 300, 3]])).length, 0);
});

test('reading order groups windows whose tops are close', () => {
  const ordered = inReadingOrder([{ x: 60, y: 11, width: 30, height: 30 }, { x: 5, y: 10, width: 30, height: 30 }, { x: 5, y: 60, width: 30, height: 30 }]);
  assert.deepEqual(ordered.map(item => item.x), [5, 60, 5]);
});

test('works out how far a design must stretch to fit the layout canvas', () => {
  assert.equal(canvasHeightFor(1), 1500); assert.equal(canvasHeightFor(2), 1800); assert.equal(canvasHeightFor(4), 1600);
  near(stretchNeeded(1200, 1800, 2), 0, 0.0001);
  near(stretchNeeded(2400, 3600, 2), 0, 0.0001);
  near(stretchNeeded(1200, 1500, 2), 0.2, 0.0001);
  assert.ok(stretchNeeded(1920, 1080, 2) > 1);
});

test('posterize keeps transparency and limits colour levels', () => {
  const image = { data: new Uint8ClampedArray([10, 120, 250, 77, 130, 131, 132, 0]) };
  posterize(image, 4);
  assert.deepEqual(Array.from(image.data), [0, 85, 255, 77, 170, 170, 170, 0]);
});
