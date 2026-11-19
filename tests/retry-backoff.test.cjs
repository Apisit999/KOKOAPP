const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RetryBackoff } = require('../src/main/services/retry-backoff.ts');

test('retry backoff: a new item can be tried; after a failure it waits 2, 4, 8 ... minutes, capped at 15', () => {
  const backoff = new RetryBackoff();
  assert.equal(backoff.canTry('a', 0), true);
  assert.equal(backoff.failed('a', 0), 120_000);
  assert.equal(backoff.canTry('a', 119_999), false);
  assert.equal(backoff.canTry('a', 120_000), true);
  assert.equal(backoff.failed('a', 120_000), 240_000);
  assert.equal(backoff.failed('a', 0), 480_000);
  assert.equal(backoff.failed('a', 0), 900_000);
  assert.equal(backoff.failed('a', 0), 900_000, 'never longer than 15 minutes');
});

test('retry backoff: other items are not affected, success clears the wait, and a fixed wait can be forced', () => {
  const backoff = new RetryBackoff();
  backoff.failed('a', 0);
  assert.equal(backoff.canTry('b', 1), true);
  backoff.succeeded('a');
  assert.equal(backoff.canTry('a', 1), true);
  assert.equal(backoff.failed('a', 0, 3_600_000), 3_600_000);
  assert.equal(backoff.canTry('a', 3_599_999), false);
});
