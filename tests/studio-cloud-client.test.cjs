const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { StudioCloudClient, StudioCloudError } = require('../src/main/services/studio-cloud-client.ts');

const SESSION = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';
const EVENT = 'a'.repeat(32);
const bytes = text => new Uint8Array(Buffer.from(text));

function make(overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'koko-cloud-'));
  const calls = []; const puts = [];
  const api = { call: async (route, payload) => {
    calls.push({ route, payload });
    if (overrides[route]) return overrides[route](payload, calls);
    if (route.endsWith('/events')) return { eventId: EVENT };
    if (route.endsWith('/init')) return { photoId: 'x', alreadyUploaded: false, uploadUrl: 'https://upload.example.invalid/k?sig=1' };
    return { photoId: 'x', status: 'ready' };
  } };
  const client = new StudioCloudClient(dir, api, async (url, data) => { puts.push({ url, size: data.byteLength }); });
  return { dir, calls, puts, client };
}
const session = (photos, extra = {}) => ({ sessionId: SESSION, eventId: null, eventName: 'Wedding A', photos, ...extra });

test('uploads a session: event once, then init, upload and confirm per photo', async () => {
  const f = make();
  const result = await f.client.uploadSession(session([{ id: P1, bytes: bytes('one') }, { id: P2, bytes: bytes('two!') }]));
  assert.deepEqual(result, { uploaded: 2, skipped: 0 });
  assert.deepEqual(f.calls.map(c => c.route.split('/').slice(-2).join('/')), ['cloud/events', 'photos/init', 'photos/confirm', 'photos/init', 'photos/confirm']);
  assert.equal(f.calls[0].payload.clientEventId, `session-${SESSION}`);
  assert.equal(f.calls[1].payload.photoId, P1.replace(/-/g, ''));
  assert.equal(f.calls[1].payload.size, 3);
  assert.match(f.calls[1].payload.sha256, /^[0-9a-f]{64}$/);
  assert.equal(f.puts.length, 2);
  assert.equal(f.client.isUploaded(P1), true);
});

test('a repeated session sends nothing; photos already confirmed are never uploaded twice', async () => {
  const f = make();
  await f.client.uploadSession(session([{ id: P1, bytes: bytes('one') }]));
  const before = f.calls.length;
  const again = await f.client.uploadSession(session([{ id: P1, bytes: bytes('one') }]));
  assert.deepEqual(again, { uploaded: 0, skipped: 1 });
  assert.equal(f.calls.length, before);
});

test('a network failure keeps progress: the next attempt resumes with the remaining photos only', async () => {
  let failOnce = true;
  const f = make({ '/v1/desktop/cloud/photos/confirm': (payload) => { if (payload.photoId === P2.replace(/-/g, '') && failOnce) { failOnce = false; throw new Error('network down'); } return { status: 'ready' }; } });
  const photos = [{ id: P1, bytes: bytes('one') }, { id: P2, bytes: bytes('two!') }];
  await assert.rejects(f.client.uploadSession(session(photos)), error => error instanceof StudioCloudError && error.permanent === false);
  assert.equal(f.client.isUploaded(P1), true);
  assert.equal(f.client.isUploaded(P2), false);
  const retry = await f.client.uploadSession(session(photos));
  assert.deepEqual(retry, { uploaded: 1, skipped: 1 });
  assert.equal(f.calls.filter(c => c.route.endsWith('/events')).length, 1, 'the event is created once and remembered');
});

test('when the server already has the photo, nothing is uploaded again', async () => {
  const f = make({ '/v1/desktop/cloud/photos/init': () => ({ alreadyUploaded: true }) });
  await f.client.uploadSession(session([{ id: P1, bytes: bytes('one') }]));
  assert.equal(f.puts.length, 0);
  assert.equal(f.client.isUploaded(P1), true);
});

test('server refusals such as quota are reported as permanent, and unsafe upload URLs are rejected', async () => {
  const quota = make({ '/v1/desktop/cloud/photos/init': () => { throw new StudioCloudError('quota_exceeded', true); } });
  await assert.rejects(quota.client.uploadSession(session([{ id: P1, bytes: bytes('one') }])), error => error.code === 'quota_exceeded' && error.permanent === true);
  const http = make({ '/v1/desktop/cloud/photos/init': () => ({ alreadyUploaded: false, uploadUrl: 'http://evil.example.invalid/x' }) });
  await assert.rejects(http.client.uploadSession(session([{ id: P1, bytes: bytes('one') }])), /bad_response/);
  assert.equal(http.puts.length, 0);
});

