import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Calls the KOKO Studio website. The license runtime adds device id, product id and the signed entitlement. */
export type StudioCloudApi = { call(route: string, payload: Record<string, unknown>): Promise<unknown> };
export type StudioUpload = (url: string, bytes: Uint8Array) => Promise<void>;
export type StudioCloudPhoto = { id: string; bytes: Uint8Array };
export type StudioShare = { url: string; expiresAt: string; revoked: boolean };
type Index = { schemaVersion: 1; events: Record<string, string>; uploaded: string[]; shares: Record<string, StudioShare> };
export const MAX_CLOUD_PHOTO_BYTES = 25 * 1024 * 1024;
const HEX32 = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Server answers that retrying cannot fix; the caller should stop and show a message instead of looping. */
export const PERMANENT_CLOUD_CODES = ['quota_exceeded', 'cloud_unavailable', 'account_link_required', 'revoked', 'expired', 'device_limit', 'event_archived', 'photo_conflict'];
export class StudioCloudError extends Error {
  readonly code: string;
  readonly permanent: boolean;
  constructor(code: string, permanent: boolean) { super(code); this.code = code; this.permanent = permanent; }
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
/** Guest links must be https; plain http is accepted only for a local development website. */
function safeLink(value: string) {
  if (value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)); } catch { return false; }
}

/**
 * Sends captured photos to the customer's account: one event per booth event, photos deduplicated by id.
 * Photos always stay on this PC first; a failed upload is safe to repeat and never counts twice on the server.
 */
export class StudioCloudClient {
  private readonly indexPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly api: StudioCloudApi;
  private readonly upload: StudioUpload;
  private readonly clock: () => number;
  constructor(userDataPath: string, api: StudioCloudApi, upload: StudioUpload, clock: () => number = Date.now) {
    this.api = api; this.upload = upload; this.clock = clock;
    this.indexPath = path.join(userDataPath, 'studio-cloud-index.json');
  }

  /** Runs sessions one at a time so two triggers for the same session cannot upload the same photo twice. */
  uploadSession(input: { sessionId: string; eventId: string | null; eventName: string; date?: string | null; photos: StudioCloudPhoto[] }): Promise<{ uploaded: number; skipped: number }> {
    const run = this.queue.catch(() => undefined).then(() => this.run(input));
    this.queue = run;
    return run;
  }

  isUploaded(photoId: string) { return this.read().uploaded.includes(photoId.replace(/-/g, '')); }

  /** The saved guest link of a session, or null. A cancelled link is returned with revoked=true so it is never re-issued silently. */
  getShare(sessionId: string): StudioShare | null { return this.read().shares[sessionId] ?? null; }

