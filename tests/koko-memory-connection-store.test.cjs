const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { KokoMemoryConnectionStore } = require('../src/main/services/koko-memory-connection-store.ts');

const roots = [];
function temp() { const value = mkdtempSync(path.join(os.tmpdir(), 'koko-memory-vault-')); roots.push(value); return value; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const box = { encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString('utf8') };
const config = { apiBaseUrl: 'https://kokomemory.example', bookingId: 'booking_123', shareId: 'share_12345678901234567890', uploadToken: 'secret-upload-token-123456789012345678901234567890' };

test('encrypts uploader secrets at rest and only returns nonsecret connection status', () => {
  const root = temp(); const store = new KokoMemoryConnectionStore(root, box);
  const status = store.importUploaderConfig(JSON.stringify({ ...config, watchFolder: 'C:\\Camera' }));
  const disk = readFileSync(path.join(root, 'kokomemory-connections.json'), 'utf8');
  assert.equal(status.configured, true);
  assert.equal(status.bookingId, config.bookingId);
  assert.equal(status.shareId, config.shareId);
  assert.equal(status.apiOrigin, 'https://kokomemory.example');
  assert.equal('uploadToken' in status, false);
  assert.equal(disk.includes(config.uploadToken), false);

  const galleryUrl = `https://kokomemory.example/gallery/${config.bookingId}?guestToken=${'g'.repeat(48)}`;
  const linked = store.setActiveGalleryUrl(galleryUrl);
  assert.equal(linked.galleryUrl, galleryUrl);
  assert.equal(readFileSync(path.join(root, 'kokomemory-connections.json'), 'utf8').includes('g'.repeat(48)), false);
  const reopened = new KokoMemoryConnectionStore(root, box);
  assert.deepEqual(reopened.getActive(), { ...config, id: status.connectionId, galleryUrl });
});

test('keeps album credentials separate and fails closed on a damaged vault', () => {
  const root = temp(); const store = new KokoMemoryConnectionStore(root, box);
  const first = store.importUploaderConfig(JSON.stringify(config));
  const secondConfig = { ...config, bookingId: 'booking_456', shareId: 'share_abcdefghij1234567890', uploadToken: 'other-upload-token-123456789012345678901234567890' };
  const second = store.importUploaderConfig(JSON.stringify(secondConfig));
  assert.notEqual(first.connectionId, second.connectionId);
  assert.equal(store.getActive().bookingId, secondConfig.bookingId);

  writeFileSync(path.join(root, 'kokomemory-connections.json'), '{broken');
  assert.throws(() => store.importUploaderConfig(JSON.stringify(config)), /existing data was preserved/);
  assert.equal(readFileSync(path.join(root, 'kokomemory-connections.json'), 'utf8'), '{broken');
});
