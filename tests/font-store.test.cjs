const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { FontStore, detectFontFormat, fontNameFromFile, MAX_FONTS, MAX_FONT_BYTES } = require('../src/main/services/font-store.ts');

const roots = [];
function makeStore() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koko-fonts-'));
  roots.push(root);
  return { root, store: new FontStore(path.join(root, 'fonts')) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const font = (tag, filler = 0) => { const bytes = new Uint8Array(64).fill(filler); [...tag].forEach((c, i) => { bytes[i] = typeof c === 'string' ? c.charCodeAt(0) : c; }); return bytes; };
const ttf = filler => Uint8Array.from([0, 1, 0, 0, ...new Uint8Array(60).fill(filler)]);

test('recognises the four font containers and rejects everything else', () => {
  assert.equal(detectFontFormat(ttf(1)), 'ttf');
  assert.equal(detectFontFormat(font('OTTO')), 'otf');
  assert.equal(detectFontFormat(font('wOFF')), 'woff');
  assert.equal(detectFontFormat(font('wOF2')), 'woff2');
  assert.equal(detectFontFormat(font('true')), 'ttf');
  assert.equal(detectFontFormat(font('MZ\u0090\u0000')), null);
  assert.equal(detectFontFormat(Uint8Array.from([0, 1, 0, 0])), null);
});

test('derives a clean display name from a file name', () => {
  assert.equal(fontNameFromFile('C:\\Users\\me\\Fonts\\Sarabun_Bold.ttf'), 'Sarabun Bold');
  assert.equal(fontNameFromFile('/tmp/My   Font.OTF'), 'My Font');
  assert.equal(fontNameFromFile('.ttf'), 'Font');
  assert.equal(fontNameFromFile('a<b>"c".woff2'), 'abc');
  assert.equal(fontNameFromFile('x'.repeat(200) + '.ttf').length, 60);
});

test('stores, lists, reads and removes a font; the same bytes are stored once', () => {
  const { store } = makeStore();
  assert.deepEqual(store.list(), []);
  const a = store.add(ttf(7), 'Pretty Script.ttf');
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.equal(a.name, 'Pretty Script');
  assert.equal(a.format, 'ttf');
  assert.deepEqual(store.add(ttf(7), 'Other name.ttf'), a);
  assert.equal(store.list().length, 1);
  assert.deepEqual(Array.from(store.read(a.id).bytes), Array.from(ttf(7)));
  assert.equal(store.remove(a.id), true);
  assert.equal(store.remove(a.id), false);
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.read(a.id), /not found/);
});

test('rejects non-fonts, oversized files and a full library; bad ids never touch the disk', () => {
  const { root, store } = makeStore();
  assert.throws(() => store.add(new Uint8Array(100), 'notes.ttf'), /not a TrueType/);
  assert.throws(() => store.add(new Uint8Array(MAX_FONT_BYTES + 1), 'big.ttf'), /larger than 3 MB/);
  for (let i = 0; i < MAX_FONTS; i++) store.add(ttf(i + 1), `f${i}.ttf`);
  assert.throws(() => store.add(ttf(200), 'one more.ttf'), /Up to 30 fonts/);
  assert.throws(() => store.read('../../etc/passwd'), /Invalid font ID/);
  assert.throws(() => store.remove('nope'), /Invalid font ID/);
  assert.equal(readdirSync(path.join(root, 'fonts')).filter(name => name.endsWith('.tmp')).length, 0);
});

test('a damaged index is reported and never overwritten', () => {
  const { root, store } = makeStore();
  store.add(ttf(3), 'a.ttf');
  writeFileSync(path.join(root, 'fonts', 'font-index.json'), '{broken');
  assert.throws(() => store.list(), /damaged/);
  assert.throws(() => store.add(ttf(4), 'b.ttf'), /damaged/);
  assert.equal(existsSync(path.join(root, 'fonts', 'font-index.json')), true);
});
