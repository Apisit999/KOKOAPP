const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer } = require('node:net');
const { buildReceipt, sendToNetworkPrinter } = require('../src/main/services/escpos-receipt.ts');
const { sendReceipt } = require('../src/main/services/receipt-printers.ts');
const { emulate } = require('./helpers/escpos-emulator.cjs');

const SHARE = `https://kokomemory.com/s/${'A'.repeat(43)}?openExternalBrowser=1`;
const FRAGMENT = `https://photos.kokomemory.com/share#775f8a8a-631c-45b1-8e54-51a77f0bdde5.${'b'.repeat(43)}`;
const CAPTION = { width: 384, height: 3, data: new Uint8Array(48 * 3).fill(0x55) };
const full = (extra = {}) => ({ shareUrl: SHARE, shortCode: 'ABCD2345', eventUrl: 'https://kokomemory.com/e/' + 'a'.repeat(32), expiresAt: '2026-12-18T00:00:00Z', ...extra });
const dotsFor = paper => (paper === 58 ? 384 : 576);

for (const paper of [58, 80]) {
  test(`virtual printer, ${paper} mm: a normal receipt prints in order, the QR carries the exact link, nothing is unknown or too wide`, () => {
    const result = emulate(buildReceipt(full({ paper, captionRaster: { ...CAPTION, width: dotsFor(paper), data: new Uint8Array((dotsFor(paper) / 8) * 3) } })), { paperDots: dotsFor(paper) });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.unknown, []);
    const kinds = result.items.filter(item => !['feed', 'reset'].includes(item.type)).map(item => item.type + (item.text ? `:${item.text.trim()}` : ''));
    const address = kinds.filter(kind => kind.startsWith('text:') && !['text:KOKO MEMORY', 'text:or enter code', 'text:ABCD 2345', 'text:Valid until 18 Dec 2026'].includes(kind)).map(kind => kind.slice(5));
    assert.equal(address.join(''), 'at kokomemory.com/e/' + 'a'.repeat(32), 'the guest address is wrapped over rows, never cut off');
    assert.deepEqual(kinds.filter(kind => !kind.startsWith('text:at ') && !address.includes(kind.slice(5))), ['text:KOKO MEMORY', 'raster', 'qr', 'text:or enter code', 'text:ABCD 2345', 'text:Valid until 18 Dec 2026', 'cut']);
    const qr = result.items.find(item => item.type === 'qr');
    assert.equal(qr.data, SHARE);
    assert.equal(qr.ecc, 'M');
    assert.ok(qr.dots <= dotsFor(paper));
    assert.ok(result.items.every(item => item.type !== 'text' || item.text.length <= (paper === 58 ? 32 : 48)), 'text lines fit the paper');
  });
}

test('virtual printer: a long photo-cloud link with a secret fragment still fits on 58 mm paper', () => {
  const result = emulate(buildReceipt({ shareUrl: FRAGMENT, paper: 58 }), { paperDots: 384 });
  assert.deepEqual(result.problems, []);
});

test('virtual printer: the longest link the builder accepts never prints a QR wider than the paper', () => {
  for (const paper of [58, 80]) {
    const url = 'https://kokomemory.com/s/' + 'x'.repeat(600);
    let bytes;
    try { bytes = buildReceipt({ shareUrl: url, paper }); } catch (error) { assert.match(error.message, /too long|Invalid/); continue; }
    assert.deepEqual(emulate(bytes, { paperDots: dotsFor(paper) }).problems, [], `${paper} mm`);
  }
});

test('virtual printer over a real socket: the bytes that arrive on the LAN port print the same receipt', async () => {
  const chunks = [];
  const server = createServer(socket => { socket.on('data', chunk => chunks.push(chunk)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await sendReceipt({ kind: 'network', host: '127.0.0.1', port: server.address().port }, buildReceipt(full()));
    await new Promise(resolve => setTimeout(resolve, 50));
  } finally { server.close(); }
  const result = emulate(Buffer.concat(chunks), { paperDots: 384 });
  assert.deepEqual(result.problems, []);
  assert.equal(result.items.find(item => item.type === 'qr').data, SHARE);
});

test('virtual printer over the serial path: the same bytes reach the COM port writer', async () => {
  const { sendToSerialPrinter } = require('../src/main/services/receipt-printers.ts');
  let written;
  await sendToSerialPrinter('COM4', buildReceipt(full()), {}, async () => '', async (path, data) => { written = { path, data }; });
  assert.equal(written.path, String.raw`\\.\COM4`);
  assert.deepEqual(emulate(written.data).problems, []);
});
