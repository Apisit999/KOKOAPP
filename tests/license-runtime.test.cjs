const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { LicenseRuntime } = require('../src/main/services/license-runtime.ts');

const roots = [];
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'runtime-test-key';
const trustedKeys = { [kid]: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
function root() { const dir = mkdtempSync(path.join(os.tmpdir(), 'koko-license-')); roots.push(dir); return dir; }
function signed(deviceId, now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: 1, keyId: kid, licenseId: 'license-123', deviceId, productId: 'koko-photobooth',
    issuedAt: new Date(now - 60_000).toISOString(), startsAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 30 * 86_400_000).toISOString(), refreshAfter: new Date(now - 1_000).toISOString(),
    offlineUntil: new Date(now + 3 * 86_400_000).toISOString(), features: ['capture', 'printing']
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('fails closed when endpoint or trusted public keys are not configured', async () => {
  const runtime = new LicenseRuntime({ userDataPath: root(), apiBaseUrl: '', productId: 'koko-photobooth', trustedKeys });
  assert.equal((await runtime.getStatus()).state, 'server_error');
  await assert.rejects(runtime.activate('KOKO-TEST-KEY'), /not configured/);
});

test('activates only a server signed lease bound to the assigned installation', async () => {
  const dir = root();
  const fixedNow = Date.parse('2026-03-01T00:00:00.000Z');
  let activationBody;
  const runtime = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => fixedNow,
    fetcher: async (url, init) => {
      assert.equal(url, 'https://license.example.test/v1/desktop/licenses/activate');
      activationBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ entitlement: signed(activationBody.deviceId, fixedNow) }), { status: 200 });
    }
  });
  const result = await runtime.activate('KOKO-REAL-KEY-123');
  assert.equal(result.state, 'active');
  assert.ok(activationBody.idempotencyKey);
  assert.equal(activationBody.productId, 'koko-photobooth');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'license-entitlement.json'), 'utf8')).token.length > 100, true);
  await runtime.assertFeature('capture');
  await assert.rejects(runtime.assertFeature('cloud_sync'), /does not allow/);
});

test('uses only the signed bounded offline grace when refresh is unavailable', async () => {
  const dir = root();
  const onlineNow = Date.parse('2026-03-01T00:00:00.000Z');
  let id;
  const first = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => onlineNow,
    fetcher: async (_url, init) => { id = JSON.parse(init.body).deviceId; return new Response(JSON.stringify({ entitlement: signed(id, onlineNow) }), { status: 200 }); }
  });
  await first.activate('KOKO-REAL-KEY-123');
  const offlineNow = onlineNow + 2 * 86_400_000;
  const offline = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => offlineNow, fetcher: async () => { throw new Error('network offline'); }
  });
  assert.equal((await offline.getStatus()).state, 'offline_grace');
  await offline.assertFeature('capture');
  const pastGrace = new LicenseRuntime({ ...{
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => onlineNow + 4 * 86_400_000, fetcher: async () => { throw new Error('network offline'); }
  } });
  assert.equal((await pastGrace.getStatus()).state, 'server_error');
  await assert.rejects(pastGrace.assertFeature('capture'), /does not allow/);
  const rolledBack = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => onlineNow + 1 * 86_400_000, fetcher: async () => { throw new Error('network offline'); }
  });
  assert.equal((await rolledBack.getStatus()).state, 'server_error');
});

test('refreshes an entitlement after offline grace ends when the service is reachable again', async () => {
  const dir = root();
  const issuedAt = Date.parse('2026-03-01T00:00:00.000Z');
  let deviceId;
  const initial = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => issuedAt,
    fetcher: async (_url, init) => { deviceId = JSON.parse(init.body).deviceId; return new Response(JSON.stringify({ entitlement: signed(deviceId, issuedAt) }), { status: 200 }); }
  });
  await initial.activate('KOKO-REAL-KEY-123');
  const onlineAfterGrace = issuedAt + 4 * 86_400_000;
  let refreshed = false;
  const reconnect = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => onlineAfterGrace,
    fetcher: async (url, init) => {
      assert.equal(url, 'https://license.example.test/v1/desktop/leases/refresh');
      assert.equal(JSON.parse(init.body).deviceId, deviceId);
      refreshed = true;
      return new Response(JSON.stringify({ entitlement: signed(deviceId, onlineAfterGrace) }), { status: 200 });
    }
  });
  assert.equal((await reconnect.getStatus()).state, 'active');
  assert.equal(refreshed, true);
});

test('rejects a server response signed for another installation', async () => {
  const runtime = new LicenseRuntime({
    userDataPath: root(), apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    fetcher: async () => new Response(JSON.stringify({ entitlement: signed('some-other-device') }), { status: 200 })
  });
  await assert.rejects(runtime.activate('KOKO-REAL-KEY-123'), /signature or device binding is invalid/);
});

