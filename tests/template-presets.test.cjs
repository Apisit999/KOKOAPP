const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TEMPLATE_PRESETS, PRESET_BACKGROUNDS, applyTemplatePreset } = require('../src/renderer/template-presets.ts');
const { countAllowed, isTemplateSize } = require('../src/shared/template-size.ts');

test('every preset is valid for the template editor', () => {
  const ids = new Set();
  for (const preset of TEMPLATE_PRESETS) {
    assert.ok(!ids.has(preset.id), `duplicate id ${preset.id}`);
    ids.add(preset.id);
    assert.ok(countAllowed(preset.size, preset.count), `${preset.id} count fits its size`);
    assert.ok(preset.size === undefined || isTemplateSize(preset.size), `${preset.id} size`);
    assert.ok(PRESET_BACKGROUNDS.includes(preset.background), `${preset.id} background must be one of the editor's colours`);
    assert.match(preset.frame, /^#[0-9a-f]{6}$/i, `${preset.id} frame colour`);
    for (const language of ['th', 'en']) {
      assert.ok(preset.name[language].trim().length > 0 && preset.name[language].length <= 60, `${preset.id} name ${language}`);
      assert.ok(preset.title[language].trim().length > 0 && preset.title[language].length <= 60, `${preset.id} title ${language}`);
      assert.ok(preset.footer[language].trim().length > 0 && preset.footer[language].length <= 80, `${preset.id} footer ${language}`);
    }
    assert.equal(typeof preset.showDate, 'boolean');
  }
  assert.ok(TEMPLATE_PRESETS.length >= 6);
});

const draft = { id: 't1', name: '', count: 2, title: 'x', footer: 'y', background: '#171714', frame: '#d6b36a', showDate: true, logo: 'data:logo', overlay: 'data:frame', slots: [{ x: 1 }], textLayers: [{ id: 'a' }] };
const byId = id => TEMPLATE_PRESETS.find(item => item.id === id);

test('applying a preset fills text and colours in the chosen language and keeps the id, logo and layers', () => {
  const result = applyTemplatePreset(draft, byId('birthday'), 'en');
  assert.equal(result.title, 'Happy Birthday!');
  assert.equal(result.count, 4);
  assert.equal(result.name, 'Birthday');
  assert.equal(result.id, 't1');
  assert.equal(result.logo, 'data:logo');
  assert.deepEqual(result.textLayers, [{ id: 'a' }]);
  assert.equal(applyTemplatePreset(draft, byId('birthday'), 'th').title, 'สุขสันต์วันเกิด!');
});

test('an existing name is kept, and the frame image and openings are dropped only when the layout changes', () => {
  const named = { ...draft, name: 'My event' };
  const changed = applyTemplatePreset(named, byId('birthday'), 'en');
  assert.equal(changed.name, 'My event');
  assert.equal(changed.overlay, '');
  assert.equal(changed.slots, undefined);
  const same = applyTemplatePreset(named, byId('wedding'), 'en');
  assert.equal(same.count, 2);
  assert.equal(same.overlay, 'data:frame');
  assert.deepEqual(same.slots, [{ x: 1 }]);
});

test('applying a preset does not modify the draft it was given', () => {
  const copy = JSON.parse(JSON.stringify(draft));
  applyTemplatePreset(draft, byId('corporate'), 'en');
  assert.deepEqual(draft, copy);
});
