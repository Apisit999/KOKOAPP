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

test('raster: a logo is centred on a strip as wide as the paper (or cropped if too wide), never distorted', () => {
  const { padRasterToWidth } = require('../src/shared/receipt-raster.ts');
  const logo = { width: 16, height: 2, data: new Uint8Array([0xff, 0xff, 0x81, 0x81]) };
  const padded = padRasterToWidth(logo, 48);
  assert.equal(padded.width, 48);
  assert.deepEqual([...padded.data], [0, 0, 0xff, 0xff, 0, 0, 0, 0, 0x81, 0x81, 0, 0], 'two bytes centred in six: two blank bytes each side');
  assert.equal(padRasterToWidth(logo, 16), logo, 'exact width is returned as it is');
  const wide = { width: 24, height: 1, data: new Uint8Array([0x11, 0xff, 0x22]) };
  assert.deepEqual([...padRasterToWidth(wide, 8).data], [0xff], 'the middle byte survives a crop to 8 dots');
  assert.throws(() => padRasterToWidth(logo, 10), /Invalid receipt image/);
});

test('logo: BGRA with premultiplied alpha becomes straight RGBA; fully transparent pixels turn white', () => {
  const { rgbaFromPremultipliedBgra, rasterFromRgba } = require('../src/shared/receipt-raster.ts');
  // black opaque, red half-transparent (premultiplied: 128 in the red slot), fully transparent
  const rgba = rgbaFromPremultipliedBgra(Uint8Array.from([0, 0, 0, 255, 0, 0, 128, 128, 0, 0, 0, 0]));
  assert.deepEqual([...rgba], [0, 0, 0, 255, 255, 0, 0, 128, 255, 255, 255, 0]);
  const raster = rasterFromRgba(rgba, 3, 1);
  assert.equal(raster.data[0] & 0x80, 0x80, 'the opaque black pixel is a dot');
  assert.equal(raster.data[0] & 0x20, 0, 'the transparent pixel stays blank');
  assert.throws(() => rgbaFromPremultipliedBgra(Uint8Array.from([1, 2, 3])), /Invalid receipt image/);
});

test('receipt: a logo replaces the text heading, is as wide as the paper, and comes before the QR', () => {
  const { buildReceipt } = require('../src/main/services/escpos-receipt.ts');
  const { emulate } = require('./helpers/escpos-emulator.cjs');
  for (const paper of [58, 80]) {
    const dots = paper === 58 ? 384 : 576;
    const result = emulate(buildReceipt({ shareUrl: URL, paper, logoRaster: { width: 64, height: 10, data: new Uint8Array(8 * 10).fill(0xf0) } }), { paperDots: dots });
    assert.deepEqual(result.problems, []);
    const kinds = result.items.filter(item => item.type === 'raster' || item.type === 'qr' || item.type === 'text').map(item => item.type + (item.text ? ':' + item.text.trim() : ''));
    assert.deepEqual(kinds.slice(0, 3), ['raster', 'text:Scan for your photos', 'qr'], 'no KOKO MEMORY text, logo first, then the caption and the QR');
    assert.equal(result.items.find(item => item.type === 'raster').width, dots);
  }
  assert.ok(emulate(buildReceipt({ shareUrl: URL })).items.some(item => item.type === 'text' && item.text.includes('KOKO MEMORY')), 'plain heading without a logo');
});

test('logo: a mostly dark picture is detected and can be flipped to dark marks on white', () => {
  const { rasterFromRgba, darkRatio, LOGO_INVERT_ABOVE } = require('../src/shared/receipt-raster.ts');
  const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
  const mostlyDark = Uint8Array.from([black, black, black, white].flat());
  assert.equal(darkRatio(mostlyDark), 0.75);
  assert.ok(darkRatio(mostlyDark) > LOGO_INVERT_ABOVE);
  assert.ok(darkRatio(Uint8Array.from([black, white, white, white].flat())) < LOGO_INVERT_ABOVE);
  assert.equal(darkRatio(Uint8Array.from([0, 0, 0, 0])), 0, 'transparent counts as white');
  const normal = rasterFromRgba(mostlyDark, 4, 1);
  const flipped = rasterFromRgba(mostlyDark, 4, 1, 140, true);
  assert.equal(normal.data[0] & 0xf0, 0xe0, 'three dots black');
  assert.equal(flipped.data[0] & 0xf0, 0x10, 'only the light dot is black after flipping');
  assert.equal(flipped.data[0] & 0x0f, 0, 'padding columns never turn black');
});
