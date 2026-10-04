const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { test } = require('node:test');
const { verifyEntitlement } = require('../src/main/services/license-verifier.ts');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const keyId = 'test-key-1';
const trustedKeys = { [keyId]: publicPem };
const now = Date.parse('2026-01-01T00:00:00.000Z');
const expected = { deviceId: 'device-a', productId: 'koko-photobooth', now, offline: false };

function token(overrides = {}, signingKey = privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: 1, keyId, licenseId: 'license-a', deviceId: 'device-a', productId: 'koko-photobooth',
    issuedAt: '2025-12-01T00:00:00.000Z', startsAt: '2025-12-01T00:00:00.000Z',
    expiresAt: '2026-02-01T00:00:00.000Z', refreshAfter: '2025-12-31T00:00:00.000Z',
    offlineUntil: '2026-01-07T00:00:00.000Z', features: ['capture', 'templates'], ...overrides
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), signingKey).toString('base64url')}`;
}

test('accepts a valid server-signed entitlement bound to this product and device', () => {
  const result = verifyEntitlement(token(), trustedKeys, expected);
  assert.equal(result.state, 'active');
  assert.deepEqual(result.claims.features, ['capture', 'templates']);
});

test('allows only the signed offline grace window', () => {
  const result = verifyEntitlement(token(), trustedKeys, { ...expected, offline: true, now: Date.parse('2026-01-03T00:00:00.000Z') });
  assert.equal(result.state, 'offline_grace');
  assert.equal(verifyEntitlement(token(), trustedKeys, { ...expected, offline: true, now: Date.parse('2026-01-08T00:00:00.000Z') }).state, 'server_error');
});

test('rejects expired, wrong-device, and wrong-product entitlements', () => {
  assert.equal(verifyEntitlement(token(), trustedKeys, { ...expected, now: Date.parse('2026-02-01T00:00:00.000Z') }).state, 'expired');
  assert.equal(verifyEntitlement(token(), trustedKeys, { ...expected, deviceId: 'device-b' }).reason, 'wrong-device');
  assert.equal(verifyEntitlement(token(), trustedKeys, { ...expected, productId: 'other-app' }).reason, 'wrong-product');
});

test('rejects clock rollback before the latest signed issue time', () => {
  const recentToken = token({ issuedAt: '2026-01-01T00:00:00.000Z', refreshAfter: '2026-01-01T00:01:00.000Z', startsAt: '2025-12-01T00:00:00.000Z' });
  const result = verifyEntitlement(recentToken, trustedKeys, { ...expected, now: Date.parse('2025-12-31T23:00:00.000Z'), offline: true });
  assert.equal(result.reason, 'clock-rollback');
  assert.equal(result.state, 'server_error');
});

test('rejects unknown keys, modified payloads, malformed tokens, and unsupported algorithms', () => {
  assert.equal(verifyEntitlement(token(), {}, expected).reason, 'unknown-key');
  const valid = token();
  const parts = valid.split('.');
  parts[1] = Buffer.from(JSON.stringify({ schemaVersion: 1 })).toString('base64url');
  assert.equal(verifyEntitlement(parts.join('.'), trustedKeys, expected).reason, 'bad-signature');
  assert.equal(verifyEntitlement('not-a-jws', trustedKeys, expected).reason, 'malformed');
  const unsupportedHeader = Buffer.from(JSON.stringify({ alg: 'none', kid: keyId })).toString('base64url');
  assert.equal(verifyEntitlement(`${unsupportedHeader}.${parts[1]}.${parts[2]}`, trustedKeys, expected).reason, 'malformed');
});
