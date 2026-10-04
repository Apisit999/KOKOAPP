const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { PhotoCloudClient } = require('../src/main/services/photo-cloud-client.ts');

test('keeps a private folder key locally and uploads each photo idempotently', async () => {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'koko-photo-cloud-client-'));
  try {
    const calls = [];
    const runtime = {
      async createPhotoFolder(label) { return { id: '775f8a8a-631c-45b1-8e54-51a77f0bdde5', ownerKey: 'a'.repeat(43), shareKey: 'b'.repeat(43), label, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }; },
      async uploadPhoto(...args) { calls.push(args); }
    };
    const client = new PhotoCloudClient(userData, runtime, 'https://photos.example.test/');
    const sessionId = '79c6f27d-352d-426d-a686-d272f0d11f6c';
    const photoId = '3ea3ade8-16e7-4fdb-8cf6-3866798f1fc0';
    const shareUrl = await client.createForSession(sessionId, 'Birthday');
    assert.match(shareUrl, /^https:\/\/photos\.example\.test\/share#/);
    assert.ok(shareUrl.includes('b'.repeat(43)));
    assert.ok(!shareUrl.includes('a'.repeat(43)));
    assert.equal(client.getShareUrl(sessionId), shareUrl);
    assert.equal(await client.uploadForSession(sessionId, photoId, Uint8Array.from([1, 2, 3])), true);
    assert.equal(await client.uploadForSession(sessionId, photoId, Uint8Array.from([1, 2, 3])), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2], 'a'.repeat(43));
    assert.equal(client.getUploadedPhotoIds(sessionId)[0], photoId);
    const saved = JSON.parse(readFileSync(path.join(userData, 'photo-cloud-folders.json'), 'utf8'));
    assert.equal(saved.folders[0].ownerKey, 'a'.repeat(43));
  } finally { rmSync(userData, { recursive: true, force: true }); }
});

test('rejects a malformed local private-folder index', async () => {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'koko-photo-cloud-client-'));
  try {
    const { writeFileSync } = require('node:fs');
    writeFileSync(path.join(userData, 'photo-cloud-folders.json'), '{"schemaVersion":1,"folders":[{"ownerKey":"leak"}]}');
    const client = new PhotoCloudClient(userData, { async createPhotoFolder() { throw new Error('not expected'); } }, 'http://127.0.0.1:8787');
    assert.throws(() => client.getShareUrl('79c6f27d-352d-426d-a686-d272f0d11f6c'), /invalid/);
  } finally { rmSync(userData, { recursive: true, force: true }); }
});

test('keeps video upload progress separate and idempotent from photo uploads', async () => {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'koko-photo-cloud-client-'));
  try {
    const calls = [];
    const runtime = {
      async createPhotoFolder(label) { return { id: '775f8a8a-631c-45b1-8e54-51a77f0bdde5', ownerKey: 'a'.repeat(43), shareKey: 'b'.repeat(43), label, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }; },
      async uploadPhoto() {},
      async uploadVideo(...args) { calls.push(args); }
    };
    const client = new PhotoCloudClient(userData, runtime, 'https://photos.example.test');
    const sessionId = '79c6f27d-352d-426d-a686-d272f0d11f6c';
    const videoId = '3ea3ade8-16e7-4fdb-8cf6-3866798f1fc0';
    await client.createForSession(sessionId, 'Video session');
    assert.equal(await client.uploadVideoForSession(sessionId, videoId, Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), true);
    assert.equal(await client.uploadVideoForSession(sessionId, videoId, Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], videoId);
    assert.deepEqual(client.getUploadedVideoIds(sessionId), [videoId]);
    assert.deepEqual(client.getUploadedPhotoIds(sessionId), []);
  } finally { rmSync(userData, { recursive: true, force: true }); }
});

test('coalesces concurrent folder creation and duplicate photo uploads per session', async () => {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'koko-photo-cloud-client-'));
  try {
    let folderCalls = 0;
    let uploadCalls = 0;
    let releaseUpload;
    const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
    const runtime = {
      async createPhotoFolder(label) {
        folderCalls++;
        await Promise.resolve();
        return { id: '775f8a8a-631c-45b1-8e54-51a77f0bdde5', ownerKey: 'a'.repeat(43), shareKey: 'b'.repeat(43), label, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
      },
      async uploadPhoto() { uploadCalls++; await uploadGate; }
    };
    const client = new PhotoCloudClient(userData, runtime, 'https://photos.example.test');
    const sessionId = '79c6f27d-352d-426d-a686-d272f0d11f6c';
    const photoId = '3ea3ade8-16e7-4fdb-8cf6-3866798f1fc0';
    const folders = await Promise.all([
      client.createForSession(sessionId, 'Birthday'),
      client.createForSession(sessionId, 'Birthday')
    ]);
    assert.equal(folders[0], folders[1]);
    assert.equal(folderCalls, 1);

    const first = client.uploadForSession(sessionId, photoId, Uint8Array.from([1, 2, 3]));
    const second = client.uploadForSession(sessionId, photoId, Uint8Array.from([1, 2, 3]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(uploadCalls, 1);
    releaseUpload();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(uploadCalls, 1);
    assert.deepEqual(client.getUploadedPhotoIds(sessionId), [photoId]);
  } finally { rmSync(userData, { recursive: true, force: true }); }
});

test('persists album link revocation and refuses to recreate or upload to the revoked folder', async () => {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'koko-photo-cloud-client-'));
  try {
    let revokeCalls = 0;
    const runtime = {
      async createPhotoFolder(label) { return { id: '775f8a8a-631c-45b1-8e54-51a77f0bdde5', ownerKey: 'a'.repeat(43), shareKey: 'b'.repeat(43), label, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }; },
      async uploadPhoto() {}, async revokePhotoFolderShare() { revokeCalls++; }
    };
    const client = new PhotoCloudClient(userData, runtime, 'https://photos.example.test');
    const sessionId = '79c6f27d-352d-426d-a686-d272f0d11f6c';
    await client.createForSession(sessionId, 'Birthday');
    assert.equal(await client.revokeShareForSession(sessionId), true);
    assert.equal(await client.revokeShareForSession(sessionId), true);
    assert.equal(revokeCalls, 1);
    assert.deepEqual(client.getShareStatus(sessionId), { shareUrl: null, revoked: true, expiresAt: JSON.parse(readFileSync(path.join(userData, 'photo-cloud-folders.json'), 'utf8')).folders[0].expiresAt });
    await assert.rejects(client.createForSession(sessionId, 'Birthday'), /revoked/);
    await assert.rejects(client.uploadForSession(sessionId, '3ea3ade8-16e7-4fdb-8cf6-3866798f1fc0', Uint8Array.from([1])), /revoked/);
    const reloaded = new PhotoCloudClient(userData, runtime, 'https://photos.example.test');
    assert.equal(reloaded.getShareStatus(sessionId).revoked, true);
  } finally { rmSync(userData, { recursive: true, force: true }); }
});
