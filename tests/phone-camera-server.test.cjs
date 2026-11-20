const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PhoneCameraServer, lanAddress } = require('../src/main/services/phone-camera-server.ts');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const base = status => status.url.replace(/\/c\/.*/, '');
const path = status => new URL(status.url).pathname;

test('serves the page and accepts a JPEG only with the secret token', async () => {
  const got = [];
  const server = new PhoneCameraServer(async bytes => { got.push(Buffer.from(bytes)); });
  const status = await server.start(0, '127.0.0.1', '127.0.0.1');
  try {
    assert.equal(status.enabled, true);
    const page = await fetch(status.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /capture="environment"/);
    assert.equal((await fetch(`${base(status)}/c/wrong-token`)).status, 404);
    assert.equal((await fetch(`${base(status)}/`)).status, 404);
    assert.equal((await fetch(`${base(status)}/c/wrong-token/photo`, { method: 'POST', body: jpeg })).status, 404);
    assert.equal(got.length, 0);
    const ok = await fetch(`${status.url}/photo`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, count: 1 });
    assert.deepEqual(got[0], jpeg);
    assert.equal(server.status().receivedCount, 1);
  } finally { await server.stop(); }
});

test('rejects non-JPEG, wrong method and oversize bodies', async () => {
  const server = new PhoneCameraServer(async () => {});
  const status = await server.start(0, '127.0.0.1', '127.0.0.1');
  try {
    assert.equal((await fetch(`${status.url}/photo`, { method: 'POST', body: Buffer.from('hello world') })).status, 415);
    assert.equal((await fetch(`${status.url}/photo`)).status, 405);
    const big = await fetch(`${status.url}/photo`, { method: 'POST', body: Buffer.alloc(31 * 1024 * 1024, 0xff) }).then(r => r.status, () => 413);
    assert.equal(big, 413);
    assert.equal(server.status().receivedCount, 0);
  } finally { await server.stop(); }
});

test('a failing save is reported as 500 and not counted', async () => {
  const server = new PhoneCameraServer(async () => { throw new Error('disk full'); });
  const status = await server.start(0, '127.0.0.1', '127.0.0.1');
  try {
    assert.equal((await fetch(`${status.url}/photo`, { method: 'POST', body: jpeg })).status, 500);
    assert.equal(server.status().receivedCount, 0);
    assert.equal(server.status().lastError, 'disk full');
  } finally { await server.stop(); }
});

test('stop closes the port and a restart issues a new secret', async () => {
  const server = new PhoneCameraServer(async () => {});
  const first = await server.start(0, '127.0.0.1', '127.0.0.1');
  const stopped = await server.stop();
  assert.equal(stopped.enabled, false);
  await assert.rejects(fetch(first.url));
  const second = await server.start(0, '127.0.0.1', '127.0.0.1');
  try { assert.notEqual(path(first), path(second)); } finally { await server.stop(); }
});

test('lanAddress prefers home/office ranges and ignores loopback', () => {
  const nic = address => [{ family: 'IPv4', internal: false, address }];
  assert.equal(lanAddress({ a: nic('169.254.3.4'), b: nic('192.168.1.20'), c: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }), '192.168.1.20');
  assert.equal(lanAddress({ a: nic('172.20.1.2'), b: nic('10.0.0.5') }), '10.0.0.5');
  assert.equal(lanAddress({}), null);
});
