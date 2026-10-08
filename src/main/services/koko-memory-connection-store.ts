import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseKokoMemoryUploaderConfig, validateKokoMemoryGalleryUrl, type KokoMemoryConnection } from './koko-memory-client.ts';

type EncryptedConnection = { id: string; encrypted: string };
type Vault = { schemaVersion: 1; activeId: string | null; connections: EncryptedConnection[] };
export type SecretBox = { encrypt(value: string): string; decrypt(value: string): string };
const EMPTY: Vault = { schemaVersion: 1, activeId: null, connections: [] };

/** Stores album uploader credentials only as OS-encrypted ciphertext on disk. */
export class KokoMemoryConnectionStore {
  private readonly filePath: string;
  private readonly box: SecretBox;
  constructor(userDataPath: string, box: SecretBox) { this.filePath = path.join(userDataPath, 'kokomemory-connections.json'); this.box = box; }

  importUploaderConfig(json: string) {
    if (typeof json !== 'string' || json.length > 16_000) throw new Error('Uploader configuration must be smaller than 16 KB.');
    let input: unknown;
    try { input = JSON.parse(json); } catch { throw new Error('Uploader configuration is not valid JSON.'); }
    const config = parseKokoMemoryUploaderConfig(input);
    const id = createHash('sha256').update(`${config.apiBaseUrl}\0${config.bookingId}\0${config.shareId}`).digest('hex');
    const vault = this.read();
    const previous = vault.connections.find(item => item.id === id);
    const previousValue = previous ? this.decryptEntry(previous) : null;
    const connection: KokoMemoryConnection = { ...config, id, ...(previousValue?.galleryUrl ? { galleryUrl: previousValue.galleryUrl } : {}) };
    const encrypted = this.box.encrypt(JSON.stringify(connection));
    const entry = { id, encrypted: Buffer.from(encrypted, 'utf8').toString('base64') };
    const connections = vault.connections.filter(item => item.id !== id);
    connections.push(entry);
    this.write({ schemaVersion: 1, activeId: id, connections });
    return this.getStatus();
  }

  setActiveGalleryUrl(value: string) {
    const vault = this.read();
    if (!vault.activeId) throw new Error('Import a KOKOMEMORY uploader configuration first.');
    const entry = vault.connections.find(item => item.id === vault.activeId);
    if (!entry) throw new Error('KOKOMEMORY connection is missing.');
    const connection = this.decryptEntry(entry);
    const galleryUrl = value.trim() ? validateKokoMemoryGalleryUrl(value.trim(), connection) : undefined;
    const updated: KokoMemoryConnection = { ...connection };
    delete updated.galleryUrl;
    if (galleryUrl) updated.galleryUrl = galleryUrl;
    const encrypted = this.box.encrypt(JSON.stringify(updated));
    this.write({ ...vault, connections: vault.connections.map(item => item.id === entry.id ? { id: entry.id, encrypted: Buffer.from(encrypted, 'utf8').toString('base64') } : item) });
    return this.getStatus();
  }

  getActive(): KokoMemoryConnection | null {
    const vault = this.read();
    if (!vault.activeId) return null;
    const entry = vault.connections.find(item => item.id === vault.activeId);
    if (!entry) throw new Error('KOKOMEMORY active connection is invalid.');
    return this.decryptEntry(entry);
  }

  getById(id: string): KokoMemoryConnection | null {
    const entry = this.read().connections.find(item => item.id === id);
    return entry ? this.decryptEntry(entry) : null;
  }

  getStatus() {
    const connection = this.getActive();
    if (!connection) return { configured: false, bookingId: null, shareId: null, apiOrigin: null, galleryUrl: null, connectionId: null };
    return { configured: true, bookingId: connection.bookingId, shareId: connection.shareId, apiOrigin: new URL(connection.apiBaseUrl).origin, galleryUrl: connection.galleryUrl ?? null, connectionId: connection.id };
  }

  clearActive() {
    const vault = this.read();
    this.write({ ...vault, activeId: null });
    return this.getStatus();
  }

  private decryptEntry(entry: EncryptedConnection): KokoMemoryConnection {
    let value: unknown;
    try { value = JSON.parse(this.box.decrypt(Buffer.from(entry.encrypted, 'base64').toString('utf8'))); }
    catch { throw new Error('Could not decrypt the KOKOMEMORY credential on this Windows account. Import the uploader config again.'); }
    if (!value || typeof value !== 'object') throw new Error('Encrypted KOKOMEMORY connection is invalid.');
    const connection = value as Record<string, unknown>;
    const config = parseKokoMemoryUploaderConfig(connection);
    const expectedId = createHash('sha256').update(`${config.apiBaseUrl}\0${config.bookingId}\0${config.shareId}`).digest('hex');
    if (expectedId !== entry.id || connection.id !== entry.id) throw new Error('Encrypted KOKOMEMORY connection identity does not match.');
    const result: KokoMemoryConnection = { ...config, id: entry.id };
    if (typeof connection.galleryUrl === 'string') result.galleryUrl = validateKokoMemoryGalleryUrl(connection.galleryUrl, config);
    return result;
  }

  private read(): Vault {
    if (!existsSync(this.filePath)) return EMPTY;
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.filePath, 'utf8')); } catch { throw new Error('KOKOMEMORY credential vault is invalid; existing data was preserved.'); }
    if (!value || typeof value !== 'object') throw new Error('KOKOMEMORY credential vault is invalid; existing data was preserved.');
    const vault = value as Record<string, unknown>;
    const validConnections = Array.isArray(vault.connections) && vault.connections.length <= 50 && vault.connections.every(entry => {
      if (!entry || typeof entry !== 'object') return false;
      const item = entry as Record<string, unknown>;
      return typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id)
        && typeof item.encrypted === 'string' && item.encrypted.length > 0 && item.encrypted.length <= 32_000 && /^[A-Za-z0-9+/]+=*$/.test(item.encrypted);
    });
    if (vault.schemaVersion !== 1 || !validConnections || (vault.activeId !== null && typeof vault.activeId !== 'string')) throw new Error('KOKOMEMORY credential vault is invalid; existing data was preserved.');
    const connections = vault.connections as EncryptedConnection[];
    if ((vault.activeId !== null && !connections.some(item => item.id === vault.activeId)) || new Set(connections.map(item => item.id)).size !== connections.length) throw new Error('KOKOMEMORY credential vault is invalid; existing data was preserved.');
    return vault as unknown as Vault;
  }

  private write(vault: Vault) {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, JSON.stringify(vault), 'utf8'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, this.filePath);
  }
}
