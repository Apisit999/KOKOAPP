import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type PhotoboothEvent = { id: string; name: string; date: string | null; notes: string; createdAt: string; updatedAt: string };
type EventDocument = { schemaVersion: 1; activeEventId: string | null; events: PhotoboothEvent[] };
const EMPTY: EventDocument = { schemaVersion: 1, activeEventId: null, events: [] };

function validEvent(value: unknown): value is PhotoboothEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === 'string' && EVENT_ID.test(event.id)
    && typeof event.name === 'string' && event.name.length > 0 && event.name.length <= 80
    && (event.date === null || (typeof event.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && Number.isFinite(Date.parse(event.date))))
    && typeof event.notes === 'string' && event.notes.length <= 500
    && typeof event.createdAt === 'string' && Number.isFinite(Date.parse(event.createdAt))
    && typeof event.updatedAt === 'string' && Number.isFinite(Date.parse(event.updatedAt));
}
function validDocument(value: unknown): value is EventDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;
  return document.schemaVersion === 1
    && (document.activeEventId === null || (typeof document.activeEventId === 'string' && EVENT_ID.test(document.activeEventId)))
    && Array.isArray(document.events) && document.events.every(validEvent)
    && new Set(document.events.map(event => event.id)).size === document.events.length
    && (document.activeEventId === null || document.events.some(event => event.id === document.activeEventId));
}

/** Durable local event metadata. Photo files are never moved when an event is selected or removed. */
export class EventStore {
  private readonly filePath: string;
  private document: EventDocument | null = null;

  constructor(userDataPath: string) { this.filePath = path.join(userDataPath, 'events.json'); }

  list(): PhotoboothEvent[] { return this.read().events.map(event => ({ ...event })); }
  active(): PhotoboothEvent | null {
    const document = this.read();
    const event = document.events.find(item => item.id === document.activeEventId);
    return event ? { ...event } : null;
  }
  get(id: string): PhotoboothEvent | null {
    if (!EVENT_ID.test(id)) return null;
    const event = this.read().events.find(item => item.id === id);
    return event ? { ...event } : null;
  }
  create(input: unknown): PhotoboothEvent {
    const values = this.validateInput(input);
    const at = new Date().toISOString();
    const event: PhotoboothEvent = { id: randomUUID(), ...values, createdAt: at, updatedAt: at };
    const document = this.read();
    this.write({ ...document, events: [event, ...document.events] });
    return { ...event };
  }
  update(id: string, input: unknown): PhotoboothEvent {
    if (!EVENT_ID.test(id)) throw new Error('Invalid event ID');
    const values = this.validateInput(input);
    const document = this.read();
    const current = document.events.find(event => event.id === id);
    if (!current) throw new Error('Event was not found');
    const updated = { ...current, ...values, updatedAt: new Date().toISOString() };
    this.write({ ...document, events: document.events.map(event => event.id === id ? updated : event) });
    return { ...updated };
  }
  setActive(id: unknown): PhotoboothEvent | null {
    if (id !== null && (typeof id !== 'string' || !EVENT_ID.test(id))) throw new Error('Invalid event ID');
    const document = this.read();
    if (id !== null && !document.events.some(event => event.id === id)) throw new Error('Event was not found');
    this.write({ ...document, activeEventId: id });
    return id === null ? null : this.get(id as string);
  }
  delete(id: string) {
    if (!EVENT_ID.test(id)) throw new Error('Invalid event ID');
    const document = this.read();
    if (!document.events.some(event => event.id === id)) return false;
    this.write({ schemaVersion: 1, activeEventId: document.activeEventId === id ? null : document.activeEventId, events: document.events.filter(event => event.id !== id) });
    return true;
  }
  private validateInput(input: unknown): Pick<PhotoboothEvent, 'name' | 'date' | 'notes'> {
    if (!input || typeof input !== 'object') throw new Error('Invalid event details');
    const value = input as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const date = value.date === '' || value.date === null ? null : value.date;
    const notes = value.notes === undefined ? '' : value.notes;
    if (!name || name.length > 80 || typeof notes !== 'string' || notes.length > 500
      || !(date === null || (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))))) {
      throw new Error('Enter a valid event name, date, and note');
    }
    return { name, date: date as string | null, notes };
  }
  private read(): EventDocument {
    if (this.document) return this.document;
    if (!existsSync(this.filePath)) return (this.document = { ...EMPTY, events: [] });
    const stat = lstatSync(this.filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Event data file is not safe');
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.filePath, 'utf8')); }
    catch { throw new Error('Event data is damaged; existing data was preserved'); }
    if (!validDocument(value)) throw new Error('Event data is invalid; existing data was preserved');
    return (this.document = value);
  }
  private write(document: EventDocument) {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, JSON.stringify(document), 'utf8'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, this.filePath);
    this.document = document;
  }
}
