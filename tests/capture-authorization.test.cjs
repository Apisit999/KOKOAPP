const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CaptureAuthorizationRegistry } = require('../src/main/services/capture-authorization.ts');

test('grants only 1, 2, or 4 valid photos and decrements successful saves', () => {
  const grants = new CaptureAuthorizationRegistry();
  for (const value of [0, -1, 3, 5, 1.2, '2']) assert.throws(() => grants.begin(value), /photo count/);
  const id = grants.begin(2, 1000);
  grants.claim(id, 1001);
  assert.equal(grants.cancel(id), false);
  grants.complete(id);
  grants.release(id);
  grants.claim(id, 1002);
  grants.complete(id);
  grants.release(id);
  assert.throws(() => grants.claim(id, 1003), /invalid or expired/);
});

test('rejects replay, parallel saves, expired grants, and honors cancellation', () => {
  const grants = new CaptureAuthorizationRegistry();
  const id = grants.begin(1, 1000);
  grants.claim(id, 1001);
  assert.throws(() => grants.claim(id, 1001), /invalid or expired/);
  grants.release(id);
  assert.equal(grants.cancel(id), true);
  assert.throws(() => grants.claim(id, 1002), /invalid or expired/);

  const expiring = grants.begin(1, 2000);
  assert.throws(() => grants.claim(expiring, 2000 + 5 * 60_000), /invalid or expired/);
});

test('does not expire a save after Main has claimed its in-flight authorization', () => {
  const grants = new CaptureAuthorizationRegistry();
  const id = grants.begin(1, 0);
  grants.claim(id, 1);
  assert.equal(grants.begin(1, 5 * 60_001).length > 0, true);
  grants.complete(id);
  grants.release(id);
  assert.throws(() => grants.claim(id, 5 * 60_002), /invalid or expired/);
});

test('binds a capture grant to the durable session and event selected by Main', () => {
  const grants = new CaptureAuthorizationRegistry();
  const eventId = '7a00a287-b029-4e78-a613-21c707f15e17';
  const sessionId = '4cf14a3c-f4b4-4a59-9abc-5feb633d0649';
  const authorizationId = grants.begin(2, eventId, 1000, sessionId);
  assert.equal(grants.getSessionId(authorizationId), sessionId);
  assert.deepEqual(grants.claim(authorizationId, 1001), { eventId, sessionId });
});
