const assert = require('node:assert/strict');
const { test } = require('node:test');
const { drawImageLayers, drawTextLayers, validImageLayer, validTextLayer, wrapLines } = require('../src/renderer/template-layers.ts');

const layer = { id: 'title', text: 'A long caption for a test', x: 10, y: 20, width: 40, fontSize: 5, color: '#ffffff', align: 'center' };

test('accepts bounded text layers and rejects unsafe color, placement, and content', () => {
  assert.equal(validTextLayer(layer), true);
  assert.equal(validTextLayer({ ...layer, color: 'red;background:url(x)' }), false);
  assert.equal(validTextLayer({ ...layer, x: 90, width: 20 }), false);
  assert.equal(validTextLayer({ ...layer, text: 'x'.repeat(101) }), false);
});

test('wraps text to the requested line limit and draws it at normalized coordinates', () => {
  const measure = { measureText: text => ({ width: text.length * 10 }) };
  assert.deepEqual(wrapLines(measure, 'one two three four', 75, 3), ['one two', 'three', 'four']);
  const calls = [];
  const context = { save() {}, restore() {}, measureText: measure.measureText, fillText: (...args) => calls.push(args) };
  drawTextLayers(context, [layer], 1000, 2000);
  assert.ok(calls.length > 0);
  assert.equal(calls[0][1], 300);
  assert.equal(calls[0][2], 400);
});

test('validates PNG sticker layers and draws them using normalized geometry', () => {
  const layer = { id: 'badge', src: 'data:image/png;base64,iVBORw0KGgo=', x: 10, y: 20, width: 30, height: 40, bitmap: { marker: true } };
  assert.equal(validImageLayer(layer), true);
  assert.equal(validImageLayer({ ...layer, src: 'data:image/svg+xml;base64,PHN2Zz4=' }), false);
  assert.equal(validImageLayer({ ...layer, x: 80 }), false);
  const calls = [];
  drawImageLayers({ drawImage: (...args) => calls.push(args) }, [layer], 1000, 500);
  assert.deepEqual(calls[0].slice(1), [100, 100, 300, 200]);
});
