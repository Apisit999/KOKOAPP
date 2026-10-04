import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LicenseFeature, LicenseSnapshot, LicenseState, Plan } from '../../shared/license-contract';
import { verifyEntitlement } from './license-verifier.ts';

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type RuntimeOptions = {
  userDataPath: string;
  apiBaseUrl: string;
  productId: string;
  trustedKeys: Readonly<Record<string, string>>;
  fetcher?: Fetcher;
  now?: () => number;
};
export type CloudPhotoFolder = { id: string; ownerKey: string; shareKey: string; label: string; createdAt: string; expiresAt: string };

const FAILED: LicenseSnapshot = { state: 'server_error', checkedAt: null, expiresAt: null, offlineUntil: null, features: [] };
const SERVER_STATES = new Set<LicenseState>(['revoked', 'device_limit', 'expired']);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class LicenseRuntime {
  private readonly options: RuntimeOptions;
  private readonly deviceIdPath: string;
  private readonly entitlementPath: string;
  private readonly lastObservedPath: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private deviceIdCache: string | null = null;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.deviceIdPath = path.join(options.userDataPath, 'license-device.json');
    this.entitlementPath = path.join(options.userDataPath, 'license-entitlement.json');
    this.lastObservedPath = path.join(options.userDataPath, 'license-last-observed.json');
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
  }

  isConfigured() {
    if (!this.options.apiBaseUrl || Object.keys(this.options.trustedKeys).length === 0) return false;
    try {
      const url = new URL(this.options.apiBaseUrl);
      return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch { return false; }
  }

  async getStatus(): Promise<LicenseSnapshot> {
    if (!this.isConfigured()) return FAILED;
    let token: string;
    try { token = this.readToken(); } catch { return FAILED; }
    if (!token) return { ...FAILED, state: 'unauthenticated', checkedAt: new Date(this.now()).toISOString() };
    let lastObserved: number | null;
    try { lastObserved = this.readLastObserved(); } catch { return FAILED; }
    const currentTime = this.now();
    if (lastObserved !== null && currentTime + 5 * 60_000 < lastObserved) return FAILED;
    const local = this.verifyLocal(token);
    if (local.state === 'expired') {
      try { this.writeLastObserved(Math.max(currentTime, lastObserved ?? currentTime)); } catch { return FAILED; }
      return this.snapshot('expired', local.claims?.features ?? [], local.claims?.expiresAt ?? null, local.claims?.offlineUntil ?? null);
    }
    if (local.state === 'server_error' && local.reason !== 'offline-window-ended') return FAILED;
    if (local.reason === 'offline-window-ended') {
      try { this.writeLastObserved(Math.max(currentTime, lastObserved ?? currentTime)); } catch { return FAILED; }
      return FAILED;
    }
    try { this.writeLastObserved(Math.max(currentTime, lastObserved ?? currentTime)); } catch { return FAILED; }

    try {
      const response = await this.request('/v1/desktop/leases/refresh', {
        method: 'POST', body: JSON.stringify({ deviceId: this.getDeviceId(), productId: this.options.productId, entitlement: token })
      });
      const body: unknown = await this.readJson(response);
      if (!isObject(body)) return this.fromLocal(local);
      if (typeof body.state === 'string' && SERVER_STATES.has(body.state as LicenseState)) {
        return this.snapshot(body.state as LicenseState, [], local.claims?.expiresAt ?? null, local.claims?.offlineUntil ?? null);
      }
      if (!response.ok) return response.status >= 500 || response.status === 429 ? this.fromLocal(local) : FAILED;
      if (typeof body.entitlement !== 'string') return this.fromLocal(local);
      const refreshed = this.verifyToken(body.entitlement, false);
      if (refreshed.state !== 'active' || !refreshed.claims) return this.fromLocal(local);
      this.writeToken(body.entitlement);
      return this.fromVerification(refreshed);
    } catch { return this.fromLocal(local); }
  }

  async activate(licenseKey: string): Promise<LicenseSnapshot> {
    if (!this.isConfigured()) throw new Error('License service is not configured');
    if (typeof licenseKey !== 'string' || licenseKey.trim().length < 8 || licenseKey.length > 256) throw new Error('Enter a valid license key');
    const response = await this.request('/v1/desktop/licenses/activate', {
      method: 'POST', body: JSON.stringify({
        licenseKey: licenseKey.trim(), deviceId: this.getDeviceId(), productId: this.options.productId, idempotencyKey: randomUUID()
      })
    });
    let body: unknown;
    try { body = await this.readJson(response); } catch { throw new Error('License server returned an invalid response'); }
    if (!isObject(body)) throw new Error('License server returned an invalid response');
    if (body.code === 'device_limit') throw new Error('This license has reached its device limit');
    if (body.code === 'expired') throw new Error('This license has expired');
    if (body.code === 'revoked') throw new Error('This license has been revoked');
    if (!response.ok || typeof body.entitlement !== 'string') throw new Error('License activation could not be verified by the server');
    const result = this.verifyToken(body.entitlement, false);
    if (result.state !== 'active' || !result.claims) throw new Error('Server entitlement signature or device binding is invalid');
    this.writeToken(body.entitlement);
    this.writeLastObserved(this.now());
    return this.fromVerification(result);
  }

  async getPlans(): Promise<Plan[]> {
    if (!this.isConfigured()) return [];
    const response = await this.request('/v1/desktop/plans', { method: 'GET' });
    const body: unknown = await this.readJson(response);
    if (!response.ok || !isObject(body) || !Array.isArray(body.plans)) throw new Error('License plans are unavailable');
    return body.plans.filter((plan): plan is Plan => isObject(plan)
      && typeof plan.id === 'string' && typeof plan.name === 'string'
      && Number.isInteger(plan.version) && ['month', 'year', 'lifetime'].includes(String(plan.billingPeriod))
      && Number.isSafeInteger(plan.amountMinor) && typeof plan.currency === 'string'
      && Number.isSafeInteger(plan.deviceLimit) && Array.isArray(plan.features)
      && (plan.photoRetentionDays === undefined || (typeof plan.photoRetentionDays === 'number' && Number.isInteger(plan.photoRetentionDays) && plan.photoRetentionDays >= 1 && plan.photoRetentionDays <= 3650))
      && (plan.photoStorageQuotaBytes === undefined || (typeof plan.photoStorageQuotaBytes === 'number' && Number.isSafeInteger(plan.photoStorageQuotaBytes) && plan.photoStorageQuotaBytes >= 1048576 && plan.photoStorageQuotaBytes <= 1099511627776))
      && plan.features.every(feature => ['capture', 'printing', 'templates', 'cloud_sync'].includes(String(feature))));
  }

  async createPhotoFolder(label: string): Promise<CloudPhotoFolder> {
    if (!this.isConfigured()) throw new Error('Photo cloud service is not configured');
    const status = await this.getStatus();
    if (status.state !== 'active') throw new Error('An active license is required to create a private photo folder');
    const token = this.readToken();
    const response = await this.request('/v1/desktop/photo-folders', {
      method: 'POST', body: JSON.stringify({ deviceId: this.getDeviceId(), productId: this.options.productId, entitlement: token, label })
    });
    const body: unknown = await this.readJson(response);
    if (!response.ok || !isObject(body)
      || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)
      || typeof body.ownerKey !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(body.ownerKey)
      || typeof body.shareKey !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(body.shareKey)
      || typeof body.label !== 'string' || typeof body.createdAt !== 'string' || !Number.isFinite(Date.parse(body.createdAt))
      || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.parse(body.createdAt)) {
      throw new Error('The photo cloud could not create a private folder');
    }
    return { id: body.id, ownerKey: body.ownerKey, shareKey: body.shareKey, label: body.label, createdAt: body.createdAt, expiresAt: body.expiresAt };
  }

  async uploadPhoto(folderId: string, photoId: string, ownerKey: string, jpegBytes: Uint8Array): Promise<void> {
    if (!this.isConfigured()) throw new Error('Photo cloud service is not configured');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(folderId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)
      || typeof ownerKey !== 'string' || ownerKey.length < 40 || ownerKey.length > 128) throw new Error('Invalid private photo upload credentials');
    const response = await this.request(`/v1/desktop/photo-folders/${folderId}/photos/${photoId}`, {
      method: 'PUT', body: Buffer.from(jpegBytes),
      headers: { authorization: `Bearer ${ownerKey}`, 'content-type': 'image/jpeg' }
    });
    const body: unknown = await this.readJson(response);
    if (!response.ok || !isObject(body) || body.id !== photoId) throw new Error('Photo cloud upload failed');
  }

  async uploadVideo(folderId: string, videoId: string, ownerKey: string, webmBytes: Uint8Array): Promise<void> {
    if (!this.isConfigured()) throw new Error('Photo cloud service is not configured');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(folderId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)
      || typeof ownerKey !== 'string' || ownerKey.length < 40 || ownerKey.length > 128) throw new Error('Invalid private video upload credentials');
    if (!(webmBytes instanceof Uint8Array) || webmBytes.byteLength < 4 || webmBytes.byteLength > 100 * 1024 * 1024
      || webmBytes[0] !== 0x1a || webmBytes[1] !== 0x45 || webmBytes[2] !== 0xdf || webmBytes[3] !== 0xa3) throw new Error('Invalid WebM video');
    const response = await this.request(`/v1/desktop/photo-folders/${folderId}/videos/${videoId}`, {
      method: 'PUT', body: Buffer.from(webmBytes),
      headers: { authorization: `Bearer ${ownerKey}`, 'content-type': 'video/webm' }
    });
    const body: unknown = await this.readJson(response);
    if (!response.ok || !isObject(body) || body.id !== videoId) throw new Error('Video cloud upload failed');
  }

  async revokePhotoFolderShare(folderId: string, ownerKey: string): Promise<void> {
    if (!this.isConfigured()) throw new Error('Photo cloud service is not configured');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(folderId)
      || typeof ownerKey !== 'string' || ownerKey.length < 40 || ownerKey.length > 128) throw new Error('Invalid private photo folder credentials');
    const response = await this.request(`/v1/desktop/photo-folders/${folderId}/revoke`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerKey}` }
    });
    const body: unknown = await this.readJson(response);
    if (!response.ok || !isObject(body) || body.ok !== true) throw new Error('Photo cloud could not revoke the private link');
  }

  async deactivate(): Promise<boolean> {
    if (!this.isConfigured()) throw new Error('License service is not configured');
    const token = this.readToken();
    if (!token) return false;
    const response = await this.request('/v1/desktop/licenses/deactivate', {
      method: 'POST', body: JSON.stringify({ deviceId: this.getDeviceId(), productId: this.options.productId, entitlement: token, idempotencyKey: randomUUID() })
    });
    const body: unknown = await this.readJson(response);
    if (!response.ok || !isObject(body) || body.ok !== true) throw new Error('The license server could not deactivate this device');
    try { unlinkSync(this.entitlementPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return true;
  }

  async assertFeature(feature: LicenseFeature): Promise<void> {
    const status = await this.getStatus();
    if ((status.state !== 'active' && status.state !== 'offline_grace') || !status.features.includes(feature)) {
      throw new Error(`License does not allow ${feature}`);
    }
  }

  private verifyLocal(token: string) {
    return this.verifyToken(token, true);
  }

  private verifyToken(token: string, offline: boolean) {
    return verifyEntitlement(token, this.options.trustedKeys, {
      deviceId: this.getDeviceId(), productId: this.options.productId, now: this.now(), offline
    });
  }

  private fromLocal(result: ReturnType<typeof verifyEntitlement>): LicenseSnapshot {
    if (result.state !== 'active' && result.state !== 'offline_grace') return FAILED;
    return this.fromVerification(result);
  }

  private fromVerification(result: ReturnType<typeof verifyEntitlement>): LicenseSnapshot {
    if (!result.claims) return FAILED;
    return this.snapshot(result.state, result.claims.features, result.claims.expiresAt, result.claims.offlineUntil);
  }

  private snapshot(state: LicenseState, features: LicenseFeature[], expiresAt: string | null, offlineUntil: string | null): LicenseSnapshot {
    return { state, checkedAt: new Date(this.now()).toISOString(), expiresAt, offlineUntil, features };
  }

  private request(route: string, init: RequestInit) {
    const base = this.options.apiBaseUrl.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    return this.fetcher(`${base}${route}`, {
      ...init, signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...init.headers }
    }).finally(() => clearTimeout(timeout));
  }

  private async readJson(response: Response): Promise<unknown> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > 24_000) throw new Error('License response is too large');
    if (!response.body) throw new Error('License response is empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 24_000) { await reader.cancel(); throw new Error('License response is too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }

  private getDeviceId(): string {
    if (this.deviceIdCache) return this.deviceIdCache;
    mkdirSync(this.options.userDataPath, { recursive: true });
    try {
      const value: unknown = JSON.parse(readFileSync(this.deviceIdPath, 'utf8'));
      if (isObject(value) && typeof value.deviceId === 'string' && /^[0-9a-f-]{36}$/i.test(value.deviceId)) {
        this.deviceIdCache = value.deviceId;
        return value.deviceId;
      }
    } catch { /* Create a new device identity when none exists. */ }
    const deviceId = randomUUID();
    const temporary = `${this.deviceIdPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ deviceId }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.deviceIdPath);
    this.deviceIdCache = deviceId;
    return deviceId;
  }

  private readToken(): string {
    if (!existsSync(this.entitlementPath)) return '';
    const value: unknown = JSON.parse(readFileSync(this.entitlementPath, 'utf8'));
    if (!isObject(value) || typeof value.token !== 'string' || value.token.length > 16_384) throw new Error('Invalid local entitlement file');
    return value.token;
  }

  private readLastObserved(): number | null {
    if (!existsSync(this.lastObservedPath)) return null;
    const value: unknown = JSON.parse(readFileSync(this.lastObservedPath, 'utf8'));
    if (!isObject(value) || !Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0) throw new Error('Invalid license clock watermark');
    return value.timestamp as number;
  }

  private writeLastObserved(timestamp: number) {
    mkdirSync(this.options.userDataPath, { recursive: true });
    const temporary = `${this.lastObservedPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ timestamp }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.lastObservedPath);
  }

  private writeToken(token: string) {
    mkdirSync(this.options.userDataPath, { recursive: true });
    const temporary = `${this.entitlementPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ token }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.entitlementPath);
  }
}
