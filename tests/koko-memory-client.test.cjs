const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { KokoMemoryApiClient, KokoMemoryApiError, parseKokoMemoryUploaderConfig, validateKokoMemoryGalleryUrl } = require('../src/main/services/koko-memory-client.ts');

const config = { apiBaseUrl: 'https://kokomemory.example', bookingId: 'booking_123', shareId: 'share_12345678901234567890', uploadToken: 'u'.repeat(48) };
const photo = { sessionId: 'session-1', photoId: '123e4567-e89b-42d3-a456-426614174000', fileName: 'capture.jpg', mimeType: 'image/jpeg', bytes: Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]) };
const uploadUrl = 'https://account-1.r2.cloudflarestorage.com/photos/signed?signature=test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('validates the uploader config and only accepts a matching private gallery URL', () => {
  assert.deepEqual(parseKokoMemoryUploaderConfig({ ...config, watchFolder: 'ignored' }), config);
  assert.throws(() => parseKokoMemoryUploaderConfig({ ...config, apiBaseUrl: 'http://public.example' }), /HTTPS/);
  assert.throws(() => parseKokoMemoryUploaderConfig({ ...config, bookingId: '../other' }), /booking ID/);
  assert.throws(() => parseKokoMemoryUploaderConfig({ ...config, uploadToken: 'short' }), /token/);
  assert.equal(validateKokoMemoryGalleryUrl('https://kokomemory.example/gallery/booking_123?guestToken=' + 'g'.repeat(48), config), 'https://kokomemory.example/gallery/booking_123?guestToken=' + 'g'.repeat(48));
  assert.throws(() => validateKokoMemoryGalleryUrl('https://kokomemory.example/gallery/another?guestToken=' + 'g'.repeat(48), config), /private gallery URL/);
  assert.throws(() => validateKokoMemoryGalleryUrl('https://kokomemory.example/gallery/booking_123?guestToken=' + 'g'.repeat(48) + '&token=' + 't'.repeat(48), config), /exactly one/);
});

test('runs init, signed PUT, and confirmation with deterministic ID and checksum', async () => {
  const calls = [];
  const api = new KokoMemoryApiClient(async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === 'POST') return json({ success: true, photoId: photo.photoId.replaceAll('-', ''), uploadUrl, alreadyUploaded: false });
    if (String(url) === uploadUrl) return new Response(null, { status: 200 });
    return json({ success: true, photoId: photo.photoId.replaceAll('-', ''), status: 'ready' });
  });
  const result = await api.uploadPhoto(config, photo);
  assert.deepEqual(result, { photoId: photo.photoId.replaceAll('-', ''), alreadyUploaded: false });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${config.uploadToken}`);
  assert.equal(JSON.parse(calls[0].init.body).checksum, createHash('sha256').update(photo.bytes).digest('hex'));
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[2].init.body), { shareId: config.shareId, photoId: photo.photoId.replaceAll('-', '') });
});

test('treats the server alreadyUploaded response as complete without resending bytes', async () => {
  let calls = 0;
  const api = new KokoMemoryApiClient(async () => { calls++; return json({ success: true, photoId: photo.photoId.replaceAll('-', ''), alreadyUploaded: true }); });
  assert.deepEqual(await api.uploadPhoto(config, photo), { photoId: photo.photoId.replaceAll('-', ''), alreadyUploaded: true });
  assert.equal(calls, 1);
});

test('uses the same-origin streaming fallback when the signed storage PUT fails', async () => {
  const calls = [];
  const api = new KokoMemoryApiClient(async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === 'POST') return json({ success: true, photoId: photo.photoId.replaceAll('-', ''), uploadUrl, alreadyUploaded: false });
    if (String(url) === uploadUrl) return new Response(null, { status: 403 });
    return json({ success: true, photoId: photo.photoId.replaceAll('-', ''), status: 'ready' });
  });
  await api.uploadPhoto(config, photo);
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, /\/api\/admin\/gallery\/booking_123\/uploads\?shareId=/);
  assert.equal(calls[2].init.headers.Authorization, `Bearer ${config.uploadToken}`);
});

test('rejects untrusted signed upload hosts and classifies API errors for retry', async () => {
  const malicious = new KokoMemoryApiClient(async () => json({ success: true, photoId: photo.photoId.replaceAll('-', ''), uploadUrl: 'https://attacker.example/upload' }));
  await assert.rejects(malicious.uploadPhoto(config, photo), /untrusted storage URL/);
  const unauthorized = new KokoMemoryApiClient(async () => json({ success: false, error: 'UNAUTHORIZED' }, 401));
  await assert.rejects(unauthorized.uploadPhoto(config, photo), error => error instanceof KokoMemoryApiError && !error.retryable && error.status === 401);
  const unavailable = new KokoMemoryApiClient(async () => json({ success: false, error: 'UPLOAD_PREPARATION_FAILED' }, 503));
  await assert.rejects(unavailable.uploadPhoto(config, photo), error => error instanceof KokoMemoryApiError && error.retryable && error.status === 503);
  await assert.rejects(malicious.uploadPhoto(config, { ...photo, bytes: new Uint8Array(25 * 1024 * 1024 + 1) }), error => error instanceof KokoMemoryApiError && !error.retryable);
});
