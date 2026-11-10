const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DEFAULT_SLIDESHOW, IDLE_BEFORE_SLIDESHOW_MS, advanceSlideshow, normalizeSlideshowSettings, pickSlideshowPhotoIds, slideshowShouldRun } = require('../src/shared/slideshow.ts');

const session = (id, status, updatedAt, extra = {}) => ({ id, eventId: 'ev1', status, photoIds: [`${id}-a`], createdAt: updatedAt, updatedAt, ...extra });

test('settings fall back to safe defaults, and the slideshow is off unless switched on', () => {
  assert.deepEqual(normalizeSlideshowSettings(undefined), DEFAULT_SLIDESHOW);
  assert.equal(DEFAULT_SLIDESHOW.enabled, false);
  assert.deepEqual(normalizeSlideshowSettings({ enabled: true, secondsPerSlide: 10, limit: 100 }), { enabled: true, secondsPerSlide: 10, limit: 100 });
  assert.deepEqual(normalizeSlideshowSettings({ enabled: 'yes', secondsPerSlide: 7, limit: 3 }), DEFAULT_SLIDESHOW);
  assert.equal(normalizeSlideshowSettings(null).enabled, false);
});

test('shows only confirmed rounds of this event, newest first', () => {
  const sessions = [
    session('old', 'confirmed', '2026-11-10T10:00:00Z'),
    session('retaken', 'retaken', '2026-11-10T11:00:00Z'),
    session('cancelled', 'cancelled', '2026-11-10T11:30:00Z'),
    session('review', 'review', '2026-11-10T11:40:00Z'),
    session('new', 'confirmed', '2026-11-10T12:00:00Z'),
    { ...session('other', 'confirmed', '2026-11-10T13:00:00Z'), eventId: 'ev2' }
  ];
  assert.deepEqual(pickSlideshowPhotoIds(sessions, 'ev1', 50), ['new-a', 'old-a']);
  assert.deepEqual(pickSlideshowPhotoIds(sessions, 'ev2', 50), ['other-a']);
  assert.deepEqual(pickSlideshowPhotoIds(sessions, 'nope', 50), []);
});

test('a composed picture replaces the round\'s separate photos; the limit and duplicates are respected', () => {
  const sessions = [
    session('a', 'confirmed', '2026-11-10T12:00:00Z', { photoIds: ['a1', 'a2', 'a3', 'a4'], compositionPhotoId: 'a-comp' }),
    session('b', 'confirmed', '2026-11-10T11:00:00Z', { photoIds: ['b1', 'b2'] }),
    session('c', 'confirmed', '2026-11-10T10:00:00Z', { photoIds: ['b1'] })
  ];
  assert.deepEqual(pickSlideshowPhotoIds(sessions, 'ev1', 50), ['a-comp', 'b1', 'b2']);
  assert.deepEqual(pickSlideshowPhotoIds(sessions, 'ev1', 2), ['a-comp', 'b1']);
  assert.deepEqual(pickSlideshowPhotoIds(sessions, 'ev1', 0), []);
});

test('the slideshow only runs when enabled, when there are photos, and after the booth has been idle', () => {
  const on = { ...DEFAULT_SLIDESHOW, enabled: true };
  const now = 1_000_000;
  assert.equal(slideshowShouldRun(on, false, now, now - IDLE_BEFORE_SLIDESHOW_MS, true), true);
  assert.equal(slideshowShouldRun(on, false, now, now - IDLE_BEFORE_SLIDESHOW_MS + 1, true), false);
  assert.equal(slideshowShouldRun(on, true, now, now - 10 * IDLE_BEFORE_SLIDESHOW_MS, true), false);
  assert.equal(slideshowShouldRun(on, false, now, 0, false), false);
  assert.equal(slideshowShouldRun(DEFAULT_SLIDESHOW, false, now, 0, true), false);
});

test('moves on after the configured time, wraps around and puts brand-new pictures first', () => {
  const settings = { ...DEFAULT_SLIDESHOW, enabled: true, secondsPerSlide: 4 };
  let state = { index: 0, shownAt: 0, lastActivityAt: 0, ids: [] };
  let step = advanceSlideshow(state, ['p1', 'p2', 'p3'], settings, 1000);
  assert.equal(step.changed, true);
  assert.deepEqual(step.state.ids, ['p1', 'p2', 'p3']);
  assert.equal(step.state.index, 0);
  state = step.state;
  step = advanceSlideshow(state, ['p1', 'p2', 'p3'], settings, 3000);
  assert.equal(step.changed, false);
  step = advanceSlideshow(step.state, ['p1', 'p2', 'p3'], settings, 5000);
  assert.equal(step.changed, true); assert.equal(step.state.index, 1);
  step = advanceSlideshow(step.state, ['p1', 'p2', 'p3'], settings, 9000);
  step = advanceSlideshow(step.state, ['p1', 'p2', 'p3'], settings, 13000);
  assert.equal(step.state.index, 0);
  const fresh = advanceSlideshow(step.state, ['new', 'p1', 'p2', 'p3'], settings, 14000);
  assert.equal(fresh.changed, true); assert.equal(fresh.state.ids[0], 'new'); assert.equal(fresh.state.index, 0);
});

test('an emptied list resets, and a removed picture never stays on screen', () => {
  const settings = { ...DEFAULT_SLIDESHOW, enabled: true, secondsPerSlide: 4 };
  const state = { index: 1, shownAt: 0, lastActivityAt: 0, ids: ['p1', 'p2', 'p3'] };
  const gone = advanceSlideshow(state, ['p1', 'p3'], settings, 1000);
  assert.ok(!gone.state.ids.includes('p2'));
  const empty = advanceSlideshow(state, [], settings, 1000);
  assert.equal(empty.changed, true); assert.deepEqual(empty.state.ids, []);
  assert.equal(advanceSlideshow({ index: 0, shownAt: 0, lastActivityAt: 0, ids: [] }, [], settings, 1000).changed, false);
});
