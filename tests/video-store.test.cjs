const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { VideoStore } = require('../src/main/services/video-store.ts');

const roots = [];
function createRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koko-video-store-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('saves WebM clip bytes and verifies indexed metadata on read', async () => {
  const root = createRoot();
  const store = new VideoStore(root);
  store.configure();
  const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  const video = await store.saveWebm(bytes, 1280, 720, 10_000, null);
  assert.deepEqual(readFileSync(path.join(root, 'videos', video.fileName)), bytes);
  assert.equal(video.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(store.read(video.id), { video, bytes: new Uint8Array(bytes) });
  assert.deepEqual(store.list(), [video]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'video-index.json'), 'utf8')).videos, [video]);
});

test('serializes concurrent saves and rejects invalid media metadata', async () => {
  const store = new VideoStore(createRoot());
  const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 9, 8, 7]);
  const videos = await Promise.all([
    store.saveWebm(bytes, 640, 480, 5_000, null),
    store.saveWebm(bytes, 640, 480, 5_000, null)
  ]);
  assert.equal(new Set(videos.map(video => video.id)).size, 2);
  await assert.rejects(store.saveWebm(Buffer.from([1, 2, 3, 4]), 640, 480, 5_000, null), /Invalid WebM video/);
  await assert.rejects(store.saveWebm(bytes, 0, 480, 5_000, null), /Invalid video dimensions/);
  await assert.rejects(store.saveWebm(bytes, 640, 480, 31_000, null), /Video must be/);
  assert.equal(store.list().length, 2);
});

test('rejects a corrupt video index', async () => {
  const root = createRoot();
  const store = new VideoStore(root);
  store.configure();
  writeFileSync(path.join(root, 'video-index.json'), '{bad json');
  assert.throws(() => store.list(), SyntaxError);
});
