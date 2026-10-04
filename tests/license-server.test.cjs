const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { LicenseRuntime } = require('../src/main/services/license-runtime.ts');
const { createLicenseServer } = require('../server/license-server.cjs');

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const roots = [];
const services = [];
const adminToken = 'test-only-admin-secret-with-more-than-32-chars';
function setup(opts = {}) {
  let clock = Date.now();
  const service = createLicenseServer({ privateKey, adminToken, dbPath: ':memory:', photoCloudRoot: tempRoot(), now: () => clock, env: {
    LICENSE_ENV: 'development', LICENSE_KEY_ID: 'koko-test-signing', LICENSE_PRODUCT_ID: 'koko-photobooth',
    LICENSE_OFFLINE_GRACE_HOURS: '72', LICENSE_REFRESH_HOURS: '24', LICENSE_RATE_LIMIT: '1000', ...opts.env
  } });
  services.push(service);
  const server = service.server;
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ service, baseUrl: `http://127.0.0.1:${port}`, now: () => clock, advance: ms => { clock += ms; } });
  }));
}
function tempRoot() { const dir = mkdtempSync(path.join(os.tmpdir(), 'koko-license-server-')); roots.push(dir); return dir; }
async function adminIssue(baseUrl, body = {}) {
  const response = await fetch(`${baseUrl}/v1/admin/development/licenses`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ planId: 'annual', ...body })
  });
  assert.equal(response.status, 201);
  return response.json();
}
function makeRuntime(baseUrl, key, userDataPath, fetcher, now = Date.now) {
  return new LicenseRuntime({ userDataPath, apiBaseUrl: baseUrl, productId: 'koko-photobooth', trustedKeys: { 'koko-test-signing': key }, fetcher, now });
}
afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('serves monthly, annual, and lifetime plans from server configuration', async () => {
  const { baseUrl } = await setup();
  const response = await fetch(`${baseUrl}/v1/desktop/plans`);
  const { plans } = await response.json();
  assert.deepEqual(plans.map(plan => plan.billingPeriod).sort(), ['lifetime', 'month', 'year']);
  assert.ok(plans.every(plan => plan.deviceLimit > 0 && plan.features.includes('capture')));
});

test('activation integrates with Desktop signature verification and returns server status', async () => {
  const { baseUrl, service, now } = await setup();
  const issued = await adminIssue(baseUrl);
  const runtime = makeRuntime(baseUrl, service.publicKey, tempRoot(), undefined, now);
  const result = await runtime.activate(issued.licenseKey);
  assert.equal(result.state, 'active');
  assert.ok(result.features.includes('capture'));
  assert.equal((await runtime.getStatus()).state, 'active');
  const audit = service.db.prepare('SELECT action FROM audit_logs ORDER BY created_at').all().map(row => row.action);
  assert.ok(audit.includes('license.issued'));
  assert.ok(audit.includes('license.activated'));
});

