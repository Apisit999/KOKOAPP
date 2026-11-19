const assert = require('node:assert/strict');
const { test } = require('node:test');
const { filterSessions } = require('../src/shared/session-search.ts');

const sessions = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', eventId: 'e1', status: 'confirmed', createdAt: '2026-11-19T18:05:00Z', template: { name: 'Strip 2x6' } },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', eventId: 'e2', status: 'retaken', createdAt: '2026-11-19T18:20:00Z', template: { name: 'Polaroid' } },
  { id: 'cccccccc-0000-4000-8000-000000000003', eventId: null, status: 'confirmed', createdAt: '2026-11-20T09:00:00Z', template: null },
];
const base = { query: '', status: 'all', shortCodes: { [sessions[0].id]: 'K7QM4XPA', [sessions[1].id]: 'ABCD2345' }, eventNames: { e1: 'Wedding Mali', e2: 'Birthday Nok' }, formatDate: iso => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) };
const ids = result => result.map(item => item.id[0]);

test('session search: no query and status "all" keeps everything in order', () => {
  assert.deepEqual(ids(filterSessions(sessions, base)), ['a', 'b', 'c']);
});

test('session search: a short code is found however a guest writes it (spaces, dashes, lower case)', () => {
  for (const query of ['K7QM4XPA', 'k7qm 4xpa', 'K7QM-4XPA', '4xp']) assert.deepEqual(ids(filterSessions(sessions, { ...base, query })), ['a'], query);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, query: 'ZZZZ' })), []);
});

test('session search: event name, template name, date and session id start all match, in any case', () => {
  assert.deepEqual(ids(filterSessions(sessions, { ...base, query: 'wedding' })), ['a']);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, query: 'POLAROID' })), ['b']);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, query: '2026-11-20' })), ['c']);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, query: 'bbbbbbbb' })), ['b']);
});

test('session search: several words must all match, and the status filter combines with the query', () => {
  assert.deepEqual(ids(filterSessions(sessions, { ...base, query: 'wedding strip' })), ['a']);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, query: 'wedding polaroid' })), []);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, status: 'confirmed' })), ['a', 'c']);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, status: 'confirmed', query: '2026-11-19' })), ['a']);
  assert.deepEqual(ids(filterSessions(sessions, { ...base, status: 'cancelled' })), []);
});
