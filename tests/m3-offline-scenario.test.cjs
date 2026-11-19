// Master Prompt M3 acceptance, simulated: "unplug the internet for 10 minutes in the middle of an event: the receipt still prints
// within 5 seconds, all photos appear when the internet is back, no photo is lost."
// Real code: StudioCloudClient (links + uploads), RetryBackoff, the recovery pass, the receipt builder and a virtual printer.
// Simulated: the network, the clock and the printer.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { StudioCloudClient, StudioCloudError } = require('../src/main/services/studio-cloud-client.ts');
const { RetryBackoff } = require('../src/main/services/retry-backoff.ts');
const { recoverStudioCloudSessions } = require('../src/main/services/studio-cloud-recovery.ts');
const { buildReceipt } = require('../src/main/services/escpos-receipt.ts');
const { emulate } = require('./helpers/escpos-emulator.cjs');

const EVENT = 'b'.repeat(32);
const uuid = n => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSIONS = [1, 2, 3].map(n => ({ id: uuid(100 + n), photoIds: [uuid(n * 10 + 1), uuid(n * 10 + 2), uuid(n * 10 + 3)] }));

function booth() {
  const dir = mkdtempSync(path.join(tmpdir(), 'koko-m3-'));
  const world = { online: true, now: Date.parse('2026-11-19T18:00:00Z'), calls: 0, serverPhotos: new Set(), serverSessions: new Map() };
  const api = { call: async (route, payload) => {
    if (!world.online) throw new Error('network_error');
    world.calls++;
    if (route.endsWith('/events')) return { eventId: EVENT };
    // The very first round of a booth gets its link from the server; later ones are made on the PC.
    if (route.endsWith('/shares')) return { url: 'https://kokomemory.com/s/' + 'S'.repeat(43), expiresAt: new Date(world.now + 30 * 86400000).toISOString() };
    if (route.endsWith('/sessions')) { world.serverSessions.set(payload.sessionId, payload.expectedCount); return { shortCode: 'K7QM4XPA', expiresAt: new Date(world.now + 30 * 86400000).toISOString(), eventUrl: `https://kokomemory.com/e/${EVENT}` }; }
    if (route.endsWith('/init')) return { photoId: payload.photoId, alreadyUploaded: world.serverPhotos.has(payload.photoId), uploadUrl: 'https://upload.example.invalid/x' };
    if (route.endsWith('/confirm')) { world.serverPhotos.add(payload.photoId); return {}; }
    throw new Error('unexpected route ' + route);
  } };
  const upload = async () => { if (!world.online) throw new Error('network_error'); };
  const makeClient = () => new StudioCloudClient(dir, api, upload, () => world.now, 'https://kokomemory.com');
  let client = makeClient();
  const backoff = new RetryBackoff();
  const bytesOf = id => new Uint8Array(Buffer.from('jpeg-' + id));
  // What the app does when a round finishes (index.ts: syncSessionToStudioCloud): link first, then try the upload.
  const finishRound = async session => {
    const link = await client.ensureShare(session.id);
    try { await client.uploadSession({ sessionId: session.id, eventId: null, eventName: 'Event', photos: session.photoIds.map(id => ({ id, bytes: bytesOf(id) })) }); await client.ensureShare(session.id); }
    catch (error) { if (!(error instanceof StudioCloudError) || error.permanent) throw error; }
    return link;
  };
  const recoveryPass = () => recoverStudioCloudSessions({
    sessions: SESSIONS, pendingIds: s => client.pendingSessionIds(s), backoff, now: () => world.now,
    upload: async id => { const session = SESSIONS.find(item => item.id === id); await client.uploadSession({ sessionId: id, eventId: null, eventName: 'Event', photos: session.photoIds.map(p => ({ id: p, bytes: bytesOf(p) })) }); await client.ensureShare(id); },
    isPermanent: error => error instanceof StudioCloudError && error.permanent, isNoCloud: () => false
  });
  // A restart: a new client over the same folder, which is all the app has after reopening.
  const restart = () => { client = makeClient(); };
  return { world, get client() { return client; }, backoff, finishRound, recoveryPass, restart };
}

