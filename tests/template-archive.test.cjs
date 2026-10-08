const assert = require('node:assert/strict');
const { test } = require('node:test');
const { exportTemplateArchive, mergeTemplateArchive, parseTemplateArchive, TEMPLATE_ARCHIVE_MAX_BYTES } = require('../src/renderer/template-archive.ts');

const template = { id: 'standard-1', name: 'Standard', count: 1, title: 'Hello', footer: 'KOKO', background: '#171714', frame: '#d6b36a', showDate: true, logo: '', overlay: '', videoOverlay: '', slots: [{ x: 10, y: 10, width: 80, height: 80 }], textLayers: [], imageLayers: [] };
const pack = templates => JSON.stringify({ format: 'koko-template-archive', version: 1, templates });

test('exports and imports a portable template with layout intact', () => {
  const restored = parseTemplateArchive(exportTemplateArchive([template]));
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), [template]);
});

test('rejects unsupported, oversized, malformed, and unsafe template archives', () => {
  assert.throws(() => parseTemplateArchive('{'), /valid JSON/);
  assert.throws(() => parseTemplateArchive(JSON.stringify({ format: 'other', version: 1, templates: [] })), /Unsupported/);
  assert.throws(() => parseTemplateArchive(' '.repeat(TEMPLATE_ARCHIVE_MAX_BYTES + 1)), /4 MB/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, overlay: 'https://example.invalid/image.png' }])), /embedded/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, slots: [{ x: -1, y: 0, width: 80, height: 80 }] }])), /layout/);
  assert.throws(() => parseTemplateArchive(pack([{ ...template, imageLayers: [{ id: 'x', src: 'data:image/svg+xml;base64,PHN2Zz4=', x: 10, y: 10, width: 20, height: 20 }] }])), /layers/);
  assert.throws(() => parseTemplateArchive(pack([template, template])), /unique/);
});

test('merges templates by ID while keeping other saved templates', () => {
  const updated = { ...template, name: 'Updated' };
  assert.deepEqual(mergeTemplateArchive([{ ...template, id: 'keep' }, template], [updated]), [{ ...template, id: 'keep' }, updated]);
});