test('oversized or empty photos are rejected before any request, and a damaged index is preserved', async () => {
  const f = make();
  await assert.rejects(f.client.uploadSession(session([{ id: P1, bytes: new Uint8Array(0) }])), /invalid_photo/);
  assert.equal(f.calls.filter(c => c.route.endsWith('/init')).length, 0);
  const g = make();
  writeFileSync(path.join(g.dir, 'studio-cloud-index.json'), '{broken');
  await assert.rejects(g.client.uploadSession(session([{ id: P1, bytes: bytes('one') }])), /damaged/);
});

test('guest link: created once per session and remembered; a revoked link is never silently re-issued', async () => {
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const calls = [];
  const dir = mkdtempSync(path.join(tmpdir(), 'koko-cloud-'));
  const api = { call: async (route, payload) => {
    calls.push(route);
    if (route.endsWith('/shares')) return { url: 'https://studio.example.invalid/s/' + 'A'.repeat(43), expiresAt: '2026-12-01T00:00:00Z' };
    if (route.endsWith('/shares/revoke')) return { revoked: true };
    throw new Error('unexpected ' + route);
  } };
  const client = new StudioCloudClient(dir, api, async () => {}, () => clock);
  const first = await client.ensureShare(SESSION);
  assert.equal(first.revoked, false);
  assert.equal((await client.ensureShare(SESSION)).url, first.url);
  assert.equal(calls.length, 1, 'the second call is served from the saved link');
  assert.equal(client.getShare(SESSION).url, first.url);
  assert.equal(await client.revokeShare(SESSION), true);
  assert.equal(await client.ensureShare(SESSION), null, 'after cancelling, no new link appears by itself');
  assert.equal(client.getShare(SESSION).revoked, true);
  assert.equal(await client.revokeShare(SESSION), true);
  assert.equal(calls.filter(c => c.endsWith('/revoke')).length, 1, 'cancelling twice calls the server once');
  assert.equal(await client.revokeShare('44444444-4444-4444-8444-444444444444'), false);
});

test('guest link: an expired link is replaced, a failed cancel can be retried, and unsafe links are refused', async () => {
  let clock = Date.parse('2026-11-01T00:00:00Z'); let n = 0; let failRevoke = true;
  const dir = mkdtempSync(path.join(tmpdir(), 'koko-cloud-'));
  const api = { call: async (route) => {
    if (route.endsWith('/shares/revoke')) { if (failRevoke) { failRevoke = false; throw new Error('network down'); } return { revoked: true }; }
    n += 1; return { url: 'https://studio.example.invalid/s/' + String(n).repeat(43), expiresAt: new Date(clock + 30 * 86400000).toISOString() };
  } };
  const client = new StudioCloudClient(dir, api, async () => {}, () => clock);
  const a = await client.ensureShare(SESSION);
  clock += 31 * 86400000;
  const b = await client.ensureShare(SESSION);
  assert.notEqual(a.url, b.url);
  await assert.rejects(client.revokeShare(SESSION), error => error instanceof StudioCloudError && error.permanent === false);
  assert.equal(client.getShare(SESSION).revoked, false, 'a failed cancel is not recorded as done');
  assert.equal(await client.revokeShare(SESSION), true);
  for (const bad of ['http://evil.example.invalid/s/x', 'javascript:alert(1)', 'not a url']) {
    const other = new StudioCloudClient(mkdtempSync(path.join(tmpdir(), 'koko-cloud-')), { call: async () => ({ url: bad, expiresAt: '2026-12-01T00:00:00Z' }) }, async () => {}, () => clock);
    await assert.rejects(other.ensureShare(SESSION), /bad_response/);
  }
  const local = new StudioCloudClient(mkdtempSync(path.join(tmpdir(), 'koko-cloud-')), { call: async () => ({ url: 'http://127.0.0.1:3040/s/abc', expiresAt: '2026-12-01T00:00:00Z' }) }, async () => {}, () => clock);
  assert.equal((await local.ensureShare(SESSION)).url, 'http://127.0.0.1:3040/s/abc');
});

test('an index file written before guest links existed still loads', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'koko-cloud-'));
  writeFileSync(path.join(dir, 'studio-cloud-index.json'), JSON.stringify({ schemaVersion: 1, events: {}, uploaded: ['a'.repeat(32)] }));
  const client = new StudioCloudClient(dir, { call: async () => ({}) }, async () => {});
  assert.equal(client.isUploaded('a'.repeat(32)), true);
  assert.equal(client.getShare(SESSION), null);
});