  /**
   * Creates (or returns the saved) link a guest scans to see only this session's photos.
   * After the link was cancelled this returns null: the booth never hands out a new link on its own.
   */
  ensureShare(sessionId: string): Promise<StudioShare | null> {
    const run = this.queue.catch(() => undefined).then(async () => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw new Error('Invalid capture session ID');
      const saved = this.read().shares[sessionId];
      if (saved?.revoked) return null;
      if (saved && Date.parse(saved.expiresAt) > this.clock() + 60_000) return saved;
      const made = await this.send('/v1/desktop/cloud/shares', { sessionId });
      if (!isObject(made) || typeof made.url !== 'string' || typeof made.expiresAt !== 'string' || !Number.isFinite(Date.parse(made.expiresAt)) || !safeLink(made.url)) throw new StudioCloudError('bad_response', false);
      const share: StudioShare = { url: made.url, expiresAt: made.expiresAt, revoked: false };
      const current = this.read();
      this.write({ ...current, shares: { ...current.shares, [sessionId]: share } });
      return share;
    });
    this.queue = run;
    return run;
  }

  /** Cancels the guest link on the server first; only then is it marked cancelled here, so a failed call can be retried. */
  revokeShare(sessionId: string): Promise<boolean> {
    const run = this.queue.catch(() => undefined).then(async () => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw new Error('Invalid capture session ID');
      const saved = this.read().shares[sessionId];
      if (!saved) return false;
      if (!saved.revoked) await this.send('/v1/desktop/cloud/shares/revoke', { sessionId });
      const current = this.read();
      this.write({ ...current, shares: { ...current.shares, [sessionId]: { ...saved, revoked: true } } });
      return true;
    });
    this.queue = run;
    return run;
  }

  private async run(input: { sessionId: string; eventId: string | null; eventName: string; date?: string | null; photos: StudioCloudPhoto[] }) {
    if (!UUID.test(input.sessionId)) throw new Error('Invalid capture session ID');
    const clientEventId = input.eventId && /^[A-Za-z0-9_-]{8,64}$/.test(input.eventId) ? input.eventId : `session-${input.sessionId}`;
    let index = this.read();
    const pending = input.photos.filter(photo => !index.uploaded.includes(photo.id.replace(/-/g, '')));
    if (!pending.length) return { uploaded: 0, skipped: input.photos.length };
    let serverEventId = index.events[clientEventId];
    if (!serverEventId) {
      const created = await this.send('/v1/desktop/cloud/events', { clientEventId, name: (input.eventName || 'KOKO event').slice(0, 120), date: input.date ?? null });
      if (!isObject(created) || typeof created.eventId !== 'string' || !HEX32.test(created.eventId)) throw new StudioCloudError('bad_response', false);
      serverEventId = created.eventId;
      index = { ...this.read(), events: { ...this.read().events, [clientEventId]: serverEventId } };
      this.write(index);
    }
    let uploaded = 0;
    for (const photo of pending) {
      const photoId = photo.id.replace(/-/g, '');
      if (!HEX32.test(photoId) || photo.bytes.byteLength < 1 || photo.bytes.byteLength > MAX_CLOUD_PHOTO_BYTES) throw new StudioCloudError('invalid_photo', true);
      const init = await this.send('/v1/desktop/cloud/photos/init', {
        eventId: serverEventId, photoId, size: photo.bytes.byteLength, sha256: createHash('sha256').update(photo.bytes).digest('hex'), sessionId: input.sessionId
      });
      if (!isObject(init)) throw new StudioCloudError('bad_response', false);
      if (init.alreadyUploaded !== true) {
        if (typeof init.uploadUrl !== 'string' || !init.uploadUrl.startsWith('https://')) throw new StudioCloudError('bad_response', false);
        await this.upload(init.uploadUrl, photo.bytes);
        await this.send('/v1/desktop/cloud/photos/confirm', { photoId });
      }
      // Recorded only after the server confirmed it, so a crash in between just repeats a harmless init.
      const current = this.read();
      if (!current.uploaded.includes(photoId)) this.write({ ...current, uploaded: [...current.uploaded, photoId] });
      uploaded += 1;
    }
    return { uploaded, skipped: input.photos.length - pending.length };
  }

  private async send(route: string, payload: Record<string, unknown>) {
    try { return await this.api.call(route, payload); }
    catch (error) {
      if (error instanceof StudioCloudError) throw error;
      throw new StudioCloudError(error instanceof Error ? error.message : 'network_error', false);
    }
  }

  private read(): Index {
    if (!existsSync(this.indexPath)) return { schemaVersion: 1, events: {}, uploaded: [], shares: {} };
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.indexPath, 'utf8')); } catch { throw new Error('Cloud upload index is damaged; existing data was preserved.'); }
    if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.events) || !Array.isArray(value.uploaded)
      || !value.uploaded.every(id => typeof id === 'string' && HEX32.test(id))
      || !Object.values(value.events).every(id => typeof id === 'string' && HEX32.test(id))) throw new Error('Cloud upload index is invalid; existing data was preserved.');
    // Index files written before share links existed have no "shares" yet.
    const shares = value.shares === undefined ? {} : value.shares;
    if (!isObject(shares) || !Object.values(shares).every(entry => isObject(entry) && typeof entry.url === 'string' && safeLink(entry.url) && typeof entry.expiresAt === 'string' && typeof entry.revoked === 'boolean')) throw new Error('Cloud upload index is invalid; existing data was preserved.');
    return { schemaVersion: 1, events: value.events as Record<string, string>, uploaded: value.uploaded as string[], shares: shares as Record<string, StudioShare> };
  }
  private write(index: Index) {
    mkdirSync(path.dirname(this.indexPath), { recursive: true });
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(index), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.indexPath);
  }
}
