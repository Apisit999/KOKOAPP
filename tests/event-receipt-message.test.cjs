const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { EventStore } = require('../src/main/services/event-store.ts');

test('events: the receipt message is optional, trimmed, limited to one line of 80 characters, and survives an update', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'koko-events-'));
  const store = new EventStore(dir);
  assert.equal(store.create({ name: 'A', date: null, notes: '' }).receiptMessage, '', 'older callers without the field still work');
  const event = store.create({ name: 'B', date: '2026-12-01', notes: '', receiptMessage: '  ขอบคุณที่มาร่วมงาน  ' });
  assert.equal(event.receiptMessage, 'ขอบคุณที่มาร่วมงาน');
  assert.equal(store.update(event.id, { name: 'B2', date: '2026-12-01', notes: '', receiptMessage: 'Thanks!' }).receiptMessage, 'Thanks!');
  assert.equal(new EventStore(dir).get(event.id).receiptMessage, 'Thanks!', 'saved to disk');
  assert.throws(() => store.create({ name: 'C', date: null, notes: '', receiptMessage: 'x'.repeat(81) }), /80 characters/);
  assert.throws(() => store.create({ name: 'C', date: null, notes: '', receiptMessage: 'line one\nline two' }), /one line/);
});

test('events: a file written before the message existed still loads', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'koko-events-'));
  const id = '11111111-1111-4111-8111-111111111111';
  writeFileSync(path.join(dir, 'events.json'), JSON.stringify({ schemaVersion: 1, activeEventId: id, events: [{ id, name: 'Old', date: null, notes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] }));
  const store = new EventStore(dir);
  assert.equal(store.active().name, 'Old');
  assert.equal(store.active().receiptMessage, undefined);
});