test('stores private photo folders behind owner keys and serves only verified JPEGs', async () => {
  const { baseUrl, service, now } = await setup();
  const issued = await adminIssue(baseUrl);
  const runtime = makeRuntime(baseUrl, service.publicKey, tempRoot(), undefined, now);
  assert.equal((await runtime.activate(issued.licenseKey)).state, 'active');
  const folder = await runtime.createPhotoFolder('Owner one');
  assert.equal(folder.label, 'Owner one');
  assert.ok(folder.ownerKey.length >= 40);

  const otherOwner = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}`, { headers: { authorization: 'Bearer wrong-owner-key' } });
  assert.equal(otherOwner.status, 404);
  const uploadCredentialCannotRead = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}`, { headers: { authorization: `Bearer ${folder.ownerKey}` } });
  assert.equal(uploadCredentialCannotRead.status, 404);
  const photoId = require('node:crypto').randomUUID();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 2, 3, 1, 17, 0, 0xff, 0xd9]);
  await runtime.uploadPhoto(folder.id, photoId, folder.ownerKey, jpeg);
  const shareCredentialCannotUpload = await fetch(`${baseUrl}/v1/desktop/photo-folders/${folder.id}/photos/${require('node:crypto').randomUUID()}`, {
    method: 'PUT', headers: { authorization: `Bearer ${folder.shareKey}`, 'content-type': 'image/jpeg' }, body: jpeg
  });
  assert.equal(shareCredentialCannotUpload.status, 404);
  const list = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}`, { headers: { authorization: `Bearer ${folder.shareKey}` } });
  assert.deepEqual((await list.json()).photos.map(photo => photo.id), [photoId]);
  const download = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}/photos/${photoId}`, { headers: { authorization: `Bearer ${folder.shareKey}` } });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), jpeg);
  const videoId = require('node:crypto').randomUUID();
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x11]);
  await runtime.uploadVideo(folder.id, videoId, folder.ownerKey, webm);
  const mediaList = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}`, { headers: { authorization: `Bearer ${folder.shareKey}` } });
  const media = await mediaList.json();
  assert.deepEqual(media.photos.map(photo => photo.id), [photoId]);
  assert.deepEqual(media.videos.map(video => video.id), [videoId]);
  const videoDownload = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}/videos/${videoId}`, { headers: { authorization: `Bearer ${folder.shareKey}` } });
  assert.equal(videoDownload.status, 200);
  assert.equal(videoDownload.headers.get('content-type'), 'video/webm');
  assert.deepEqual(Buffer.from(await videoDownload.arrayBuffer()), webm);
  const wrongVideoKey = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}/videos/${videoId}`, { headers: { authorization: `Bearer ${folder.ownerKey}` } });
  assert.equal(wrongVideoKey.status, 404);
  const missingOwner = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}`);
  assert.equal(missingOwner.status, 404);
  const sharePage = await fetch(`${baseUrl}/share`);
  assert.equal(sharePage.status, 200);
  assert.match(await sharePage.text(), /photo-share\.js/);
  await runtime.revokePhotoFolderShare(folder.id, folder.ownerKey);
  const revokedList = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}`, { headers: { authorization: `Bearer ${folder.shareKey}` } });
  assert.equal(revokedList.status, 404);
  const revokedPhoto = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}/photos/${photoId}`, { headers: { authorization: `Bearer ${folder.shareKey}` } });
  assert.equal(revokedPhoto.status, 404);
  await runtime.revokePhotoFolderShare(folder.id, folder.ownerKey);
});

test('expired and revoked licenses are denied by server refresh', async () => {
  const expiredSetup = await setup();
  const short = await adminIssue(expiredSetup.baseUrl, { durationDays: 1 });
  const expiredRuntime = makeRuntime(expiredSetup.baseUrl, expiredSetup.service.publicKey, tempRoot(), undefined, expiredSetup.now);
  assert.equal((await expiredRuntime.activate(short.licenseKey)).state, 'active');
  expiredSetup.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal((await expiredRuntime.getStatus()).state, 'expired');

  const revokedSetup = await setup();
  const issued = await adminIssue(revokedSetup.baseUrl);
  const runtime = makeRuntime(revokedSetup.baseUrl, revokedSetup.service.publicKey, tempRoot(), undefined, revokedSetup.now);
  assert.equal((await runtime.activate(issued.licenseKey)).state, 'active');
  const revoke = await fetch(`${revokedSetup.baseUrl}/v1/admin/licenses/${issued.licenseId}/revoke`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: 'revoke-once-0001' })
  });
  assert.equal(revoke.status, 200);
  assert.equal((await runtime.getStatus()).state, 'revoked');
});

