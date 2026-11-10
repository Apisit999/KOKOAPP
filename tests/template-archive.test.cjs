const assert = require('node:assert/strict');
const { test } = require('node:test');
const { exportTemplateArchive, mergeTemplateArchive, parseTemplateArchive, parseTemplateArchiveWithFonts, TEMPLATE_ARCHIVE_MAX_BYTES } = require('../src/renderer/template-archive.ts');

const template = { id: 'standard-1', name: 'Standard', count: 1, title: 'Hello', footer: 'KOKO', background: '#171714', frame: '#d6b36a', showDate: true, logo: '', overlay: '', videoOverlay: '', slots: [{ x: 10, y: 10, width: 80, height: 80 }], textLayers: [], imageLayers: [] };
const pack = templates => JSON.stringify({ format: 'koko-template-archive', version: 1, templates });

test('exports and imports a portable template with layout intact', () => {
  const restored = parseTemplateArchive(exportTemplateArchive([template]));
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), [template]);
});

test('rejects unsupported, oversized, malformed, and unsafe template archives', () => {
  assert.throws(() => parseTemplateArchive('{'), /valid JSON/);
  assert.throws(() => parseTemplateArchive(JSON.stringify({ format: 'other', version: 1, templates: [] })), /Unsupported/);
  assert.throws(() => parseTemplateArchive(' '.repeat(TEMPLATE_ARCHIVE_MAX_BYTES + 1)), /16 MB/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, overlay: 'https://example.invalid/image.png' }])), /embedded/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, slots: [{ x: -1, y: 0, width: 80, height: 80 }] }])), /layout/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, imageLayers: [{ id: 'x', src: 'data:image/svg+xml;base64,PHN2Zz4=', x: 10, y: 10, width: 20, height: 20 }] }])), /layers/);
  assert.throws(() => parseTemplateArchive(pack([template, template])), /unique/);
});

test('merges templates by ID while keeping other saved templates', () => {
  const updated = { ...template, name: 'Updated' };
  assert.deepEqual(mergeTemplateArchive([{ ...template, id: 'keep' }, template], [updated]), [{ ...template, id: 'keep' }, updated]);
});

test('keeps a video-clip template as video and treats other values as photo', () => {
  const [video] = parseTemplateArchive(exportTemplateArchive([{ ...template, mediaMode: 'video' }]));
  assert.equal(video.mediaMode, 'video');
  const [other] = parseTemplateArchive(pack([{ ...template, mediaMode: 'bogus' }]));
  assert.equal(other.mediaMode, undefined);
});

const fontId = 'a'.repeat(32);
test('carries a template font and the font file inside the archive', () => {
  const withFont = { ...template, fontId, textLayers: [{ id: 't1', text: 'Hi', x: 5, y: 5, width: 80, fontSize: 5, color: '#ffffff', align: 'center', fontId }] };
  const json = exportTemplateArchive([withFont], [{ id: fontId, name: 'Pretty Script', data: 'AAEAAAAAAAAAAAAA' }]);
  const { templates, fonts } = parseTemplateArchiveWithFonts(json);
  assert.equal(templates[0].fontId, fontId);
  assert.equal(templates[0].textLayers[0].fontId, fontId);
  assert.deepEqual(fonts, [{ id: fontId, name: 'Pretty Script', data: 'AAEAAAAAAAAAAAAA' }]);
  assert.deepEqual(parseTemplateArchiveWithFonts(exportTemplateArchive([template])).fonts, []);
});

test('rejects bad font ids and font entries', () => {
  assert.throws(() => parseTemplateArchive(pack([{ ...template, fontId: '../x' }])), /invalid fields/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, textLayers: [{ id: 't1', text: 'x', x: 5, y: 5, width: 80, fontSize: 5, color: '#ffffff', align: 'left', fontId: 'nope' }] }])), /invalid text or sticker/);
  const bad = fonts => JSON.stringify({ format: 'koko-template-archive', version: 1, templates: [template], fonts });
  assert.throws(() => parseTemplateArchive(bad([{ id: 'xyz', name: 'A', data: 'AAAA' }])), /invalid font/);
  assert.throws(() => parseTemplateArchive(bad([{ id: fontId, name: 'A', data: 'not base64!' }])), /invalid font/);
  assert.throws(() => parseTemplateArchive(bad('x')), /up to 30 fonts/);
});

test('carries a template size and checks the photo count against it', () => {
  const strip = { ...template, id: 'strip-1', size: 'strip', count: 3, slots: undefined };
  const [restored] = parseTemplateArchive(exportTemplateArchive([strip]));
  assert.equal(restored.size, 'strip'); assert.equal(restored.count, 3);
  assert.throws(() => parseTemplateArchive(pack([{ ...strip, count: 1 }])), /invalid fields/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, count: 3, slots: undefined }])), /invalid fields/);
  assert.throws(() => parseTemplateArchive(pack([{ ...strip, size: 'huge' }])), /invalid fields/);
  assert.equal(parseTemplateArchive(pack([template]))[0].size, undefined);
});
