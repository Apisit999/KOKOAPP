import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';
export type FontRecord = { id: string; name: string; fileName: string; format: FontFormat; byteLength: number; addedAt: string };
type FontIndex = { schemaVersion: 1; fonts: FontRecord[] };

export const MAX_FONT_BYTES = 3 * 1024 * 1024;
export const MAX_FONTS = 30;
export const FONT_ID = /^[0-9a-f]{32}$/;

/** Recognises the four web-usable font containers from their first bytes; anything else is rejected. */
export function detectFontFormat(bytes: Uint8Array): FontFormat | null {
  if (bytes.length < 12) return null;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if ((bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || tag === 'true') return 'ttf';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  return null;
}

/** A display name taken from the file name: no folders, no extension, no control characters. */
export function fontNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 60) || 'Font';
}

/** Stores fonts the operator imports (for template text). Files are kept by content hash so the same font is never stored twice. */
export class FontStore {
  private readonly indexPath: string;
  private readonly directory: string;
  private readonly now: () => Date;
  constructor(directory: string, now: () => Date = () => new Date()) {
    this.directory = directory; this.now = now;
    this.indexPath = path.join(directory, 'font-index.json');
  }

  list(): FontRecord[] { return this.readIndex().fonts; }

  add(bytes: Uint8Array, fileName: string): FontRecord {
    if (bytes.length > MAX_FONT_BYTES) throw new Error('Font file is larger than 3 MB.');
    const format = detectFontFormat(bytes);
    if (!format) throw new Error('This is not a TrueType, OpenType, WOFF or WOFF2 font file.');
    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    const index = this.readIndex();
    const existing = index.fonts.find(font => font.id === id);
    if (existing) return existing;
    if (index.fonts.length >= MAX_FONTS) throw new Error(`Up to ${MAX_FONTS} fonts can be stored. Remove one first.`);
    mkdirSync(this.directory, { recursive: true });
    const stored = `${id}.${format}`;
    writeFileSync(path.join(this.directory, stored), bytes, { flag: 'wx', mode: 0o600 });
    const record: FontRecord = { id, name: fontNameFromFile(fileName), fileName: stored, format, byteLength: bytes.length, addedAt: this.now().toISOString() };
    try { this.writeIndex({ schemaVersion: 1, fonts: [...index.fonts, record] }); }
    catch (error) { try { unlinkSync(path.join(this.directory, stored)); } catch { /* Nothing more to clean up. */ } throw error; }
    return record;
  }

  read(id: string): { record: FontRecord; bytes: Uint8Array } {
    if (!FONT_ID.test(id)) throw new Error('Invalid font ID');
    const record = this.readIndex().fonts.find(font => font.id === id);
    if (!record) throw new Error('Font not found');
    return { record, bytes: new Uint8Array(readFileSync(path.join(this.directory, record.fileName))) };
  }

  remove(id: string): boolean {
    if (!FONT_ID.test(id)) throw new Error('Invalid font ID');
    const index = this.readIndex();
    const record = index.fonts.find(font => font.id === id);
    if (!record) return false;
    this.writeIndex({ schemaVersion: 1, fonts: index.fonts.filter(font => font.id !== id) });
    try { unlinkSync(path.join(this.directory, record.fileName)); } catch { /* An orphan file is harmless; it is no longer listed. */ }
    return true;
  }

  private readIndex(): FontIndex {
    if (!existsSync(this.indexPath)) return { schemaVersion: 1, fonts: [] };
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.indexPath, 'utf8')); } catch { throw new Error('Font index is damaged; existing files were preserved.'); }
    const fonts = (value as { fonts?: unknown } | null)?.fonts;
    if (!value || (value as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray(fonts)) throw new Error('Font index is invalid; existing files were preserved.');
    return { schemaVersion: 1, fonts: fonts.filter((item): item is FontRecord => Boolean(item && typeof item === 'object'
      && FONT_ID.test((item as FontRecord).id) && typeof (item as FontRecord).name === 'string'
      && ['ttf', 'otf', 'woff', 'woff2'].includes((item as FontRecord).format)
      && (item as FontRecord).fileName === `${(item as FontRecord).id}.${(item as FontRecord).format}`
      && Number.isSafeInteger((item as FontRecord).byteLength) && typeof (item as FontRecord).addedAt === 'string')) };
  }

  private writeIndex(index: FontIndex) {
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.indexPath}.${createHash('sha1').update(String(Math.random())).digest('hex').slice(0, 12)}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(index), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
    catch (error) { try { unlinkSync(temporary); } catch { /* Never created. */ } throw error; }
    renameSync(temporary, this.indexPath);
  }
}