test('private photo albums expire after the configured retention period', async () => {
  const { baseUrl, service, now, advance } = await setup({ env: { KOKO_PHOTO_CLOUD_RETENTION_DAYS: '1' } });
  const issued = await adminIssue(baseUrl);
  const runtime = makeRuntime(baseUrl, service.publicKey, tempRoot(), undefined, now);
  assert.equal((await runtime.activate(issued.licenseKey)).state, 'active');
  const folder = await runtime.createPhotoFolder('One day album');
  assert.equal(Date.parse(folder.expiresAt) - Date.parse(folder.createdAt), 86_400_000);
  const videoId = require('node:crypto').randomUUID();
  await runtime.uploadVideo(folder.id, videoId, folder.ownerKey, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]));
  const { existsSync } = require('node:fs');
  assert.equal(existsSync(path.join(service.photoCloud.root, folder.id, `${videoId}.webm`)), true);
  advance(86_400_001);
  const response = await fetch(`${baseUrl}/v1/public/photo-folders/${folder.id}`, { headers: { authorization: `Bearer ${folder.shareKey}` } });
  assert.equal(response.status, 404);
  assert.equal(service.photoCloud.purgeExpired(), 1);
  assert.equal(existsSync(path.join(service.photoCloud.root, folder.id)), false);
});

test('applies plan retention to new albums and enforces aggregate quota per license', async () => {
  const { baseUrl, service, now } = await setup();
  const policyUrl = `${baseUrl}/v1/admin/plans/annual/photo-policy`;
  const denied = await fetch(policyUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retentionDays: 2, storageQuotaBytes: 1048576 }) });
  assert.equal(denied.status, 401);
  const setPolicy = async (retentionDays, storageQuotaBytes) => fetch(policyUrl, {
    method: 'PUT', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ retentionDays, storageQuotaBytes })
  });
  const configured = await setPolicy(2, 1048576);
  assert.equal(configured.status, 200);

  const issued = await adminIssue(baseUrl);
  const runtime = makeRuntime(baseUrl, service.publicKey, tempRoot(), undefined, now);
  assert.equal((await runtime.activate(issued.licenseKey)).state, 'active');
  const firstAlbum = await runtime.createPhotoFolder('First policy');
  assert.equal(Date.parse(firstAlbum.expiresAt) - Date.parse(firstAlbum.createdAt), 2 * 86_400_000);
  assert.equal((await setPolicy(3, 1048576)).status, 200);
  const secondAlbum = await runtime.createPhotoFolder('Updated policy');
  assert.equal(Date.parse(secondAlbum.expiresAt) - Date.parse(secondAlbum.createdAt), 3 * 86_400_000);
  assert.equal(Date.parse(firstAlbum.expiresAt) - Date.parse(firstAlbum.createdAt), 2 * 86_400_000);

  const fullQuotaVideo = Buffer.alloc(1048576);
  fullQuotaVideo.set([0x1a, 0x45, 0xdf, 0xa3]);
  await runtime.uploadVideo(firstAlbum.id, require('node:crypto').randomUUID(), firstAlbum.ownerKey, fullQuotaVideo);
  const overQuota = await fetch(`${baseUrl}/v1/desktop/photo-folders/${secondAlbum.id}/videos/${require('node:crypto').randomUUID()}`, {
    method: 'PUT', headers: { authorization: `Bearer ${secondAlbum.ownerKey}`, 'content-type': 'video/webm' },
    body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
  });
  assert.equal(overQuota.status, 413);

  const otherIssued = await adminIssue(baseUrl);
  const otherRuntime = makeRuntime(baseUrl, service.publicKey, tempRoot(), undefined, now);
  assert.equal((await otherRuntime.activate(otherIssued.licenseKey)).state, 'active');
  const otherAlbum = await otherRuntime.createPhotoFolder('Separate license quota');
  await otherRuntime.uploadVideo(otherAlbum.id, require('node:crypto').randomUUID(), otherAlbum.ownerKey, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  assert.equal(service.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='plan.photo_policy_updated'").get().count, 2);
});

