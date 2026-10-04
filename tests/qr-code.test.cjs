const assert = require('node:assert/strict');
const { test } = require('node:test');
const QRCode = require('qrcode');

test('creates a local PNG QR for the private album URL including its secret fragment', async () => {
  const url = `https://photos.example.test/share#775f8a8a-631c-45b1-8e54-51a77f0bdde5.${'b'.repeat(43)}`;
  const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.ok(dataUrl.length < 500_000);
});
