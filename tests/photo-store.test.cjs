const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { PhotoStore, validateStorageRoot } = require('../src/main/services/photo-store.ts');
const { jpegDimensions } = require('../src/main/services/jpeg-image.ts');

const temporaryRoots = [];
function createRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koko-photo-store-'));
  temporaryRoots.push(root);
  return root;
}
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('requires a selected directory and initializes an empty manifest', () => {
  const root = createRoot();
  assert.equal(validateStorageRoot(root), realpathSync(root));
  const store = new PhotoStore(root);
  store.configure();
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'photo-index.json'), 'utf8')), { schemaVersion: 1, photos: [] });
  assert.deepEqual(store.getStatus(true), {
    configured: true, directoryName: path.basename(root), photoCount: 0, pendingRecovery: 0, needsAttention: false
  });
  assert.equal(store.getStatus(false).configured, false);
});

test('writes supplied photo bytes before committing indexed metadata', async () => {
  const root = createRoot();
  const store = new PhotoStore(root);
  store.configure();
  const bytes = Buffer.from([0xff, 0xd8, 0x10, 0x20, 0xff, 0xd9]);
  const photo = await store.saveJpeg(bytes, 1200, 800);
  assert.deepEqual(readFileSync(path.join(root, 'photos', photo.fileName)), bytes);
  assert.equal(photo.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'photo-index.json'), 'utf8')).photos, [photo]);
  assert.equal(store.getStatus(true).photoCount, 1);
});

test('lists indexed photos and reads bytes only after identity and integrity checks', async () => {
  const root = createRoot();
  const store = new PhotoStore(root);
  store.configure();
  const bytes = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9]);
  const saved = await store.saveJpeg(bytes, 640, 480);
  assert.deepEqual(store.listPhotos(), [saved]);
  assert.deepEqual(store.readPhoto(saved.id), { photo: saved, bytes: new Uint8Array(bytes) });
  assert.throws(() => store.readPhoto('../photo-index.json'), /Invalid photo ID/);
  assert.throws(() => store.listPhotos(-1, 10), /Invalid photo page/);
  assert.throws(() => store.listPhotos(0, 201), /Invalid photo page/);
  writeFileSync(path.join(root, 'photos', saved.fileName), Buffer.from('changed'));
  assert.throws(() => store.readPhoto(saved.id), /invalid|integrity/i);
});

test('removes a photo from the library after the OS trash adapter moves the managed file', async () => {
  const root = createRoot();
  const store = new PhotoStore(root);
  store.configure();
  const saved = await store.saveJpeg(Buffer.from('image'), 1, 1);
  const osTrash = path.join(root, 'system-trash');
  mkdirSync(osTrash);
  let movedPath = '';
  assert.equal(await store.movePhotoToTrash(saved.id, async photoPath => {
    movedPath = photoPath;
    renameSync(photoPath, path.join(osTrash, saved.fileName));
  }), true);
  assert.equal(movedPath, path.join(root, 'photos', saved.fileName));
  assert.deepEqual(readFileSync(path.join(osTrash, saved.fileName)), Buffer.from('image'));
  assert.deepEqual(store.listPhotos(), []);
  assert.equal(await store.movePhotoToTrash(saved.id, async () => undefined), false);
  await assert.rejects(store.movePhotoToTrash('../photo-index.json', async () => undefined), /Invalid photo ID/);
});

test('restores the library index when the operating system cannot move the photo to Trash', async () => {
  const root = createRoot();
  const store = new PhotoStore(root);
  store.configure();
  const bytes = Buffer.from('keep this image');
  const saved = await store.saveJpeg(bytes, 1, 1);
  await assert.rejects(store.movePhotoToTrash(saved.id, async () => { throw new Error('Trash unavailable'); }), /Trash unavailable/);
  assert.deepEqual(store.listPhotos(), [saved]);
  assert.deepEqual(store.readPhoto(saved.id).bytes, new Uint8Array(bytes));
});

test('refuses a photo directory replaced with a junction to data outside managed storage', async t => {
  const root = createRoot();
  const outsideRoot = createRoot();
  const store = new PhotoStore(root);
  store.configure();
  const saved = await store.saveJpeg(Buffer.from('inside data'), 1, 1);
  const outsideDirectory = path.join(outsideRoot, 'photos');
  mkdirSync(outsideDirectory);
  const outsidePhoto = path.join(outsideDirectory, saved.fileName);
  writeFileSync(outsidePhoto, Buffer.from('outside data'));
  unlinkSync(path.join(root, 'photos', saved.fileName));
  rmdirSync(path.join(root, 'photos'));
  try { symlinkSync(outsideDirectory, path.join(root, 'photos'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.skip('Directory junctions are unavailable in this Windows environment'); return; }
  let called = false;
  await assert.rejects(store.movePhotoToTrash(saved.id, async () => { called = true; }), /safe|symbolic|outside/i);
  assert.equal(called, false);
  assert.deepEqual(readFileSync(outsidePhoto), Buffer.from('outside data'));
});

test('serializes concurrent saves and reports final files missing from the index', async () => {
  const root = createRoot();
  const store = new PhotoStore(root);
  store.configure();
  const saved = await Promise.all([
    store.saveJpeg(Buffer.from('one'), 1, 1),
    store.saveJpeg(Buffer.from('two'), 1, 1)
  ]);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.notEqual(saved[0].fileName, saved[1].fileName);
  assert.deepEqual(readFileSync(path.join(root, 'photos', saved[0].fileName)), Buffer.from('one'));
  assert.deepEqual(readFileSync(path.join(root, 'photos', saved[1].fileName)), Buffer.from('two'));
  assert.equal(store.getStatus(true).photoCount, 2);
  writeFileSync(path.join(root, 'photos', randomUUID() + '.jpg'), Buffer.from('orphan'));
  writeFileSync(path.join(root, 'photos', '.' + randomUUID() + '.tmp'), Buffer.from('partial'));
  assert.deepEqual(
    { pendingRecovery: store.getStatus(true).pendingRecovery, needsAttention: store.getStatus(true).needsAttention },
    { pendingRecovery: 2, needsAttention: true }
  );
});

test('does not overwrite an invalid manifest during configuration or save', async () => {
  const root = createRoot();
  const store = new PhotoStore(root);
  store.configure();
  writeFileSync(path.join(root, 'photo-index.json'), '{broken');
  assert.throws(() => store.configure());
  await assert.rejects(store.saveJpeg(Buffer.from('image'), 1, 1));
  assert.equal(store.getStatus(true).needsAttention, true);
  assert.equal(require('node:fs').readdirSync(path.join(root, 'photos')).length, 0);
});

test('refuses the drive root as a storage location', () => {
  const driveRoot = path.parse(process.cwd()).root;
  assert.throws(() => validateStorageRoot(driveRoot));
});

test('reads JPEG dimensions and rejects malformed or oversized image headers', () => {
  const valid = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 2, 3, 1, 17, 0, 0xff, 0xd9]);
  assert.deepEqual(jpegDimensions(valid), { width: 2, height: 1 });
  const oversized = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0x27, 0x11, 0x27, 0x10, 3, 1, 17, 0, 0xff, 0xd9]);
  assert.throws(() => jpegDimensions(oversized), /allowed limit/);
  assert.throws(() => jpegDimensions(Buffer.from('not a JPEG')), /signature/);
  assert.throws(() => jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 40])), /segment length/);
});
