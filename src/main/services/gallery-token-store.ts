import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

type Entry = { token: string; sessionId: string; createdAt: number; expiresAt: number };
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;
const MAX_ENTRIES = 50_000;

/** Unguessable per-round tokens for the guest gallery; persisted so a printed QR keeps working after a restart. */
export class GalleryTokenStore {
  private readonly file: string;
  private readonly now: () => number;
  private entries: Entry[];

  constructor(dir: string, now: () => number = Date.now) {
    this.file = path.join(dir, 'gallery-tokens.json');
    this.now = now;
    this.entries = this.read();
  }

  /** Returns the live token for a round, creating one if needed. */
  forSession(sessionId: string, ttlMs: number): string {
    const existing = this.entries.find(entry => entry.sessionId === sessionId && entry.expiresAt > this.now());
    if (existing) return existing.token;
    const created = this.now();
    const entry: Entry = { token: randomBytes(18).toString('base64url'), sessionId, createdAt: created, expiresAt: created + ttlMs };
    this.entries = [...this.entries.filter(item => item.expiresAt > created), entry].slice(-MAX_ENTRIES);
    this.write();
    return entry.token;
  }

  /** The round a token opens, or null when unknown, expired or revoked. */
  resolve(token: string): { sessionId: string; expiresAt: number } | null {
    if (!TOKEN.test(token)) return null;
    const entry = this.entries.find(item => item.token === token);
    return entry && entry.expiresAt > this.now() ? { sessionId: entry.sessionId, expiresAt: entry.expiresAt } : null;
  }

  revokeSession(sessionId: string) {
    const before = this.entries.length;
    this.entries = this.entries.filter(entry => entry.sessionId !== sessionId);
    if (this.entries.length !== before) this.write();
  }

  private read(): Entry[] {
    if (!existsSync(this.file)) return [];
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      const list = value && typeof value === 'object' ? (value as { entries?: unknown }).entries : null;
      if (!Array.isArray(list)) return [];
      return list.filter((item): item is Entry => !!item && typeof item === 'object'
        && typeof (item as Entry).token === 'string' && TOKEN.test((item as Entry).token)
        && typeof (item as Entry).sessionId === 'string' && Number.isFinite((item as Entry).expiresAt) && Number.isFinite((item as Entry).createdAt));
    } catch { return []; }
  }

  private write() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, JSON.stringify({ version: 1, entries: this.entries }), 'utf8'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, this.file);
  }
}
