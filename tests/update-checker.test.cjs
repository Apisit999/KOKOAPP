const assert = require('node:assert/strict');
const { test } = require('node:test');
const { UpdateChecker } = require('../src/main/services/update-checker.ts');

const device = '11111111-1111-4111-8111-111111111111';
const base = 'https://studio.example.invalid';
const sha = 'a'.repeat(64);
const available = (extra = {}) => ({ updateAvailable: true, currentVersion: '0.1.28', mandatory: false, latest: { version: '0.1.30', notes: ['fix'], publishedAt: '2026-10-30T00:00:00Z', fileSize: 1000, sha256: sha, downloadUrl: `${base}/api/studio/download?version=0.1.30`, ...extra } });
function make(handler, apiBaseUrl = base) {
  const calls = [];
  const checker = new UpdateChecker({ apiBaseUrl, currentVersion: '0.1.28', getDeviceId: () => device, now: () => Date.parse('2026-10-30T12:00:00Z'),
    fetcher: async (url, init) => { calls.push({ url, init }); return handler(url); } });
  return { checker, calls };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('reports an available update, keeps the URL in Main, and sends only version, channel and device id', async () => {
  const { checker, calls } = make(() => json(available()));
  const status = await checker.check();
  assert.equal(status.state, 'available'); assert.equal(status.latest.version, '0.1.30'); assert.equal(status.mandatory, false);
  assert.equal(JSON.stringify(status).includes('download'), false);
  assert.equal(checker.getDownloadUrl(), `${base}/api/studio/download?version=0.1.30`);
  assert.equal(calls[0].url, `${base}/v1/desktop/updates?version=0.1.28&channel=stable&deviceId=${device}`);
  assert.equal(calls[0].init.redirect, 'error');
});
test('mandatory flag and current state are passed through', async () => {
  const mandatory = await make(() => json({ ...available(), mandatory: true })).checker.check();
  assert.equal(mandatory.mandatory, true);
  const { checker } = make(() => json({ updateAvailable: false, currentVersion: '0.1.28' }));
  const current = await checker.check();
  assert.equal(current.state, 'current'); assert.equal(checker.getDownloadUrl(), null);
});
test('rejects a download URL on another origin or path', async () => {
  for (const downloadUrl of ['https://evil.example.invalid/api/studio/download', `${base}/other/file.exe`, 'file:///C:/x.exe', 'javascript:alert(1)']) {
    const { checker } = make(() => json(available({ downloadUrl })));
    assert.equal((await checker.check()).state, 'unknown'); assert.equal(checker.getDownloadUrl(), null);
  }
});
test('malformed answers and failures never throw and keep the last good answer', async () => {
  let mode = 'good';
  const { checker } = make(() => { if (mode === 'good') return json(available()); if (mode === 'down') throw new Error('offline'); if (mode === 'http') return json({}, 503); return json({ updateAvailable: 'yes' }); });
  assert.equal((await checker.check()).state, 'available');
  for (mode of ['down', 'http', 'junk']) assert.equal((await checker.check()).state, 'available');
  const fresh = make(() => json({ latest: 1 })).checker;
  assert.equal((await fresh.check()).state, 'unknown');
});
test('notes and checksum are sanitized and an unconfigured or insecure base disables checking', async () => {
  const { checker } = make(() => json(available({ notes: ['ok', 5, 'x'.repeat(500)], sha256: 'nope' })));
  const status = await checker.check();
  assert.deepEqual(status.latest.notes.map(n => n.length), [2, 300]); assert.equal(status.latest.sha256, '');
  for (const apiBaseUrl of ['', 'http://studio.example.invalid', 'not a url']) {
    const { checker: disabled, calls } = make(() => json(available()), apiBaseUrl);
    assert.equal((await disabled.check()).state, 'unknown'); assert.equal(calls.length, 0);
  }
  const local = make(() => json(available({ downloadUrl: 'http://127.0.0.1:3040/api/studio/download' })), 'http://127.0.0.1:3040');
  assert.equal((await local.checker.check()).state, 'available');
});
