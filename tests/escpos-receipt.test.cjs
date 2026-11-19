const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer } = require('node:net');
const { buildReceipt, sendToNetworkPrinter } = require('../src/main/services/escpos-receipt.ts');

const URL = `https://kokomemory.com/s/${'A'.repeat(43)}?openExternalBrowser=1`;
const find = (bytes, seq) => Buffer.from(bytes).indexOf(Buffer.from(seq));

test('receipt: reset first, native QR with the exact link, error correction M, then a cut', () => {
  const bytes = Buffer.from(buildReceipt({ shareUrl: URL, shortCode: 'ABCD2345', eventUrl: 'https://kokomemory.com/e/' + 'a'.repeat(32), expiresAt: '2026-12-18T00:00:00Z' }));
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40]);
  const store = find(bytes, [0x1d, 0x28, 0x6b]) ;
  assert.ok(store > 0);
  const storeAt = find(bytes, [0x31, 0x50, 0x30]);
  const length = bytes[storeAt - 2] | (bytes[storeAt - 1] << 8);
  assert.equal(length, Buffer.byteLength(URL) + 3, 'pL/pH count the data plus three');
  assert.equal(bytes.subarray(storeAt + 3, storeAt + 3 + Buffer.byteLength(URL)).toString('ascii'), URL);
  assert.ok(find(bytes, [0x31, 0x45, 0x31]) > 0, 'error correction M');
  assert.ok(find(bytes, [0x31, 0x51, 0x30]) > storeAt, 'printed after it is stored');
  assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 0x42, 3]);
  const shown = bytes.toString('latin1');
  assert.ok(shown.includes('ABCD 2345'));
  assert.ok(shown.includes('at kokomemory.com/e/'));
  assert.ok(shown.includes('Valid until 18 Dec 2026'));
});

test('receipt: Thai event names are left out instead of printing garbage; wider paper gets a bigger QR', () => {
  const thai = Buffer.from(buildReceipt({ shareUrl: URL, eventName: 'งานแต่ง A' }));
  assert.ok(thai.every(byte => byte < 0x80), 'no bytes outside ASCII reach the printer');
  assert.ok(Buffer.from(buildReceipt({ shareUrl: URL, eventName: 'Wedding A' })).toString('latin1').includes('Wedding A'));
  const size = paper => { const b = Buffer.from(buildReceipt({ shareUrl: URL, paper })); return b[find(b, [0x31, 0x43]) + 2]; };
  assert.ok(size(80) > size(58));
});

test('receipt: bad links and codes are refused or skipped, never printed', () => {
  assert.throws(() => buildReceipt({ shareUrl: 'javascript:alert(1)' }), /Invalid guest link/);
  assert.throws(() => buildReceipt({ shareUrl: 'http://evil.example/s/x' }), /Invalid guest link/);
  assert.throws(() => buildReceipt({ shareUrl: 'https://kokomemory.com/' + 'x'.repeat(800) }), /too long/);
  assert.ok(!Buffer.from(buildReceipt({ shareUrl: URL, shortCode: 'O0I1abcd' })).toString('latin1').includes('enter code'));
});

test('network printer: every byte arrives on port 9100-style sockets; a dead printer fails fast', async () => {
  const received = [];
  const server = createServer(socket => socket.on('data', chunk => received.push(chunk)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const bytes = buildReceipt({ shareUrl: URL, shortCode: 'ABCD2345' });
  await sendToNetworkPrinter('127.0.0.1', bytes, { port });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(Buffer.concat(received), Buffer.from(bytes));
  server.close();
  await assert.rejects(sendToNetworkPrinter('127.0.0.1', bytes, { port, timeoutMs: 1000 }), /unavailable|did not answer/);
  await assert.rejects(sendToNetworkPrinter('bad host;rm', bytes), /Invalid printer address/);
});

test('raster: dark pixels become set bits (MSB first), padded to whole bytes; the command carries width in bytes and rows', () => {
  const { rasterFromRgba, rasterCommands } = require('../src/main/services/escpos-receipt.ts');
  const px = (r, g, b, a = 255) => [r, g, b, a];
  const row = [px(0, 0, 0), px(255, 255, 255), px(0, 0, 0), px(0, 0, 0, 0), px(10, 10, 10), px(250, 250, 250), px(0, 0, 0), px(255, 255, 255), px(0, 0, 0)];
  const raster = rasterFromRgba(new Uint8Array(row.flat()), 9, 1);
  assert.equal(raster.width, 16);
  assert.deepEqual([...raster.data], [0b10101010, 0b10000000], 'transparent counts as white');
  const command = rasterCommands(raster);
  assert.deepEqual([...command.subarray(0, 8)], [0x1d, 0x76, 0x30, 0, 2, 0, 1, 0]);
  assert.equal(command.length, 8 + 2);
});

test('raster: tall pictures are sent in strips of at most 128 rows; bad sizes are refused', () => {
  const { rasterCommands } = require('../src/main/services/escpos-receipt.ts');
  const command = rasterCommands({ width: 8, height: 300, data: new Uint8Array(300) });
  assert.equal(command.length, 3 * 8 + 300);
  assert.equal(command[6], 128);
  assert.throws(() => rasterCommands({ width: 10, height: 1, data: new Uint8Array(2) }), /Invalid receipt image/);
  assert.throws(() => rasterCommands({ width: 8, height: 2, data: new Uint8Array(1) }), /Invalid receipt image/);
  assert.throws(() => rasterCommands({ width: 8, height: 5000, data: new Uint8Array(5000) }), /Invalid receipt image/);
});

test('receipt: a caption picture replaces the ASCII caption and the QR still follows it', () => {
  const { buildReceipt } = require('../src/main/services/escpos-receipt.ts');
  const bytes = Buffer.from(buildReceipt({ shareUrl: URL, eventName: 'Wedding A', captionRaster: { width: 8, height: 2, data: new Uint8Array([0xff, 0x81]) } }));
  const shown = bytes.toString('latin1');
  assert.ok(!shown.includes('Wedding A') && !shown.includes('Scan for your photos'));
  assert.ok(find(bytes, [0x1d, 0x76, 0x30, 0]) > 0 && find(bytes, [0x1d, 0x76, 0x30, 0]) < find(bytes, [0x31, 0x50, 0x30]));
});

test('receipt: the event message picture prints under the validity line and before the cut', () => {
  const { buildReceipt } = require('../src/main/services/escpos-receipt.ts');
  const bytes = Buffer.from(buildReceipt({ shareUrl: URL, expiresAt: '2026-12-18T00:00:00Z', footerRaster: { width: 8, height: 1, data: new Uint8Array([0xaa]) } }));
  const valid = bytes.indexOf('Valid until');
  const raster = find(bytes, [0x1d, 0x76, 0x30, 0]);
  assert.ok(valid > 0 && raster > valid, 'picture after the validity line');
  assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 0x42, 3], 'still ends with the cut');
  assert.ok(!Buffer.from(buildReceipt({ shareUrl: URL })).includes(Buffer.from([0x1d, 0x76, 0x30])), 'no picture when there is no message');
});
