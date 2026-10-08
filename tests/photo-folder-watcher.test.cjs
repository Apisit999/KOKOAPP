const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { PhotoFolderWatcher } = require('../src/main/services/photo-folder-watcher.ts');
const { PhotoStore } = require('../src/main/services/photo-store.ts');

const roots = [];
function temp(prefix) { const value = mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(value); return value; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('imports only stable JPEGs once, preserves source files, and remembers imports after restart', async () => {
  const root = temp('koko-folder-watch-');
  const source = path.join(root, 'camera'); const state = path.join(root, 'user');
  mkdirSync(source);
  const file = path.join(source, 'IMG_1001.JPG');
  const jpeg = Buffer.from([0xff, 0xd8, 0x10, 0x20, 0xff, 0xd9]);
  writeFileSync(file, jpeg);
  const imported = []; const records = []; const notices = [];
  const library = new PhotoStore(path.join(root, 'library'));
  library.configure();
  const watcher = new PhotoFolderWatcher(state, async (bytes, sourceKey) => { imported.push(Buffer.from(bytes)); const record = await library.saveJpegFromSource(Buffer.from(bytes), 1, 1, null, sourceKey); records.push(record); return record; }, name => notices.push(name));
  watcher.start(source);
  await watcher.scanNow();
  assert.equal(imported.length, 0);
  await watcher.scanNow();
  assert.deepEqual(imported, [jpeg]);
  assert.deepEqual(notices, ['IMG_1001.JPG']);
  assert.deepEqual(readFileSync(file), jpeg);
  assert.equal(library.listPhotos().length, 1);
  watcher.stop();

  unlinkSync(path.join(state, 'camera-folder-imports.json'));
  const restored = new PhotoFolderWatcher(state, async (bytes, sourceKey) => { imported.push(Buffer.from(bytes)); const record = await library.saveJpegFromSource(Buffer.from(bytes), 1, 1, null, sourceKey); records.push(record); return record; });
  restored.start(source);
  await restored.scanNow(); await restored.scanNow();
  assert.equal(imported.length, 2);
  assert.equal(records[0].id, records[1].id);
  assert.equal(library.listPhotos().length, 1);
  restored.stop();
});

test('ignores subdirectories and non-JPEG files, and reports invalid JPEG imports', async () => {
  const root = temp('koko-folder-filter-'); const source = path.join(root, 'camera');
  mkdirSync(source);
  mkdirSync(path.join(source, 'nested'));
  writeFileSync(path.join(source, 'notes.txt'), 'not a photo');
  writeFileSync(path.join(source, 'broken.jpg'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(path.join(source, 'nested', 'nested.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const watcher = new PhotoFolderWatcher(path.join(root, 'user'), async () => { throw new Error('Invalid camera JPEG'); });
  watcher.start(source);
  await watcher.scanNow(); await watcher.scanNow();
  assert.equal(watcher.status().importedCount, 0);
  assert.equal(watcher.status().lastError, 'Invalid camera JPEG');
  watcher.stop();
});