test('enforces per-license device limit and supports authorized deactivation', async () => {
  const { baseUrl, service, now } = await setup();
  const issued = await adminIssue(baseUrl);
  service.db.prepare('UPDATE licenses SET max_devices=1 WHERE id=?').run(issued.licenseId);
  const first = makeRuntime(baseUrl, service.publicKey, tempRoot(), undefined, now);
  assert.equal((await first.activate(issued.licenseKey)).state, 'active');
  const second = makeRuntime(baseUrl, service.publicKey, tempRoot(), undefined, now);
  await assert.rejects(second.activate(issued.licenseKey), /device limit/i);
  assert.equal(await first.deactivate(), true);
  assert.equal((await second.activate(issued.licenseKey)).state, 'active');
});

test('rejects modified entitlement signatures at the backend', async () => {
  const { baseUrl, service, now } = await setup();
  const issued = await adminIssue(baseUrl);
  const userDataPath = tempRoot();
  const runtime = makeRuntime(baseUrl, service.publicKey, userDataPath, undefined, now);
  await runtime.activate(issued.licenseKey);
  // Exercise the server verifier directly with a valid token whose signature is altered.
  const savedToken = JSON.parse(readFileSync(path.join(userDataPath, 'license-entitlement.json'), 'utf8')).token;
  const parts = savedToken.split('.');
  parts[2] = `${parts[2].slice(0, -1)}${parts[2].endsWith('A') ? 'B' : 'A'}`;
  const response = await fetch(`${baseUrl}/v1/desktop/leases/refresh`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: JSON.parse(readFileSync(path.join(userDataPath, 'license-device.json'), 'utf8')).deviceId, productId: 'koko-photobooth', entitlement: parts.join('.') })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'invalid_entitlement');
  assert.ok(savedToken.length > 100);
});

test('uses bounded offline grace when the service is unreachable and fails closed afterwards', async () => {
  const { baseUrl, service, advance, now } = await setup();
  const issued = await adminIssue(baseUrl);
  const localPath = tempRoot();
  let online = true;
  const fetcher = async (url, init) => {
    if (!online) throw new Error('network unavailable');
    return fetch(url, init);
  };
  const runtime = makeRuntime(baseUrl, service.publicKey, localPath, fetcher, now);
  assert.equal((await runtime.activate(issued.licenseKey)).state, 'active');
  online = false;
  advance(48 * 60 * 60 * 1000);
  assert.equal((await runtime.getStatus()).state, 'offline_grace');
  await runtime.assertFeature('capture');
  advance(25 * 60 * 60 * 1000);
  assert.equal((await runtime.getStatus()).state, 'server_error');
  await assert.rejects(runtime.assertFeature('capture'), /does not allow/);
});

test('development license issuance requires the backend admin token and is disabled in production', async () => {
  const { baseUrl } = await setup();
  const denied = await fetch(`${baseUrl}/v1/admin/development/licenses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planId: 'annual' }) });
  assert.equal(denied.status, 401);
  const production = await setup({ env: { NODE_ENV: 'production', LICENSE_ENV: 'development', LICENSE_HTTPS_TERMINATED: 'true' } });
  const hidden = await fetch(`${production.baseUrl}/v1/admin/development/licenses`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ planId: 'annual' })
  });
  assert.equal(hidden.status, 404);
});

test('admin revocation idempotency is scoped to the target license', async () => {
  const { baseUrl, service } = await setup();
  const first = await adminIssue(baseUrl);
  const second = await adminIssue(baseUrl);
  async function revoke(id) {
    return fetch(`${baseUrl}/v1/admin/licenses/${id}/revoke`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'shared-revoke-request-key' })
    });
  }
  const firstResponse = await revoke(first.licenseId);
  const replay = await revoke(first.licenseId);
  const secondResponse = await revoke(second.licenseId);
  assert.equal(firstResponse.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(service.db.prepare('SELECT status FROM licenses WHERE id=?').get(second.licenseId).status, 'revoked');
});