test('browser account linking keeps the poll secret in Main and accepts only a verified entitlement', async () => {
  const dir = root();
  const fixedNow = Date.parse('2026-03-01T00:00:00.000Z');
  const pollCode = 'D'.repeat(43);
  const expiresAt = new Date(fixedNow + 5 * 60_000).toISOString();
  let deviceId;
  let pollCount = 0;
  const runtime = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => fixedNow,
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body || '{}');
      if (url.endsWith('/v1/desktop/licenses/activate')) {
        deviceId = body.deviceId;
        return new Response(JSON.stringify({ entitlement: signed(deviceId, fixedNow) }), { status: 200 });
      }
      if (url.endsWith('/v1/desktop/leases/refresh')) {
        assert.equal(body.deviceId, deviceId);
        return new Response(JSON.stringify({ entitlement: signed(deviceId, fixedNow) }), { status: 200 });
      }
      if (url.endsWith('/v1/desktop/device-authorizations')) {
        assert.equal(body.deviceId, deviceId);
        assert.equal(body.productId, 'koko-photobooth');
        assert.equal(typeof body.entitlement, 'string');
        return new Response(JSON.stringify({
          authorizationId: 'authorization-123456', deviceCode: pollCode, userCode: 'A1B2C-3D4E5',
          verificationUrl: 'https://license.example.test/account/koko-studio/link', expiresAt, pollIntervalSeconds: 5
        }), { status: 200 });
      }
      if (url.endsWith('/v1/desktop/device-authorizations/poll')) {
        assert.equal(body.authorizationId, 'authorization-123456');
        assert.equal(body.deviceCode, pollCode);
        pollCount += 1;
        if (pollCount === 1) return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503, headers: { 'retry-after': '7' } });
        if (pollCount === 2) return new Response(JSON.stringify({ code: 'rate_limited' }), { status: 429, headers: { 'retry-after': '12' } });
        if (pollCount === 3) return new Response(JSON.stringify({ status: 'pending' }), { status: 200 });
        return new Response(JSON.stringify({ status: 'approved', entitlement: signed(deviceId, fixedNow) }), { status: 200 });
      }
      throw new Error(`Unexpected license route: ${url}`);
    }
  });

  await runtime.activate('KOKO-REAL-KEY-123');
  const link = await runtime.beginAccountLink();
  assert.deepEqual(link.start, { userCode: 'A1B2C-3D4E5', expiresAt });
  assert.equal(link.verificationUrl, 'https://license.example.test/account/koko-studio/link');
  assert.equal(JSON.stringify(link).includes(pollCode), false);
  assert.equal(JSON.stringify(link).includes('entitlement'), false);
  assert.deepEqual(await runtime.pollAccountLink(), { status: 'pending', retryAfterSeconds: 7 });
  assert.deepEqual(await runtime.pollAccountLink(), { status: 'pending', retryAfterSeconds: 12 });
  assert.deepEqual(await runtime.pollAccountLink(), { status: 'pending' });
  const approved = await runtime.pollAccountLink();
  assert.equal(approved.status, 'approved');
  assert.equal(approved.license.state, 'active');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'license-entitlement.json'), 'utf8')).token, signed(deviceId, fixedNow));
});

test('account linking rejects an untrusted verification origin and never stores an unverified approval', async () => {
  const dir = root();
  const fixedNow = Date.parse('2026-03-01T00:00:00.000Z');
  let deviceId;
  let maliciousUrl = false;
  let badApproval = false;
  const runtime = new LicenseRuntime({
    userDataPath: dir, apiBaseUrl: 'https://license.example.test', productId: 'koko-photobooth', trustedKeys,
    now: () => fixedNow,
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body || '{}');
      if (url.endsWith('/v1/desktop/licenses/activate')) {
        deviceId = body.deviceId;
        return new Response(JSON.stringify({ entitlement: signed(deviceId, fixedNow) }), { status: 200 });
      }
      if (url.endsWith('/v1/desktop/leases/refresh')) return new Response(JSON.stringify({ entitlement: signed(deviceId, fixedNow) }), { status: 200 });
      if (url.endsWith('/v1/desktop/device-authorizations')) return new Response(JSON.stringify({
        authorizationId: 'authorization-123456', deviceCode: 'E'.repeat(43), userCode: 'A1B2C-3D4E5',
        verificationUrl: maliciousUrl ? 'https://attacker.example/account/koko-studio/link' : 'https://license.example.test/account/koko-studio/link',
        expiresAt: new Date(fixedNow + 5 * 60_000).toISOString()
      }), { status: 200 });
      if (url.endsWith('/v1/desktop/device-authorizations/poll')) return new Response(JSON.stringify({ status: 'approved', entitlement: signed(badApproval ? 'other-device' : deviceId, fixedNow) }), { status: 200 });
      throw new Error(`Unexpected license route: ${url}`);
    }
  });

  await runtime.activate('KOKO-REAL-KEY-123');
  const originalToken = JSON.parse(readFileSync(path.join(dir, 'license-entitlement.json'), 'utf8')).token;
  maliciousUrl = true;
  await assert.rejects(runtime.beginAccountLink(), /verification URL is not trusted/);
  maliciousUrl = false;
  await runtime.beginAccountLink();
  badApproval = true;
  await assert.rejects(runtime.pollAccountLink(), /approved account entitlement could not be verified/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'license-entitlement.json'), 'utf8')).token, originalToken);
});
