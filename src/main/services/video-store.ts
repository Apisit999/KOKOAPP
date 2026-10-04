import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type VideoRecord = {
  id: string;
  fileName: string;
  mimeType: 'video/webm';
  byteLength: number;
  width: number;
  height: number;
  durationMs: number;
  sha256: string;
  savedAt: string;
  eventId?: string;
};
type VideoIndex = { schemaVersion: 1; videos: VideoRecord[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY: VideoIndex = { schemaVersion: 1, videos: [] };

function validRecord(value: unknown): value is VideoRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && UUID.test(item.id)
    && item.fileName === `${item.id}.webm` && item.mimeType === 'video/webm'
    && Number.isSafeInteger(item.byteLength) && (item.byteLength as number) >= 4 && (item.byteLength as number) <= 100 * 1024 * 1024
    && Number.isSafeInteger(item.width) && (item.width as number) > 0 && (item.width as number) <= 8192
    && Number.isSafeInteger(item.height) && (item.height as number) > 0 && (item.height as number) <= 8192
    && Number.isSafeInteger(item.durationMs) && (item.durationMs as number) >= 500 && (item.durationMs as number) <= 30_000
    && typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256)
    && typeof item.savedAt === 'string' && Number.isFinite(Date.parse(item.savedAt))
    && (item.eventId === undefined || (typeof item.eventId === 'string' && UUID.test(item.eventId)));
}

/** Stores short WebM clips beside the chosen photo library, with atomic files and a checked index. */
export class VideoStore {
  private readonly root: string;
  private readonly directory: string;
  private readonly indexPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.root = path.resolve(root);
    this.directory = path.join(this.root, 'videos');
    this.indexPath = path.join(this.root, 'video-index.json');
  }

  configure() {
    mkdirSync(this.root, { recursive: true });
    const rootInfo = lstatSync(this.root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || realpathSync(this.root) !== this.root) throw new Error('Video storage root is unsafe');
    if (existsSync(this.directory)) {
      const info = lstatSync(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(this.directory) !== this.directory) throw new Error('Video directory is unsafe');
    } else mkdirSync(this.directory);
    if (!existsSync(this.indexPath)) this.writeIndex(EMPTY);
    else {
      const info = lstatSync(this.indexPath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Video index is unsafe');
      this.readIndex();
    }
  }

  saveWebm(bytes: Uint8Array, width: number, height: number, durationMs: number, eventId: string | null): Promise<VideoRecord> {
    const task = this.writeQueue.then(() => this.saveSerial(bytes, width, height, durationMs, eventId));
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  list(offset = 0, limit = 100, eventId?: string | null): VideoRecord[] {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid video page');
    this.configure();
    const videos = this.readIndex().videos.filter(item => eventId === undefined || (item.eventId ?? null) === eventId);
    return videos.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(offset, offset + limit);
  }

  read(id: string): { video: VideoRecord; bytes: Uint8Array } {
    if (!UUID.test(id)) throw new Error('Invalid video ID');
    this.configure();
    const video = this.readIndex().videos.find(item => item.id === id);
    if (!video) throw new Error('Video is not in the local library');
    const filePath = path.join(this.directory, video.fileName);
    const info = lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== video.byteLength) throw new Error('Video file is missing or invalid');
    const bytes = readFileSync(filePath);
    if (createHash('sha256').update(bytes).digest('hex') !== video.sha256) throw new Error('Video integrity check failed');
    return { video, bytes: new Uint8Array(bytes) };
  }

  private async saveSerial(bytes: Uint8Array, width: number, height: number, durationMs: number, eventId: string | null): Promise<VideoRecord> {
    this.configure();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4 || bytes.byteLength > 100 * 1024 * 1024
      || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) throw new Error('Invalid WebM video');
    if (!Number.isSafeInteger(width) || width < 1 || width > 8192 || !Number.isSafeInteger(height) || height < 1 || height > 8192) throw new Error('Invalid video dimensions');
    if (!Number.isSafeInteger(durationMs) || durationMs < 500 || durationMs > 30_000) throw new Error('Video must be 0.5 to 30 seconds long');
    if (eventId !== null && !UUID.test(eventId)) throw new Error('Invalid event ID');
    const index = this.readIndex();
    const id = randomUUID();
    const fileName = `${id}.webm`;
    const filePath = path.join(this.directory, fileName);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(filePath, 'wx', 0o600);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      const video: VideoRecord = {
        id, fileName, mimeType: 'video/webm', byteLength: bytes.byteLength, width, height, durationMs,
        sha256: createHash('sha256').update(bytes).digest('hex'), savedAt: new Date().toISOString(), ...(eventId ? { eventId } : {})
      };
      this.writeIndex({ schemaVersion: 1, videos: [...index.videos, video] });
      return video;
    } catch (error) {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Keep the original error. */ } }
      try { unlinkSync(filePath); } catch { /* A leftover is never treated as indexed media. */ }
      throw error;
    }
  }

  private readIndex(): VideoIndex {
    const value: unknown = JSON.parse(readFileSync(this.indexPath, 'utf8'));
    if (!value || typeof value !== 'object') throw new Error('Video index is invalid');
    const index = value as Record<string, unknown>;
    if (index.schemaVersion !== 1 || !Array.isArray(index.videos) || !index.videos.every(validRecord)
      || new Set(index.videos.map(item => item.id)).size !== index.videos.length) throw new Error('Video index is invalid');
    return index as VideoIndex;
  }

  private writeIndex(index: VideoIndex) {
    mkdirSync(this.root, { recursive: true });
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(index), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.indexPath);
    try { const directory = openSync(this.root, 'r'); try { fsyncSync(directory); } finally { closeSync(directory); } }
    catch { /* Some Windows filesystems do not allow directory fsync. */ }
  }
}
