const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarizeEvent } = require('../src/renderer/event-summary.ts');

const at = (h) => new Date(2026, 10, 5, h, 0, 0).toISOString();
const s = (id, eventId, status, h, photos = 2, name = 'Strip') => ({ id, eventId, status, photoIds: Array(photos).fill('p'), videoIds: [], template: { name }, createdAt: at(h), updatedAt: at(h) });

test('summarizes only the requested event', () => {
  const r = summarizeEvent([s('1', 'e', 'confirmed', 10), s('2', 'e', 'confirmed', 10, 4, 'Grid'), s('3', 'e', 'retaken', 11), s('4', 'e', 'cancelled', 12), s('5', 'e', 'interrupted', 13), s('6', 'other', 'confirmed', 9)], 'e');
  assert.equal(r.rounds, 5);
  assert.equal(r.confirmed, 2);
  assert.equal(r.photos, 6);
  assert.equal(r.retaken, 1);
  assert.equal(r.cancelled, 1);
  assert.equal(r.unfinished, 1);
  assert.equal(r.busiestHour, new Date(at(10)).getHours());
  assert.equal(r.templates[0].count, 1);
});

test('empty event has no busiest hour', () => {
  const r = summarizeEvent([], 'e');
  assert.equal(r.rounds, 0);
  assert.equal(r.busiestHour, null);
});
