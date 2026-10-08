import { createHash } from 'node:crypto';

export type KokoMemoryUploaderConfig = { apiBaseUrl: string; bookingId: string; shareId: string; uploadToken: string };
export type KokoMemoryConnection = KokoMemoryUploaderConfig & { id: string; galleryUrl?: string };
type UploadRequest = { sessionId: string; photoId: string; fileName: string; mimeType: 'image/jpeg'; bytes: Uint8Array };
type ApiJson = { success?: boolean; error?: string; photoId?: string; uploadUrl?: string; alreadyUploaded?: boolean; status?: string };

export class KokoMemoryApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) { super(message); this.status = status; this.retryable = retryable; this.name = 'KokoMemoryApiError'; }
}

export function parseKokoMemoryUploaderConfig(value: unknown): KokoMemoryUploaderConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Uploader configuration is not an object.');
  const input = value as Record<string, unknown>;
  if (typeof input.apiBaseUrl !== 'string' || typeof input.bookingId !== 'string' || typeof input.shareId !== 'string' || typeof input.uploadToken !== 'string') throw new Error('Uploader configuration is missing required fields.');
  const url = new URL(input.apiBaseUrl);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if ((!loopback && url.protocol !== 'https:') || (loopback && !['http:', 'https:'].includes(url.protocol))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('API base URL must be an HTTPS site origin.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.bookingId)) throw new Error('Invalid KOKOMEMORY booking ID.');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(input.shareId)) throw new Error('Invalid KOKOMEMORY album ID.');
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(input.uploadToken)) throw new Error('Invalid KOKOMEMORY uploader token.');
  return { apiBaseUrl: url.origin, bookingId: input.bookingId, shareId: input.shareId, uploadToken: input.uploadToken };
}

export function validateKokoMemoryGalleryUrl(value: string, connection: Pick<KokoMemoryUploaderConfig, 'apiBaseUrl' | 'bookingId'>) {
  const url = new URL(value);
  const base = new URL(connection.apiBaseUrl);
  const expectedPath = `/gallery/${encodeURIComponent(connection.bookingId)}`;
  const guestToken = url.searchParams.get('guestToken') || url.searchParams.get('token') || '';
  if (url.origin !== base.origin || url.pathname !== expectedPath || url.hash || url.username || url.password || guestToken.length < 40 || guestToken.length > 200) throw new Error('Paste the private gallery URL for this booking from KOKOMEMORY.');
  const tokens = [...url.searchParams.keys()].filter(key => key === 'guestToken' || key === 'token');
  if (tokens.length !== 1) throw new Error('Gallery URL must contain exactly one guest token.');
  return url.toString();
}

/** Implements the existing KOKOMEMORY admin gallery upload contract. */
export class KokoMemoryApiClient {
  private readonly request: typeof fetch;
  constructor(request: typeof fetch = fetch) { this.request = request; }

  async uploadPhoto(connection: KokoMemoryConnection, photo: UploadRequest): Promise<{ photoId: string; alreadyUploaded: boolean }> {
    if (photo.bytes.byteLength < 4 || photo.bytes.byteLength > 25 * 1024 * 1024) throw new KokoMemoryApiError('KOKOMEMORY accepts JPEG files up to 25 MB.', 413, false);
    const remotePhotoId = photo.photoId.replaceAll('-', '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(remotePhotoId)) throw new KokoMemoryApiError('Invalid local photo ID.', 400, false);
    const checksum = createHash('sha256').update(photo.bytes).digest('hex');
    const base = connection.apiBaseUrl.replace(/\/+$/, '');
    const path = `/api/admin/gallery/${encodeURIComponent(connection.bookingId)}/uploads`;
    const headers = { Authorization: `Bearer ${connection.uploadToken}`, 'Content-Type': 'application/json' };
    const init = await this.json(`${base}${path}`, {
      method: 'POST', headers,
      body: JSON.stringify({ shareId: connection.shareId, fileName: photo.fileName, contentType: photo.mimeType, size: photo.bytes.byteLength, photoId: remotePhotoId, checksum }),
      redirect: 'error', signal: AbortSignal.timeout(30_000)
    });
    if (init.photoId !== remotePhotoId) throw new KokoMemoryApiError('KOKOMEMORY returned a different photo ID.', 502, false);
    if (init.alreadyUploaded === true) return { photoId: remotePhotoId, alreadyUploaded: true };
    if (typeof init.uploadUrl !== 'string') throw new KokoMemoryApiError('KOKOMEMORY did not return a signed upload URL.', 502, false);
    const uploadUrl = new URL(init.uploadUrl);
    if (uploadUrl.protocol !== 'https:' || !/^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/i.test(uploadUrl.hostname) || uploadUrl.username || uploadUrl.password) throw new KokoMemoryApiError('KOKOMEMORY returned an untrusted storage URL.', 502, false);
    const makeBody = () => { const body = new ArrayBuffer(photo.bytes.byteLength); new Uint8Array(body).set(photo.bytes); return body; };
    let directError: unknown = null;
    try {
      const put = await this.request(uploadUrl.toString(), { method: 'PUT', headers: { 'Content-Type': photo.mimeType }, body: makeBody(), redirect: 'error', signal: AbortSignal.timeout(120_000) });
      if (put.ok) directError = null;
      else directError = new KokoMemoryApiError(`Signed storage upload failed (${put.status}).`, put.status, put.status === 429 || put.status >= 500);
    } catch (error) { directError = error; }
    if (directError) {
      const fallbackPath = `${base}${path}?shareId=${encodeURIComponent(connection.shareId)}&photoId=${encodeURIComponent(remotePhotoId)}`;
      const fallback = await this.request(fallbackPath, {
        method: 'PUT', headers: { Authorization: `Bearer ${connection.uploadToken}`, 'Content-Type': photo.mimeType },
        body: makeBody(), redirect: 'error', signal: AbortSignal.timeout(120_000)
      });
      if (!fallback.ok) throw this.httpError(fallback.status, await this.responseError(fallback));
      return { photoId: remotePhotoId, alreadyUploaded: false };
    }
    await this.json(`${base}${path}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ shareId: connection.shareId, photoId: remotePhotoId }),
      redirect: 'error', signal: AbortSignal.timeout(30_000)
    });
    return { photoId: remotePhotoId, alreadyUploaded: false };
  }

  private async json(url: string, init: RequestInit): Promise<ApiJson> {
    let response: Response;
    try { response = await this.request(url, init); }
    catch { throw new KokoMemoryApiError('Could not connect to KOKOMEMORY. Check the internet connection and retry.', null, true); }
    let value: ApiJson;
    try { value = await response.json() as ApiJson; }
    catch { throw new KokoMemoryApiError('KOKOMEMORY returned an invalid response.', response.status, response.status >= 500); }
    if (!response.ok || value.success !== true) throw this.httpError(response.status, typeof value.error === 'string' ? value.error : 'KOKOMEMORY request failed.');
    return value;
  }

  private async responseError(response: Response) {
    try { const value = await response.json() as ApiJson; return typeof value.error === 'string' ? value.error : 'KOKOMEMORY upload failed.'; }
    catch { return 'KOKOMEMORY upload failed.'; }
  }

  private httpError(status: number, message: string) {
    const safeMessage = status === 401 || status === 403 ? 'KOKOMEMORY rejected this uploader credential.' : status === 413 ? 'This photo exceeds the KOKOMEMORY upload limit.' : `KOKOMEMORY upload request failed (HTTP ${status}).`;
    void message;
    return new KokoMemoryApiError(safeMessage, status, status === 408 || status === 425 || status === 429 || status >= 500);
  }
}
