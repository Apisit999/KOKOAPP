import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LicenseRuntime } from './license-runtime';

type CloudFolderEntry = { sessionId: string; folderId: string; ownerKey: string; shareKey: string; shareUrl: string; uploadedPhotoIds: string[]; uploadedVideoIds: string[]; shareRevoked?: boolean; expiresAt?: string };
type CloudFolderIndex = { schemaVersion: 1; folders: CloudFolderEntry[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validEntry(value: unknown): value is CloudFolderEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sessionId === 'string' && UUID.test(entry.sessionId)
    && typeof entry.folderId === 'string' && UUID.test(entry.folderId)
    && typeof entry.ownerKey === 'string' && /^[A-Za-z0-9_-]{40,128}$/.test(entry.ownerKey)
    && typeof entry.shareKey === 'string' && /^[A-Za-z0-9_-]{40,128}$/.test(entry.shareKey)
    && typeof entry.shareUrl === 'string' && entry.shareUrl.length <= 2048
    && Array.isArray(entry.uploadedPhotoIds) && entry.uploadedPhotoIds.length <= 500
    && entry.uploadedPhotoIds.every(id => typeof id === 'string' && UUID.test(id))
    && (entry.uploadedVideoIds === undefined || (Array.isArray(entry.uploadedVideoIds) && entry.uploadedVideoIds.length <= 500
      && entry.uploadedVideoIds.every(id => typeof id === 'string' && UUID.test(id))));
}

/** Main-process-only storage for private folder credentials and upload progress. */
export class PhotoCloudClient {
  private readonly indexPath: string;
  private readonly licenseRuntime: LicenseRuntime;
  private readonly publicBaseUrl: string;
  private readonly sessionQueues = new Map<string, Promise<unknown>>();

  constructor(userDataPath: string, licenseRuntime: LicenseRuntime, publicBaseUrl: string) {
    this.licenseRuntime = licenseRuntime;
    this.publicBaseUrl = publicBaseUrl;
    this.indexPath = path.join(userDataPath, 'photo-cloud-folders.json');
  }

  createForSession(sessionId: string, label: string): Promise<string> {
    return this.enqueue(sessionId, async () => {
    if (!UUID.test(sessionId)) throw new Error('Invalid capture session ID');
    const index = this.readIndex();
    const existing = index.folders.find(entry => entry.sessionId === sessionId);
    if (existing) {
      if (existing.shareRevoked) throw new Error('This album share link has been revoked');
      return existing.shareUrl;
    }
    const folder = await this.licenseRuntime.createPhotoFolder(label);
    const base = this.publicBaseUrl.replace(/\/+$/, '');
    const shareUrl = `${base}/share#${folder.id}.${folder.shareKey}`;
    index.folders.push({ sessionId, folderId: folder.id, ownerKey: folder.ownerKey, shareKey: folder.shareKey, shareUrl, uploadedPhotoIds: [], uploadedVideoIds: [], expiresAt: folder.expiresAt });
    this.writeIndex(index);
    return shareUrl;
    });
  }

  uploadForSession(sessionId: string, photoId: string, jpegBytes: Uint8Array): Promise<boolean> {
    return this.enqueue(sessionId, async () => {
    if (!UUID.test(sessionId) || !UUID.test(photoId)) throw new Error('Invalid cloud photo identity');
    const index = this.readIndex();
      const folder = index.folders.find(entry => entry.sessionId === sessionId);
      if (!folder) return false;
      if (folder.shareRevoked) throw new Error('This album share link has been revoked');
      if (folder.uploadedPhotoIds.includes(photoId)) return true;
    await this.licenseRuntime.uploadPhoto(folder.folderId, photoId, folder.ownerKey, jpegBytes);
    folder.uploadedPhotoIds.push(photoId);
    this.writeIndex(index);
    return true;
    });
  }

  uploadVideoForSession(sessionId: string, videoId: string, webmBytes: Uint8Array): Promise<boolean> {
    return this.enqueue(sessionId, async () => {
      if (!UUID.test(sessionId) || !UUID.test(videoId)) throw new Error('Invalid cloud video identity');
      const index = this.readIndex();
      const folder = index.folders.find(entry => entry.sessionId === sessionId);
      if (!folder) return false;
      if (folder.shareRevoked) throw new Error('This album share link has been revoked');
      if (folder.uploadedVideoIds.includes(videoId)) return true;
      if (!this.licenseRuntime.uploadVideo) throw new Error('Video cloud upload is not available');
      await this.licenseRuntime.uploadVideo(folder.folderId, videoId, folder.ownerKey, webmBytes);
      folder.uploadedVideoIds.push(videoId);
      this.writeIndex(index);
      return true;
    });
  }

  getShareUrl(sessionId: string): string | null {
    const entry = this.readIndex().folders.find(entry => entry.sessionId === sessionId);
    return entry && !entry.shareRevoked ? entry.shareUrl : null;
  }

  getShareStatus(sessionId: string): { shareUrl: string | null; revoked: boolean; expiresAt: string | null } {
    const entry = this.readIndex().folders.find(item => item.sessionId === sessionId);
    return { shareUrl: entry && !entry.shareRevoked ? entry.shareUrl : null, revoked: Boolean(entry?.shareRevoked), expiresAt: entry?.expiresAt ?? null };
  }

  revokeShareForSession(sessionId: string): Promise<boolean> {
    return this.enqueue(sessionId, async () => {
      const index = this.readIndex();
      const folder = index.folders.find(entry => entry.sessionId === sessionId);
      if (!folder) return false;
      if (folder.shareRevoked) return true;
      if (!this.licenseRuntime.revokePhotoFolderShare) throw new Error('Photo cloud link revocation is not available');
      await this.licenseRuntime.revokePhotoFolderShare(folder.folderId, folder.ownerKey);
      folder.shareRevoked = true;
      this.writeIndex(index);
      return true;
    });
  }

  getUploadedPhotoIds(sessionId: string): string[] {
    return this.readIndex().folders.find(entry => entry.sessionId === sessionId)?.uploadedPhotoIds.slice() ?? [];
  }

  getUploadedVideoIds(sessionId: string): string[] {
    return this.readIndex().folders.find(entry => entry.sessionId === sessionId)?.uploadedVideoIds.slice() ?? [];
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.sessionQueues.set(sessionId, current);
    void current.then(
      () => { if (this.sessionQueues.get(sessionId) === current) this.sessionQueues.delete(sessionId); },
      () => { if (this.sessionQueues.get(sessionId) === current) this.sessionQueues.delete(sessionId); }
    );
    return current;
  }

  private readIndex(): CloudFolderIndex {
    if (!existsSync(this.indexPath)) return { schemaVersion: 1, folders: [] };
    const value: unknown = JSON.parse(readFileSync(this.indexPath, 'utf8'));
    if (!value || typeof value !== 'object') throw new Error('Private photo folder index is invalid');
    const index = value as Record<string, unknown>;
    if (index.schemaVersion !== 1 || !Array.isArray(index.folders) || !index.folders.every(validEntry)
      || new Set(index.folders.map(entry => (entry as CloudFolderEntry).sessionId)).size !== index.folders.length) {
      throw new Error('Private photo folder index is invalid');
    }
    return { schemaVersion: 1, folders: (value as CloudFolderIndex).folders.map(entry => ({ ...entry, uploadedVideoIds: entry.uploadedVideoIds ?? [], shareRevoked: entry.shareRevoked === true })) };
  }

  private writeIndex(index: CloudFolderIndex) {
    mkdirSync(path.dirname(this.indexPath), { recursive: true });
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(index), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.indexPath);
  }
}
