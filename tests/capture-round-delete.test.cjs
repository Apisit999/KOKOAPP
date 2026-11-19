const assert = require('node:assert/strict');
const { mkdtempSync, existsSync, renameSync, mkdirSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { deleteCaptureRound } = require('../src/main/services/capture-round-delete.ts');
const { VideoStore } = require('../src/main/services/video-store.ts');
const { CaptureSessionStore } = require('../src/main/services/capture-session-store.ts');

const ID = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const round = (extra = {}) => ({ id: ID(1), status: 'confirmed', photoIds: [ID(10), ID(11)], compositionPhotoId: ID(12), videoIds: [ID(20)], ...extra });
function fakes(overrides = {}) {
  const log = [];
  return { log, deps: {
    session: round(),
    revokeLinks: async () => { log.push('revoke'); },
    trashPhoto: async id => { log.push('photo ' + id.slice(0, 8)); return true; },
    trashVideo: async id => { log.push('video ' + id.slice(0, 8)); return true; },
    markDeleted: () => { log.push('marked'); },
    ...overrides } };
}

test('delete round: the link is cancelled first, every file goes to the Trash, and only then is the round marked deleted', async () => {
  const f = fakes();
  const result = await deleteCaptureRound(f.deps);
  assert.deepEqual(f.log, ['revoke', 'photo 00000010', 'photo 00000011', 'photo 00000012', 'video 00000020', 'marked']);
  assert.deepEqual(result, { photos: 3, videos: 1, failed: [], done: true });
});

test('delete round: if the link cannot be cancelled nothing is deleted at all', async () => {
  const f = fakes({ revokeLinks: async () => { throw new Error('network_error'); } });
  await assert.rejects(deleteCaptureRound(f.deps), /nothing was deleted/);
  assert.deepEqual(f.log, []);
});

test('delete round: a file that cannot be moved is reported, the others still go, and the round is not marked so it can be retried', async () => {
  const f = fakes({ trashPhoto: async id => { if (id === ID(11)) throw new Error('locked'); return true; } });
  const result = await deleteCaptureRound(f.deps);
  assert.deepEqual(result.failed, [ID(11)]);
  assert.equal(result.photos, 2);
  assert.equal(result.done, false);
  assert.ok(!f.log.includes('marked'));
  // Retry: the files already gone report "not found" (false), the stuck one now works, and the round is marked.
  const retry = fakes({ session: round(), trashPhoto: async id => id === ID(11), trashVideo: async () => false });
  const again = await deleteCaptureRound(retry.deps);
  assert.equal(again.done, true);
  assert.ok(retry.log.includes('marked'));
});

test('delete round: a round still being shot is refused, and a repeated id is trashed once', async () => {
  const f = fakes({ session: round({ status: 'capturing' }) });
  await assert.rejects(deleteCaptureRound(f.deps), /still being shot/);
  assert.deepEqual(f.log, []);
  const g = fakes({ session: round({ photoIds: [ID(10), ID(10)], compositionPhotoId: ID(10), videoIds: [] }) });
  assert.equal((await deleteCaptureRound(g.deps)).photos, 1);
});

test('video store: moving a video to the Trash removes its record and file; an unknown video is "not found"; a failing Trash restores the record', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koko-video-trash-'));
  const trash = mkdtempSync(path.join(os.tmpdir(), 'koko-trash-'));
  const store = new VideoStore(root);
  store.configure();
  const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  const video = await store.saveWebm(bytes, 1280, 720, 5000, null);
  const file = path.join(root, 'videos', video.fileName);
  await assert.rejects(store.moveVideoToTrash(video.id, async () => { throw new Error('Trash unavailable'); }), /Trash unavailable/);
  assert.equal(store.list().length, 1, 'record restored');
  assert.ok(existsSync(file), 'file untouched');
  assert.equal(await store.moveVideoToTrash(video.id, async from => { renameSync(from, path.join(trash, path.basename(from))); }), true);
  assert.equal(store.list().length, 0);
  assert.ok(!existsSync(file));
  assert.deepEqual(readFileSync(path.join(trash, video.fileName)), bytes, 'the file is recoverable from the Trash');
  assert.equal(await store.moveVideoToTrash(video.id, async () => undefined), false, 'already gone');
  await assert.rejects(store.moveVideoToTrash('not-an-id', async () => undefined), /Invalid video ID/);
});

test('session store: a deleted round keeps only its record, as cancelled, with no media', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'koko-sessions-'));
  const store = new CaptureSessionStore(dir);
  const session = store.start(null, null);
  store.addPhoto(session.id, '5d60670b-3872-422c-bfd2-bbc48f27f8e1');
  store.finish(session.id, 'review');
  store.finish(session.id, 'confirmed');
  const marked = store.markMediaDeleted(session.id);
  assert.equal(marked.status, 'cancelled');
  assert.deepEqual(marked.photoIds, []);
  assert.equal(new CaptureSessionStore(dir).get(session.id).status, 'cancelled', 'saved to disk');
  assert.equal(new CaptureSessionStore(dir).listForCloudRecovery().length, 0, 'never uploaded again');
  assert.equal(store.markMediaDeleted(ID(99)), null);
});
