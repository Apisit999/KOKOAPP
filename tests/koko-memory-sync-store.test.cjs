const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { KokoMemorySyncStore } = require('../src/main/services/koko-memory-sync-store.ts');

test('durably snapshots a confirmed session destination and recovers interrupted uploads', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'koko-memory-queue-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const session = { id: randomUUID(), status: 'confirmed' };
  const photoId = randomUUID();
  const target = { connectionId: 'a'.repeat(64), bookingId: 'booking_1', shareId: 'share_12345678901234567890' };
  const store = new KokoMemorySyncStore(directory);
  assert.throws(() => store.enqueueSession({ ...session, status: 'retaken' }, [photoId], target), /confirmed/);
  const initial = store.enqueueSession(session, [photoId], target);
  assert.equal(initial.state, 'pending');
  const job = store.dueJobs()[0];
  assert.equal(job.bookingId, target.bookingId);
  store.markUploading(job.id);
  assert.equal(readFileSync(path.join(directory, 'kokomemory-upload-queue.json'), 'utf8').includes('uploadToken'), false);
  const reopened = new KokoMemorySyncStore(directory);
  assert.equal(reopened.dueJobs()[0].status, 'pending');
  reopened.markUploaded(job.id);
  assert.equal(reopened.statusForSession(session.id, target.connectionId).state, 'uploaded');
});
