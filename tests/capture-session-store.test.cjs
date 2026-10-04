const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { CaptureSessionStore, validateCaptureTemplate } = require('../src/main/services/capture-session-store.ts');

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'koko-sessions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const template = { id: 'saved-1', name: 'Wedding', count: 2, title: 'Together', footer: 'KOKO', background: '#171714', frame: '#d6b36a', showDate: true,
  slots: [{ x: 7, y: 12, width: 86, height: 35 }, { x: 7, y: 54, width: 86, height: 35 }],
  textLayers: [{ id: 'photo-caption', text: 'Our day', x: 8, y: 4, width: 84, fontSize: 4, color: '#ffffff', align: 'center' }],
  videoTextLayers: [{ id: 'video-label', text: 'Live now', x: 8, y: 84, width: 84, fontSize: 3, color: '#ffffff', align: 'center' }],
  videoFrame: { x: 4, y: 5, width: 92, height: 90 },
  imageLayers: [{ id: 'photo-sticker', src: 'data:image/png;base64,iVBORw0KGgo=', x: 10, y: 20, width: 25, height: 30 }],
  videoImageLayers: [{ id: 'video-sticker', src: 'data:image/png;base64,iVBORw0KGgo=', x: 30, y: 40, width: 20, height: 20 }] };

test('persists the template snapshot and linked photos through review and confirmation', t => {
  const directory = fixture(t);
  const first = new CaptureSessionStore(directory);
  const session = first.start(null, validateCaptureTemplate(template));
  assert.equal(first.list()[0].status, 'capturing');
  first.addPhoto(session.id, '5d60670b-3872-422c-bfd2-bbc48f27f8e1');
  first.addPhoto(session.id, 'f3476e5c-2b98-4778-817a-eb1a3d9445bc');
  first.finish(session.id, 'review');
  const reopened = new CaptureSessionStore(directory);
  assert.equal(reopened.list()[0].template.name, 'Wedding');
  assert.deepEqual(reopened.list()[0].template.slots, template.slots);
  assert.deepEqual(reopened.list()[0].template.textLayers, template.textLayers);
  assert.deepEqual(reopened.list()[0].template.videoTextLayers, template.videoTextLayers);
  assert.deepEqual(reopened.list()[0].template.videoFrame, template.videoFrame);
  assert.deepEqual(reopened.list()[0].template.imageLayers, template.imageLayers);
  assert.deepEqual(reopened.list()[0].template.videoImageLayers, template.videoImageLayers);
  assert.equal(reopened.list()[0].photoIds.length, 2);
  assert.equal(reopened.finish(session.id, 'confirmed').status, 'confirmed');
  assert.equal(new CaptureSessionStore(directory).list()[0].status, 'confirmed');
});

test('marks an unfinished capture interrupted after restart and rejects an invalid template', t => {
  const directory = fixture(t);
  const session = new CaptureSessionStore(directory).start(null, null);
  const reopened = new CaptureSessionStore(directory);
  assert.equal(reopened.list()[0].status, 'interrupted');
  assert.throws(() => validateCaptureTemplate({ ...template, count: 3 }), /Invalid capture template/);
  assert.throws(() => validateCaptureTemplate({ ...template, slots: [{ x: -1, y: 0, width: 20, height: 20 }, template.slots[1]] }), /Invalid capture template/);
  assert.throws(() => validateCaptureTemplate({ ...template, textLayers: [{ ...template.textLayers[0], color: 'url(javascript:alert(1))' }] }), /Invalid capture template/);
  assert.throws(() => validateCaptureTemplate({ ...template, imageLayers: [{ ...template.imageLayers[0], src: 'data:text/html;base64,PHNjcmlwdD4=' }] }), /Invalid capture template/);
  assert.throws(() => reopened.list(201), /Invalid capture session page/);
  assert.equal(session.photoIds.length, 0);
});

test('cancelling an in-progress round preserves committed photos for review', t => {
  const directory = fixture(t);
  const store = new CaptureSessionStore(directory);
  const session = store.start(null, null);
  store.addPhoto(session.id, '5d60670b-3872-422c-bfd2-bbc48f27f8e1');

  assert.equal(store.cancel(session.id).status, 'review');
  const reopened = new CaptureSessionStore(directory);
  assert.equal(reopened.list()[0].status, 'review');
  assert.deepEqual(reopened.list()[0].photoIds, ['5d60670b-3872-422c-bfd2-bbc48f27f8e1']);
});

test('cancelling a round with no saved photos marks it cancelled', t => {
  const store = new CaptureSessionStore(fixture(t));
  const session = store.start(null, null);
  assert.equal(store.cancel(session.id).status, 'cancelled');
});
