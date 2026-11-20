const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GalleryTokenStore } = require('../src/main/services/gallery-token-store.ts');
const { GuestGalleryServer, galleryPage } = require('../src/main/services/guest-gallery-server.ts');

const jpeg = (tag) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, tag, 0xff, 0xd9]);
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'koko-gallery-'));
const SESSION = '11111111-1111-4111-8111-111111111111';

test('token store: stable per round, persisted, expiring, revocable', () => {
  let now = 1_000;
  const d = dir();
  const store = new GalleryTokenStore(d, () => now);
  const token = store.forSession(SESSION, 5_000);
  assert.match(token, /^[A-Za-z0-9_-]{20,40}$/);
  assert.equal(store.forSession(SESSION, 5_000), token);
  assert.deepEqual(store.resolve(token), { sessionId: SESSION, expiresAt: 6_000 });
  assert.equal(new GalleryTokenStore(d, () => now).resolve(token)?.sessionId, SESSION);
  assert.equal(store.resolve('not-a-token'), null);
  assert.equal(store.resolve('A'.repeat(24)), null);
  now = 7_000;
  assert.equal(store.resolve(token), null);
  const fresh = store.forSession(SESSION, 5_000);
  assert.notEqual(fresh, token);
  store.revokeSession(SESSION);
  assert.equal(store.resolve(fresh), null);
  assert.equal(new GalleryTokenStore(d, () => now).resolve(fresh), null);
});

test('token store survives a corrupt file', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'gallery-tokens.json'), '{broken');
  const store = new GalleryTokenStore(d);
  assert.equal(store.resolve('A'.repeat(24)), null);
  assert.ok(store.forSession(SESSION, 1000));
});

function makeServer(extra = {}) {
  const TOKEN = 'abcdefghijklmnopqrstuvwx';
  const photos = [jpeg(1), jpeg(2), jpeg(3)];
  const calls = [];
  const server = new GuestGalleryServer({
    resolve: t => t === TOKEN ? { title: 'Wedding <A&B>', photoCount: photos.length, expiresAt: Date.now() + 1000 } : null,
    readPhoto: (t, i) => t === TOKEN && photos[i] ? { bytes: photos[i] } : null,
    render: (bytes, max) => { calls.push(max); return Buffer.concat([Buffer.from(bytes), Buffer.from([0xaa])]); },
    ...extra
  });
  return { server, TOKEN, photos, calls };
}

test('gallery page lists photos as real <img>, escapes the title and shows no other round', async () => {
  const { server, TOKEN } = makeServer();
  await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.status().port}`;
  try {
    const page = await fetch(`${base}/s/${TOKEN}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const html = await page.text();
    assert.equal((html.match(/<img src="\/s\/[^"]+\/p\/\d\?size=thumb"/g) || []).length, 3);
    assert.ok(html.includes('Wedding &lt;A&amp;B&gt;'));
    assert.ok(!html.includes('Wedding <A&B>'));
    assert.match(html, /navigator\.canShare/);
    assert.match(html, /noindex/);
  } finally { await server.stop(); }
});

test('photo sizes, download header, bounds, unknown token and bad requests', async () => {
  const { server, TOKEN, photos, calls } = makeServer();
  await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.status().port}`;
  try {
    const thumb = await fetch(`${base}/s/${TOKEN}/p/0?size=thumb`);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
    assert.equal(thumb.headers.get('content-disposition'), null);
    assert.deepEqual(Buffer.from(await thumb.arrayBuffer()), Buffer.concat([photos[0], Buffer.from([0xaa])]));
    await (await fetch(`${base}/s/${TOKEN}/p/1?size=preview`)).arrayBuffer();
    const dl = await fetch(`${base}/s/${TOKEN}/p/2?size=download&dl=1`);
    assert.equal(dl.headers.get('content-disposition'), 'attachment; filename="KOKO_3.jpg"');
    await dl.arrayBuffer();
    assert.deepEqual(calls, [400, 1600, 2800]);
    const original = await fetch(`${base}/s/${TOKEN}/p/1?size=original`);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), photos[1]);
    assert.equal((await fetch(`${base}/s/${TOKEN}/p/3`)).status, 404);
    assert.equal((await fetch(`${base}/s/${TOKEN}/p/0?size=huge`)).status, 400);
    const gone = await fetch(`${base}/s/zzzzzzzzzzzzzzzzzzzzzzzz`);
    assert.equal(gone.status, 410);
    assert.equal((await fetch(`${base}/s/zzzzzzzzzzzzzzzzzzzzzzzz/p/0`)).status, 410);
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/s/short`)).status, 404);
    assert.equal((await fetch(`${base}/s/${TOKEN}`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally { await server.stop(); }
});

test('rate limit answers 429 per client and recovers after the window', async () => {
  let now = 0;
  const { server, TOKEN } = makeServer({ now: () => now });
  await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.status().port}`;
  try {
    let limited = 0;
    for (let i = 0; i < 260; i++) { const r = await fetch(`${base}/s/${TOKEN}/p/0?size=thumb`); await r.arrayBuffer(); if (r.status === 429) limited++; }
    assert.ok(limited >= 15, `expected 429s, got ${limited}`);
    now = 61_000;
    assert.equal((await fetch(`${base}/s/${TOKEN}`)).status, 200);
  } finally { await server.stop(); }
});

test('galleryPage handles a single photo and stop() closes the port', async () => {
  assert.match(galleryPage({ title: '', photoCount: 1, expiresAt: 0 }, 'abcdefghijklmnopqrstuvwx'), /data-i="0"/);
  const { server } = makeServer();
  const status = await server.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${status.port}/healthz`;
  await server.stop();
  await assert.rejects(fetch(url));
});
