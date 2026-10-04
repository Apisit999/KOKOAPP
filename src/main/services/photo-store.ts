import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { jpegDimensions } from './jpeg-image.ts';

export type PhotoRecord = {
  id: string;
  fileName: string;
  mimeType: 'image/jpeg';
  byteLength: number;
  width: number;
  height: number;
  sha256: string;
  savedAt: string;
  eventId?: string;
};
export type PhotoStorageStatus = { configured: boolean; directoryName: string | null; photoCount: number; pendingRecovery: number; needsAttention: boolean };
export type PhotoRecoveryIssue = { kind: 'orphan-photo' | 'incomplete-write' | 'index-temp' | 'missing-photo' | 'invalid-index' | 'storage-unavailable'; id: string | null; token?: string };
export type IndexRecoveryCandidate = { id: string; width: number; height: number; bytes: Uint8Array };
type PhotoIndex = { schemaVersion: 1; photos: PhotoRecord[] };
const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_INDEX: PhotoIndex = { schemaVersion: 1, photos: [] };
function samePath(left: string, right: string) {
  const a = path.resolve(left); const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isPhotoRecord(value: unknown): value is PhotoRecord {
  if (!value || typeof value !== 'object') return false;
  const photo = value as Record<string, unknown>;
  return typeof photo.id === 'string' && PHOTO_ID.test(photo.id)
    && photo.fileName === photo.id + '.jpg' && photo.mimeType === 'image/jpeg'
    && Number.isSafeInteger(photo.byteLength) && (photo.byteLength as number) > 0
    && Number.isSafeInteger(photo.width) && (photo.width as number) > 0
    && Number.isSafeInteger(photo.height) && (photo.height as number) > 0
    && typeof photo.sha256 === 'string' && /^[0-9a-f]{64}$/.test(photo.sha256)
    && (photo.eventId === undefined || (typeof photo.eventId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photo.eventId)))
    && typeof photo.savedAt === 'string' && Number.isFinite(Date.parse(photo.savedAt));
}
function isPhotoIndex(value: unknown): value is PhotoIndex {
  if (!value || typeof value !== 'object') return false;
  const index = value as Record<string, unknown>;
  return index.schemaVersion === 1 && Array.isArray(index.photos) && index.photos.every(isPhotoRecord)
    && new Set(index.photos.map(photo => photo.id)).size === index.photos.length;
}