test('M3 acceptance (simulated): 10 minutes without internet mid-event', async () => {
  const b = booth();

  // 1. Online: round 1 finishes normally, so this booth has reached the cloud once (links can now be made offline).
  await b.finishRound(SESSIONS[0]);
  assert.equal(b.client.pendingSessionIds([SESSIONS[0]]).length, 0, 'round 1 is fully uploaded');

  // 2. The cable is pulled. Rounds 2 and 3 finish; each guest slip must print at once, with no network call.
  b.world.online = false;
  b.world.calls = 0;
  const slips = [];
  for (const session of [SESSIONS[1], SESSIONS[2]]) {
    const started = process.hrtime.bigint();
    const link = await b.finishRound(session);
    const bytes = buildReceipt({ shareUrl: link.url, shortCode: link.shortCode, expiresAt: link.expiresAt, paper: 58 });
    const result = emulate(bytes, { paperDots: 384 });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    assert.ok(seconds < 5, `slip ready in ${seconds.toFixed(3)} s`);
    assert.deepEqual(result.problems, []);
    const qr = result.items.find(item => item.type === 'qr');
    assert.equal(qr.data, link.url, 'the QR carries the booth-made link');
    assert.match(link.url, /^https:\/\/kokomemory\.com\/s\/[A-Za-z0-9_-]{43}/);
    assert.equal(link.registered, false, 'the server does not know this link yet');
    slips.push({ session, link, qr });
  }
  assert.equal(b.world.calls, 0, 'nothing reached the network while it was down');
  assert.equal(b.world.serverPhotos.size, 3, 'only round 1 is on the server');

  // 3. Ten minutes pass, a recovery pass every minute. Nothing is lost and the failing rounds back off instead of hammering.
  let attempts = 0;
  for (let minute = 1; minute <= 10; minute++) {
    b.world.now += 60_000;
    const result = await b.recoveryPass();
    attempts += result.failed.length;
    assert.deepEqual(result.recovered, []);
  }
  assert.ok(attempts > 0 && attempts <= 8, `retried ${attempts} times in 10 offline minutes (backing off, not every minute for both rounds)`);
  assert.equal(b.world.serverPhotos.size, 3);

  // 4. The internet is back. Within the longest wait (15 min) the waiting rounds finish by themselves.
  b.world.online = true;
  let recovered = [];
  for (let minute = 1; minute <= 16 && recovered.length < 2; minute++) {
    b.world.now += 60_000;
    recovered = recovered.concat((await b.recoveryPass()).recovered);
  }
  assert.deepEqual(recovered.sort(), [SESSIONS[1].id, SESSIONS[2].id].sort());
  const allPhotos = SESSIONS.flatMap(session => session.photoIds.map(id => id.replace(/-/g, '')));
  assert.deepEqual([...b.world.serverPhotos].sort(), allPhotos.sort(), 'all 9 photos reached the server, none lost');
  assert.equal(b.client.pendingSessionIds(SESSIONS).length, 0, 'nothing is waiting any more');

  // 5. The links printed offline are now known to the server, which also gave each a short code for guests who cannot scan.
  for (const { session, link } of slips) {
    const share = b.client.getShare(session.id);
    assert.equal(share.url, link.url, 'the printed link never changed');
    assert.equal(share.registered, true);
    assert.equal(share.shortCode, 'K7QM4XPA');
    assert.equal(b.world.serverSessions.get(session.id), 3, 'the guest page can show "uploading n/3"');
  }
});

test('M3: closing and reopening the app in the middle of the outage loses nothing (the waiting list is rebuilt from disk)', async () => {
  const b = booth();
  await b.finishRound(SESSIONS[0]);
  b.world.online = false;
  const link = await b.finishRound(SESSIONS[1]);
  const played = [SESSIONS[0], SESSIONS[1]];
  assert.deepEqual(b.client.pendingSessionIds(played), [SESSIONS[1].id]);

  b.restart();
  assert.deepEqual(b.client.pendingSessionIds(played), [SESSIONS[1].id], 'still waiting after the restart');
  assert.equal(b.client.getShare(SESSIONS[1].id).url, link.url, 'the printed link survived the restart');

  b.world.online = true;
  const result = await b.recoveryPass();
  assert.ok(result.recovered.includes(SESSIONS[1].id));
  for (const id of SESSIONS[1].photoIds) assert.ok(b.world.serverPhotos.has(id.replace(/-/g, '')), 'photo ' + id + ' reached the server');
  assert.equal(b.client.getShare(SESSIONS[1].id).registered, true);
});

test('M3: a plan without a cloud is not asked again every minute', async () => {
  const b = booth();
  await b.finishRound(SESSIONS[0]);
  let asked = 0;
  const noCloud = new StudioCloudError('cloud_unavailable', true);
  const pass = () => recoverStudioCloudSessions({ sessions: [SESSIONS[1]], pendingIds: sessions => sessions.map(item => item.id), backoff: b.backoff, now: () => b.world.now, upload: async () => { asked++; throw noCloud; }, isPermanent: error => error.permanent, isNoCloud: error => error.code === 'cloud_unavailable' });
  await pass();
  for (let minute = 1; minute <= 59; minute++) { b.world.now += 60_000; await pass(); }
  assert.equal(asked, 1, 'asked once in the first hour');
  b.world.now += 60_000;
  await pass();
  assert.equal(asked, 2, 'and again after an hour');
});
