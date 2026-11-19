import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Calls the KOKO Studio website. The license runtime adds device id, product id and the signed entitlement. */
export type StudioCloudApi = { call(route: string, payload: Record<string, unknown>): Promise<unknown> };
export type StudioUpload = (url: string, bytes: Uint8Array) => Promise<void>;
export type StudioCloudPhoto = { id: string; bytes: Uint8Array };
/**
 * token / registered: a link made on this PC (works offline). The server learns it on the next upload of the session.
 * shortCode / eventUrl: printed under the QR for guests who cannot scan; known only after registration.
 */
export type StudioShare = { url: string; expiresAt: string; revoked: boolean; token?: string; registered?: boolean; shortCode?: string; eventUrl?: string };
/** cloudReady: this booth has reached the customer's cloud at least once, so links made offline will work. */
type Index = { schemaVersion: 1; events: Record<string, string>; uploaded: string[]; shares: Record<string, StudioShare>; cloudReady?: boolean };
const SESSION_LINK_DAYS = 30;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_CLOUD_PHOTO_BYTES = 25 * 1024 * 1024;
const HEX32 = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Server answers that retrying cannot fix; the caller should stop and show a message instead of looping. */
export const PERMANENT_CLOUD_CODES = ['quota_exceeded', 'cloud_unavailable', 'account_link_required', 'revoked', 'expired', 'device_limit', 'event_archived', 'photo_conflict', 'session_conflict'];
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
  private readonly webOrigin: string | null;
  /** webOrigin is the website guests open (the license API base URL); without it links always come from the server. */
  constructor(userDataPath: string, api: StudioCloudApi, upload: StudioUpload, clock: () => number = Date.now, webOrigin: string | null = null) {
    this.api = api; this.upload = upload; this.clock = clock;
    this.webOrigin = webOrigin && safeLink(webOrigin) ? webOrigin.replace(/\/+$/, '') : null;
    this.indexPath = path.join(userDataPath, 'studio-cloud-index.json');
  }

  /** Runs sessions one at a time so two triggers for the same session cannot upload the same photo twice. */
  uploadSession(input: { sessionId: string; eventId: string | null; eventName: string; date?: string | null; photos: StudioCloudPhoto[] }): Promise<{ uploaded: number; skipped: number }> {
    const run = this.queue.catch(() => undefined).then(() => this.run(input));
    this.queue = run;
    return run;
  }

  isUploaded(photoId: string) { return this.read().uploaded.includes(photoId.replace(/-/g, '')); }

  /**
   * Sessions that still have work for the cloud: a photo that was never confirmed, or a link made on this PC that the server
   * has not been told about yet. Reads the index once, so it is cheap to ask every minute even with hundreds of sessions.
   */
  pendingSessionIds(sessions: Array<{ id: string; photoIds: string[]; compositionPhotoId?: string }>): string[] {
    const index = this.read();
    const uploaded = new Set(index.uploaded);
    return sessions.filter(session => {
      const photoIds = [...session.photoIds, ...(session.compositionPhotoId ? [session.compositionPhotoId] : [])];
      if (photoIds.some(id => !uploaded.has(id.replace(/-/g, '')))) return true;
      const share = index.shares[session.id];
      return Boolean(share?.token && !share.registered && !share.revoked);
    }).map(session => session.id);
  }

  /** For the status card: how much is still waiting for the cloud. cloudUsed is false for booths that never reached it, so the card stays quiet for them. */
  pendingSummary(sessions: Array<{ id: string; photoIds: string[]; compositionPhotoId?: string }>): { cloudUsed: boolean; sessions: number; photos: number; unregisteredLinks: number } {
    const index = this.read();
    const uploaded = new Set(index.uploaded);
    let waitingSessions = 0, photos = 0, unregisteredLinks = 0;
    for (const session of sessions) {
      const missing = [...session.photoIds, ...(session.compositionPhotoId ? [session.compositionPhotoId] : [])].filter(id => !uploaded.has(id.replace(/-/g, ''))).length;
      const share = index.shares[session.id];
      const link = Boolean(share?.token && !share.registered && !share.revoked);
      if (missing || link) waitingSessions++;
      photos += missing;
      if (link) unregisteredLinks++;
    }
    return { cloudUsed: index.cloudReady === true, sessions: waitingSessions, photos, unregisteredLinks };
  }

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
      // A link made here keeps its token for good; the server cannot issue a replacement for it.
      if (saved?.token) return saved;
      if (saved && Date.parse(saved.expiresAt) > this.clock() + 60_000) return saved;
      const index = this.read();
      if (this.webOrigin && index.cloudReady) {
        // Made on this PC with no network: the QR can print straight away, even when the internet is down.
        const token = randomBytes(32).toString('base64url');
        const share: StudioShare = { url: `${this.webOrigin}/s/${token}?openExternalBrowser=1`, expiresAt: new Date(this.clock() + SESSION_LINK_DAYS * 86_400_000).toISOString(), revoked: false, token, registered: false };
        this.write({ ...index, shares: { ...index.shares, [sessionId]: share } });
        return share;
      }
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
      if (!saved.revoked && !(saved.token && !saved.registered)) await this.send('/v1/desktop/cloud/shares/revoke', { sessionId });
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
    if (!pending.length) {
      // Everything is up already, but a link made here after the upload still has to be registered.
      const known = index.events[clientEventId];
      if (known) await this.registerLocalShare(input.sessionId, known, input.photos.length);
      return { uploaded: 0, skipped: input.photos.length };
    }
    let serverEventId = index.events[clientEventId];
    if (!serverEventId) {
      const created = await this.send('/v1/desktop/cloud/events', { clientEventId, name: (input.eventName || 'KOKO event').slice(0, 120), date: input.date ?? null });
      if (!isObject(created) || typeof created.eventId !== 'string' || !HEX32.test(created.eventId)) throw new StudioCloudError('bad_response', false);
      serverEventId = created.eventId;
      index = { ...this.read(), events: { ...this.read().events, [clientEventId]: serverEventId } };
      this.write(index);
    }
    if (!index.cloudReady) { index = { ...this.read(), cloudReady: true }; this.write(index); }
    await this.registerLocalShare(input.sessionId, serverEventId, input.photos.length);
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

  /** Tells the server about a link made on this PC, before its photos, so the guest page can show "uploading 1/4". */
  private async registerLocalShare(sessionId: string, eventId: string, expectedCount: number) {
    const saved = this.read().shares[sessionId];
    if (!saved?.token || saved.registered || saved.revoked) return;
    const made = await this.send('/v1/desktop/cloud/sessions', { sessionId, eventId, token: saved.token, expectedCount: Math.min(expectedCount, 100) });
    if (!isObject(made) || typeof made.shortCode !== 'string' || !/^[2-9A-HJ-NP-Z]{8}$/.test(made.shortCode) || typeof made.expiresAt !== 'string' || !Number.isFinite(Date.parse(made.expiresAt))
      || typeof made.eventUrl !== 'string' || !safeLink(made.eventUrl)) throw new StudioCloudError('bad_response', false);
    const current = this.read();
    const latest = current.shares[sessionId];
    if (!latest || latest.token !== saved.token) return;
    this.write({ ...current, shares: { ...current.shares, [sessionId]: { ...latest, registered: true, shortCode: made.shortCode, eventUrl: made.eventUrl, expiresAt: made.expiresAt } } });
  }

  /** A link made here is dropped when the account turns out to have no cloud; it was never shown as working. */
  forgetUnregisteredShare(sessionId: string) {
    const current = this.read();
    const saved = current.shares[sessionId];
    if (!saved?.token || saved.registered) return;
    const shares = { ...current.shares }; delete shares[sessionId];
    this.write({ ...current, shares, cloudReady: false });
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
    if (!isObject(shares) || !Object.values(shares).every(entry => isObject(entry) && typeof entry.url === 'string' && safeLink(entry.url) && typeof entry.expiresAt === 'string' && typeof entry.revoked === 'boolean'
      && (entry.token === undefined || (typeof entry.token === 'string' && TOKEN.test(entry.token))))) throw new Error('Cloud upload index is invalid; existing data was preserved.');
    return { schemaVersion: 1, events: value.events as Record<string, string>, uploaded: value.uploaded as string[], shares: shares as Record<string, StudioShare>, cloudReady: value.cloudReady === true };
  }
  private write(index: Index) {
    mkdirSync(path.dirname(this.indexPath), { recursive: true });
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(index), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.indexPath);
  }
}
