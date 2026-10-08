const assert = require('node:assert/strict');
const { test } = require('node:test');
const { retryPendingPhotoCloudUploads } = require('../src/main/services/photo-cloud-recovery.ts');

const sessionId = '79c6f27d-352d-426d-a686-d272f0d11f6c';
const uploadedId = '3ea3ade8-16e7-4fdb-8cf6-3866798f1fc0';
const pendingId = 'be0f22c5-963b-4a1b-8a1e-42177cafb63e';
const brokenId = 'f8de4ef6-a686-4f18-8b29-dd18c426212a';

test('retries only missing cloud photos and creates a folder for offline captures', async () => {
  const folders = new Map([[sessionId, null]]);
  const uploaded = new Map([[sessionId, [uploadedId]]]);
  const calls = [];
  const failures = [];
  const client = {
    getShareUrl(id) { return folders.get(id); },
    getUploadedPhotoIds(id) { return uploaded.get(id) ?? []; },
    async createForSession(id, label) { calls.push(['folder', id, label]); folders.set(id, 'https://photos.test/share#private'); return folders.get(id); },
    async uploadForSession(id, photoId, bytes) {
      calls.push(['upload', id, photoId, [...bytes]]);
      uploaded.set(id, [...(uploaded.get(id) ?? []), photoId]);
      return true;
    }
  };
  const result = await retryPendingPhotoCloudUploads([
    { id: sessionId, photoIds: [uploadedId, pendingId], eventId: null, template: null, status: 'interrupted', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ], client, id => Uint8Array.from([id === pendingId ? 2 : 1]), () => 'Offline session', (...args) => failures.push(args));

  assert.deepEqual(result, { uploadedCount: 1, failedCount: 0 });
  assert.deepEqual(failures, []);
  assert.deepEqual(calls.map(call => call[0]), ['folder', 'upload']);
  assert.equal(calls[1][2], pendingId);
  assert.deepEqual(calls[1][3], [2]);
});

test('records individual failures and continues the rest of a session', async () => {
  const failures = [];
  const uploaded = [];
  const client = {
    getShareUrl() { return 'https://photos.test/share#private'; },
    getUploadedPhotoIds() { return []; },
    async createForSession() { throw new Error('Unexpected folder creation'); },
    async uploadForSession(_sessionId, id) {
      if (id === brokenId) throw new Error('temporary network error');
      uploaded.push(id); return true;
    }
  };
  const result = await retryPendingPhotoCloudUploads([
    { id: sessionId, photoIds: [brokenId, pendingId], eventId: null, template: null, status: 'review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ], client, () => Uint8Array.from([1]), () => 'Session', (...args) => failures.push(args));

  assert.deepEqual(result, { uploadedCount: 1, failedCount: 1 });
  assert.deepEqual(uploaded, [pendingId]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0][0], sessionId);
  assert.equal(failures[0][1], brokenId);
});

test('retries a locally saved video after an offline capture', async () => {
  const calls = [];
  const client = {
    getShareUrl() { return null; },
    getUploadedPhotoIds() { return []; },
    getUploadedVideoIds() { return []; },
    async createForSession(id) { calls.push(['folder', id]); return 'https://photos.test/share#private'; },
    async uploadForSession() { throw new Error('No photo expected'); },
    async uploadVideoForSession(id, videoId, bytes) { calls.push(['video', id, videoId, [...bytes]]); return true; }
  };
  const result = await retryPendingPhotoCloudUploads([
    { id: sessionId, photoIds: [], videoIds: [pendingId], eventId: null, template: null, status: 'interrupted', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ], client, () => { throw new Error('No photo expected'); }, () => 'Video session', () => undefined, () => Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]));
  assert.deepEqual(result, { uploadedCount: 0, uploadedVideoCount: 1, failedCount: 0 });
  assert.deepEqual(calls, [['folder', sessionId], ['video', sessionId, pendingId, [0x1a, 0x45, 0xdf, 0xa3]]]);
});

test('does not publish cancelled or retaken sessions during automatic recovery', async () => {
  const calls = [];
  const client = {
    getShareUrl() { return null; },
    getUploadedPhotoIds() { return []; },
    async createForSession(...args) { calls.push(['folder', ...args]); return 'https://photos.test/share#private'; },
    async uploadForSession(...args) { calls.push(['photo', ...args]); return true; }
  };
  const sessions = ['cancelled', 'retaken'].map(status => ({
    id: sessionId, photoIds: [pendingId], eventId: null, template: null, status,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }));

  const result = await retryPendingPhotoCloudUploads(sessions, client, () => Uint8Array.from([1]), () => 'Retired session', () => undefined);

  assert.deepEqual(result, { uploadedCount: 0, failedCount: 0 });
  assert.deepEqual(calls, []);
});

test('stops retrying a session when an operator retakes it while uploads are queued', async () => {
  const uploaded = [];
  let stillEligible = true;
  const client = {
    getShareUrl() { return 'https://photos.test/share#private'; },
    getUploadedPhotoIds() { return []; },
    async uploadForSession(_sessionId, id) { uploaded.push(id); stillEligible = false; return true; }
  };
  const session = { id: sessionId, photoIds: [pendingId, brokenId], eventId: null, template: null, status: 'review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

  const result = await retryPendingPhotoCloudUploads([session], client, () => Uint8Array.from([1]), () => 'Session', () => undefined, undefined, () => stillEligible);

  assert.deepEqual(result, { uploadedCount: 1, failedCount: 0 });
  assert.deepEqual(uploaded, [pendingId]);
});
