import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PhotoRecord } from './photo-store';

type WatchState = { schemaVersion: 1; processed: string[] };
export type PhotoFolderWatchStatus = { enabled: boolean; folderPath: string | null; importedCount: number; lastError: string | null };
const EMPTY: WatchState = { schemaVersion: 1, processed: [] };
const MAX_PROCESSED_FILES = 100_000;
const MAX_PHOTO_BYTES = 100 * 1024 * 1024;

/** Polls a user-selected camera export folder and imports stable JPEGs without moving source files. */
export class PhotoFolderWatcher {
  private readonly stateFile: string;
  private readonly importJpeg: (bytes: Uint8Array, sourceKey: string) => Promise<PhotoRecord>;
  private readonly onImported?: (name: string, photo: PhotoRecord) => void;
  private folderPath: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private importedCount = 0;
  private dirtyCount = 0;
  private lastError: string | null = null;
  private stable = new Map<string, number>();
  private failedAt = new Map<string, number>();
  private readonly processed: Set<string>;

  constructor(userDataPath: string, importJpeg: (bytes: Uint8Array, sourceKey: string) => Promise<PhotoRecord>, onImported?: (name: string, photo: PhotoRecord) => void) {
    this.stateFile = path.join(userDataPath, 'camera-folder-imports.json');
    this.importJpeg = importJpeg;
    this.onImported = onImported;
    this.processed = new Set(this.readState().processed);
  }

  start(folderPath: string) {
    if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('Choose a valid camera folder');
    const resolved = path.resolve(folderPath);
    const directory = lstatSync(resolved);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Camera folder must be a regular directory');
    this.stop();
    this.folderPath = resolved;
    this.lastError = null;
    this.timer = setInterval(() => { void this.scan(); }, 1500);
    this.timer.unref?.();
    return this.status();
  }

  scanNow() { return this.scan(); }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.folderPath = null;
    this.stable.clear();
    this.failedAt.clear();
    if (this.dirtyCount) {
      try { this.writeState(); } catch (error) { this.lastError = error instanceof Error ? error.message : 'Could not save camera import history'; }
    }
    return this.status();
  }

  status(): PhotoFolderWatchStatus { return { enabled: this.timer !== null, folderPath: this.folderPath, importedCount: this.importedCount, lastError: this.lastError }; }

  private async scan() {
    if (this.scanning || !this.folderPath) return;
    this.scanning = true;
    try {
      const folder = this.folderPath;
      const candidates = (await fs.readdir(folder, { withFileTypes: true })).filter(entry => entry.isFile() && /\.jpe?g$/i.test(entry.name));
      const activeCandidateKeys = new Set<string>();
      let importedThisScan = 0;
      for (const entry of candidates) {
        if (folder !== this.folderPath) return;
        const filePath = path.join(folder, entry.name);
        const before = await fs.lstat(filePath);
        if (!before.isFile() || before.isSymbolicLink() || before.size < 4 || before.size > MAX_PHOTO_BYTES) continue;
        const candidateKey = `${process.platform === 'win32' ? filePath.toLowerCase() : filePath}|${before.size}|${before.mtimeMs}`;
        activeCandidateKeys.add(candidateKey);
        const failedAt = this.failedAt.get(candidateKey);
        if (failedAt && Date.now() - failedAt < 10_000) continue;
        const seen = (this.stable.get(candidateKey) ?? 0) + 1;
        this.stable.set(candidateKey, seen);
        if (seen < 2) continue;
        const bytes = await fs.readFile(filePath);
        const after = await fs.lstat(filePath);
        if (!after.isFile() || after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.byteLength !== after.size) { this.stable.delete(candidateKey); continue; }
        if (folder !== this.folderPath) return;
        const signature = createHash('sha256').update(`${process.platform === 'win32' ? filePath.toLowerCase() : filePath}\0`).update(bytes).digest('hex');
        if (this.processed.has(signature)) { this.stable.delete(candidateKey); continue; }
        try {
          const photo = await this.importJpeg(bytes, signature);
          this.processed.add(signature);
          this.dirtyCount++;
          this.stable.delete(candidateKey);
          this.failedAt.delete(candidateKey);
          this.importedCount++;
          this.lastError = null;
          if (this.dirtyCount >= 20) this.writeState();
          this.onImported?.(entry.name, photo);
          importedThisScan++;
          if (importedThisScan >= 20) break;
        } catch (error) {
          this.failedAt.set(candidateKey, Date.now());
          this.lastError = error instanceof Error ? error.message : 'Could not import a camera photo';
        }
      }
      for (const key of this.stable.keys()) if (!activeCandidateKeys.has(key)) this.stable.delete(key);
      for (const key of this.failedAt.keys()) if (!activeCandidateKeys.has(key)) this.failedAt.delete(key);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Could not read the camera folder';
    } finally { this.scanning = false; }
  }

  private readState(): WatchState {
    if (!existsSync(this.stateFile)) return EMPTY;
    const value: unknown = JSON.parse(readFileSync(this.stateFile, 'utf8'));
    if (!value || typeof value !== 'object') throw new Error('Camera import history is invalid; automatic import was stopped to prevent duplicates.');
    const state = value as Record<string, unknown>;
    if (state.schemaVersion !== 1 || !Array.isArray(state.processed) || state.processed.length > MAX_PROCESSED_FILES || !state.processed.every(item => typeof item === 'string' && item.length <= 2048)) throw new Error('Camera import history is invalid; automatic import was stopped to prevent duplicates.');
    return state as WatchState;
  }

  private writeState() {
    mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const processed = [...this.processed].slice(-MAX_PROCESSED_FILES);
    const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, processed }), 'utf8'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, this.stateFile);
    this.dirtyCount = 0;
  }
}