/** Main-process-only photo store. Renderer never receives a filesystem path. */
export class PhotoStore {
  private readonly root: string;
  private readonly photosDirectory: string;
  private readonly indexPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.root = path.resolve(root);
    this.photosDirectory = path.join(this.root, 'photos');
    this.indexPath = path.join(this.root, 'photo-index.json');
  }

  configure() {
    mkdirSync(this.root, { recursive: true });
    this.assertRootDirectory();
    if (existsSync(this.photosDirectory)) {
      const info = lstatSync(this.photosDirectory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Photo directory must be a regular directory');
    } else mkdirSync(this.photosDirectory);
    const probe = path.join(this.root, '.koko-write-check-' + randomUUID());
    const descriptor = openSync(probe, 'wx', 0o600);
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); unlinkSync(probe); }
    if (!existsSync(this.indexPath)) this.writeIndex(EMPTY_INDEX);
    else this.readIndex();
  }

  saveJpeg(bytes: Uint8Array, width: number, height: number, eventId?: string | null): Promise<PhotoRecord> {
    if (eventId !== undefined && eventId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) throw new Error('Invalid event ID');
    const task = this.writeQueue.then(() => this.saveJpegSerial(bytes, width, height, eventId));
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  listPhotos(offset = 0, limit = 100, eventId?: string | null): PhotoRecord[] {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error('Invalid photo page');
    }
    this.assertPhotoDirectory();
    const photos = this.readIndex().photos.filter(photo => eventId === undefined || (photo.eventId ?? null) === eventId);
    return photos.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(offset, offset + limit);
  }

  countPhotosForEvent(eventId: string): number {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) throw new Error('Invalid event ID');
    if (!existsSync(this.photosDirectory)) return 0;
    this.assertPhotoDirectory();
    return this.readIndex().photos.filter(photo => photo.eventId === eventId).length;
  }

  movePhotoToTrash(id: string, moveToSystemTrash: (photoPath: string) => Promise<void>): Promise<boolean> {
    const task = this.writeQueue.then(() => this.movePhotoToTrashSerial(id, moveToSystemTrash));
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  importOrphan(id: string, width: number, height: number): Promise<PhotoRecord> {
    if (typeof id !== 'string' || !PHOTO_ID.test(id)) throw new Error('Invalid orphan photo ID');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('Invalid orphan photo dimensions');
    const task = this.writeQueue.then(() => {
      this.assertPhotoDirectory();
      const index = this.readIndex();
      if (index.photos.some(photo => photo.id === id)) throw new Error('Photo is already in the local library');
      const fileName = id + '.jpg';
      const filePath = path.join(this.photosDirectory, fileName);
      const info = lstatSync(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 100 * 1024 * 1024) throw new Error('Orphan photo file is unsafe or too large');
      const bytes = readFileSync(filePath);
      const dimensions = jpegDimensions(bytes);
      if (dimensions.width !== width || dimensions.height !== height) throw new Error('Orphan photo dimensions changed during inspection');
      const record: PhotoRecord = {
        id, fileName, mimeType: 'image/jpeg', byteLength: bytes.byteLength, width, height,
        sha256: createHash('sha256').update(bytes).digest('hex'), savedAt: info.mtime.toISOString()
      };
      this.writeIndex({ schemaVersion: 1, photos: [...index.photos, record] });
      return record;
    });
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  quarantineTemporary(kind: 'incomplete-write' | 'index-temp', token: string): Promise<boolean> {
    if (kind === 'incomplete-write' && (typeof token !== 'string' || !PHOTO_ID.test(token))) throw new Error('Invalid temporary photo ID');
    if (kind === 'index-temp' && (typeof token !== 'string' || !PHOTO_ID.test(token))) throw new Error('Invalid temporary index ID');
    const task = this.writeQueue.then(() => {
      this.assertPhotoDirectory();
      const source = kind === 'incomplete-write'
        ? path.join(this.photosDirectory, `.${token}.tmp`)
        : path.join(this.root, `${path.basename(this.indexPath)}.${token}.tmp`);
      const info = lstatSync(source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Recovery item is not a regular file');
      const quarantine = path.join(this.root, 'recovery-quarantine');
      if (existsSync(quarantine)) {
        const directory = lstatSync(quarantine);
        if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Recovery quarantine is not a safe directory');
      } else mkdirSync(quarantine);
      const suffix = kind === 'incomplete-write' ? `${token}.photo.tmp` : `${token}.index.tmp`;
      const destination = path.join(quarantine, `${Date.now()}-${randomUUID()}-${suffix}`);
      renameSync(source, destination);
      return true;
    });
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  previewIndexRecovery(): IndexRecoveryCandidate[] {
    this.assertPhotoDirectory();
    this.requireCorruptIndex();
    const candidates: IndexRecoveryCandidate[] = [];
    let totalBytes = 0;
    for (const name of readdirSync(this.photosDirectory)) {
      if (!name.endsWith('.jpg') || !PHOTO_ID.test(name.slice(0, -4))) continue;
      const info = lstatSync(path.join(this.photosDirectory, name));
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 100 * 1024 * 1024) continue;
      totalBytes += info.size;
      if (candidates.length >= 1000 || totalBytes > 500 * 1024 * 1024) throw new Error('Too many recovery files to rebuild safely; preserve this folder and contact support');
      try {
        const bytes = readFileSync(path.join(this.photosDirectory, name));
        const dimensions = jpegDimensions(bytes);
        candidates.push({ id: name.slice(0, -4), ...dimensions, bytes: new Uint8Array(bytes) });
      } catch { /* Invalid or incomplete JPEGs remain untouched and are excluded. */ }
    }
    return candidates;
  }

  rebuildIndexFromPhotos(validIds: string[]): Promise<number> {
    if (!Array.isArray(validIds) || validIds.length > 1000 || validIds.some(id => typeof id !== 'string' || !PHOTO_ID.test(id)) || new Set(validIds).size !== validIds.length) throw new Error('Invalid recovery selection');
    const accepted = new Set(validIds);
    const task = this.writeQueue.then(() => {
      this.assertPhotoDirectory();
      if (!existsSync(this.indexPath)) throw new Error('Photo index does not exist; rebuild is not safe');
      this.requireCorruptIndex();
      const candidates = this.previewIndexRecovery().filter(candidate => accepted.has(candidate.id));
      if (!candidates.length) throw new Error('No verified JPEGs were selected for recovery');
      const records: PhotoRecord[] = candidates.map(candidate => {
        const filePath = path.join(this.photosDirectory, candidate.id + '.jpg');
        const info = lstatSync(filePath);
        const bytes = readFileSync(filePath);
        const dimensions = jpegDimensions(bytes);
        if (!info.isFile() || info.isSymbolicLink() || dimensions.width !== candidate.width || dimensions.height !== candidate.height) throw new Error('A recovery image changed during the rebuild');
        return {
          id: candidate.id, fileName: candidate.id + '.jpg', mimeType: 'image/jpeg', byteLength: bytes.byteLength,
          width: dimensions.width, height: dimensions.height, sha256: createHash('sha256').update(bytes).digest('hex'),
          savedAt: info.mtime.toISOString()
        };
      });
      const quarantine = path.join(this.root, 'recovery-quarantine');
      if (existsSync(quarantine)) {
        const directory = lstatSync(quarantine);
        if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Recovery quarantine is not a safe directory');
      } else mkdirSync(quarantine);
      const backupPath = path.join(quarantine, `${Date.now()}-${randomUUID()}-photo-index.corrupt.json`);
      renameSync(this.indexPath, backupPath);
      try { this.writeIndex({ schemaVersion: 1, photos: records }); }
      catch (error) {
        if (!existsSync(this.indexPath) && existsSync(backupPath)) renameSync(backupPath, this.indexPath);
        throw error;
      }
      return records.length;
    });
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  readPhoto(id: string): { photo: PhotoRecord; bytes: Uint8Array } {
    if (typeof id !== 'string' || !PHOTO_ID.test(id)) throw new Error('Invalid photo ID');
    this.assertPhotoDirectory();
    const photo = this.readIndex().photos.find(item => item.id === id);
    if (!photo) throw new Error('Photo is not in the local library');
    const filePath = path.join(this.photosDirectory, photo.fileName);
    const fileInfo = lstatSync(filePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size !== photo.byteLength) throw new Error('Photo file is missing or invalid');
    const bytes = readFileSync(filePath);
    if (createHash('sha256').update(bytes).digest('hex') !== photo.sha256) throw new Error('Photo integrity check failed');
    return { photo, bytes: new Uint8Array(bytes) };
  }

  getStatus(configured: boolean): PhotoStorageStatus {
    if (!configured) return { configured: false, directoryName: null, photoCount: 0, pendingRecovery: 0, needsAttention: false };
    try {
      this.assertPhotoDirectory();
      const index = this.readIndex();
      const known = new Set(index.photos.map(photo => photo.fileName));
      const entries = readdirSync(this.photosDirectory);
      const orphanPhotos = entries.filter(name => name.endsWith('.jpg') && PHOTO_ID.test(name.slice(0, -4)) && !known.has(name)).length;
      const incompleteWrites = entries.filter(name => name.startsWith('.') && name.endsWith('.tmp') && PHOTO_ID.test(name.slice(1, -4))).length;
      const indexTemps = readdirSync(this.root).filter(name => name.startsWith(path.basename(this.indexPath) + '.') && name.endsWith('.tmp')).length;
      const pendingRecovery = orphanPhotos + incompleteWrites + indexTemps;
      const missing = index.photos.filter(photo => !existsSync(path.join(this.photosDirectory, photo.fileName))).length;
      return { configured: true, directoryName: path.basename(this.root), photoCount: index.photos.length, pendingRecovery, needsAttention: pendingRecovery > 0 || missing > 0 };
    } catch {
      return { configured: true, directoryName: path.basename(this.root), photoCount: 0, pendingRecovery: 0, needsAttention: true };
    }
  }

  inspectRecovery(): PhotoRecoveryIssue[] {
    try {
      this.assertPhotoDirectory();
      const index = this.readIndex();
      const known = new Set(index.photos.map(photo => photo.fileName));
      const issues: PhotoRecoveryIssue[] = [];
      for (const name of readdirSync(this.photosDirectory)) {
        if (name.endsWith('.jpg') && PHOTO_ID.test(name.slice(0, -4)) && !known.has(name)) {
          issues.push({ kind: 'orphan-photo', id: name.slice(0, -4) });
        } else if (name.startsWith('.') && name.endsWith('.tmp') && PHOTO_ID.test(name.slice(1, -4))) {
          issues.push({ kind: 'incomplete-write', id: name.slice(1, -4), token: name.slice(1, -4) });
        }
      }
      for (const photo of index.photos) {
        const filePath = path.join(this.photosDirectory, photo.fileName);
        try {
          const info = lstatSync(filePath);
          if (!info.isFile() || info.isSymbolicLink() || info.size !== photo.byteLength) issues.push({ kind: 'missing-photo', id: photo.id });
        } catch { issues.push({ kind: 'missing-photo', id: photo.id }); }
      }
      for (const name of readdirSync(this.root)) {
        const prefix = path.basename(this.indexPath) + '.';
        const token = name.startsWith(prefix) && name.endsWith('.tmp') ? name.slice(prefix.length, -4) : '';
        if (PHOTO_ID.test(token)) issues.push({ kind: 'index-temp', id: null, token });
      }
      return issues;
    } catch (error) {
      return [{ kind: error instanceof SyntaxError || (error instanceof Error && error.message.includes('Photo index is invalid')) ? 'invalid-index' : 'storage-unavailable', id: null }];
    }
  }

  private async saveJpegSerial(bytes: Uint8Array, width: number, height: number, eventId?: string | null): Promise<PhotoRecord> {
    this.assertPhotoDirectory();
    const index = this.readIndex();
    const id = randomUUID();
    const fileName = id + '.jpg';
    const finalPath = path.join(this.photosDirectory, fileName);
    let descriptor: number | undefined;
    let createdFile = false;
    try {
      // Exclusive creation prevents a UUID collision from replacing an existing image.
      descriptor = openSync(finalPath, 'wx', 0o600);
      createdFile = true;
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      const record: PhotoRecord = {
        id, fileName, mimeType: 'image/jpeg', byteLength: bytes.byteLength, width, height,
        sha256: createHash('sha256').update(bytes).digest('hex'), savedAt: new Date().toISOString(),
        ...(eventId ? { eventId } : {})
      };
      this.writeIndex({ schemaVersion: 1, photos: [...index.photos, record] });
      return record;
    } catch (error) {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Preserve the original write error. */ } }
      if (createdFile) { try { unlinkSync(finalPath); } catch { /* Recovery status reports an incomplete file. */ } }
      throw error;
    }
  }

  private async movePhotoToTrashSerial(id: string, moveToSystemTrash: (photoPath: string) => Promise<void>): Promise<boolean> {
    if (typeof id !== 'string' || !PHOTO_ID.test(id)) throw new Error('Invalid photo ID');
    this.assertPhotoDirectory();
    const index = this.readIndex();
    const photo = index.photos.find(item => item.id === id);
    if (!photo) return false;
    this.readPhoto(id);
    const photoPath = path.join(this.photosDirectory, photo.fileName);
    this.writeIndex({ schemaVersion: 1, photos: index.photos.filter(item => item.id !== id) });
    try {
      await moveToSystemTrash(photoPath);
      if (existsSync(photoPath)) throw new Error('The operating system did not move the image to Trash');
    } catch (error) {
      if (!existsSync(photoPath)) return true;
      this.writeIndex(index);
      throw error;
    }
    return true;
  }

  private assertPhotoDirectory() {
    this.assertRootDirectory();
    const info = lstatSync(this.photosDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Photo directory is not safe');
    if (!samePath(realpathSync(this.photosDirectory), this.photosDirectory)) throw new Error('Photo directory resolves outside managed storage');
  }

  private assertRootDirectory() {
    const info = lstatSync(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Storage root must be a regular directory');
    if (!samePath(realpathSync(this.root), this.root)) throw new Error('Storage root resolves through a symbolic link');
  }

  private readIndex(): PhotoIndex {
    if (!existsSync(this.indexPath)) return EMPTY_INDEX;
    const indexFile = lstatSync(this.indexPath);
    if (!indexFile.isFile() || indexFile.isSymbolicLink()) throw new Error('Photo index must be a regular file');
    const parsed: unknown = JSON.parse(readFileSync(this.indexPath, 'utf8'));
    if (!isPhotoIndex(parsed)) throw new Error('Photo index is invalid; recovery is required');
    return parsed;
  }

  private requireCorruptIndex() {
    try { this.readIndex(); }
    catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === 'Photo index is invalid; recovery is required')) return;
      throw error;
    }
    throw new Error('Photo index is valid; rebuilding is not required');
  }

  private writeIndex(index: PhotoIndex) {
    const temporaryPath = this.indexPath + '.' + randomUUID() + '.tmp';
    const descriptor = openSync(temporaryPath, 'wx', 0o600);
    try { writeFileSync(descriptor, JSON.stringify(index), 'utf8'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporaryPath, this.indexPath);
  }
}

export function validateStorageRoot(root: unknown): string {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) throw new Error('Invalid storage directory');
  const normalized = path.resolve(root);
  if (normalized === path.parse(normalized).root) throw new Error('Choose a folder below the drive root');
  if (!statSync(normalized).isDirectory() || lstatSync(normalized).isSymbolicLink()) throw new Error('Choose an actual directory');
  return realpathSync(normalized);
}
