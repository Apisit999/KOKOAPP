import { verify as verifySignature } from 'node:crypto';
import type { EntitlementClaims, LicenseFeature, LicenseState } from '../../shared/license-contract';

const FEATURES = new Set<LicenseFeature>(['capture', 'printing', 'templates', 'cloud_sync']);
const ID = /^[A-Za-z0-9._:-]{1,160}$/;

export type LicenseVerification = {
  state: LicenseState;
  claims: EntitlementClaims | null;
  reason: 'valid' | 'offline-grace' | 'malformed' | 'unknown-key' | 'bad-signature' | 'wrong-device' | 'wrong-product' | 'not-started' | 'expired' | 'offline-window-ended' | 'clock-rollback';
};

function decodeBytes(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Malformed JWS segment');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Malformed JWS encoding');
  return bytes;
}

function decodeJson(value: string): unknown {
  return JSON.parse(decodeBytes(value).toString('utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validClaims(value: unknown): value is EntitlementClaims {
  if (!isRecord(value)) return false;
  const validShape = value.schemaVersion === 1
    && typeof value.keyId === 'string' && ID.test(value.keyId)
    && typeof value.licenseId === 'string' && ID.test(value.licenseId)
    && typeof value.deviceId === 'string' && ID.test(value.deviceId)
    && typeof value.productId === 'string' && ID.test(value.productId)
    && validDate(value.issuedAt) && validDate(value.startsAt)
    && (value.expiresAt === null || validDate(value.expiresAt))
    && validDate(value.refreshAfter) && validDate(value.offlineUntil)
    && Array.isArray(value.features) && value.features.every(feature => typeof feature === 'string' && FEATURES.has(feature as LicenseFeature))
    && new Set(value.features).size === value.features.length;
  if (!validShape) return false;
  const claims = value as unknown as EntitlementClaims;
  return Date.parse(claims.refreshAfter) >= Date.parse(claims.issuedAt)
    && Date.parse(claims.offlineUntil) >= Date.parse(claims.refreshAfter)
    && (claims.expiresAt === null || (Date.parse(claims.expiresAt) > Date.parse(claims.startsAt) && Date.parse(claims.offlineUntil) <= Date.parse(claims.expiresAt)));
}

/** Verify a compact RS256 JWS using only application trusted public keys. */
export function verifyEntitlement(
  token: string,
  trustedKeys: Readonly<Record<string, string>>,
  expected: { deviceId: string; productId: string; now?: number; offline: boolean }
): LicenseVerification {
  const invalid = (reason: LicenseVerification['reason'], state: LicenseState = 'server_error'): LicenseVerification => ({ state, claims: null, reason });
  if (typeof token !== 'string' || token.length > 16_384) return invalid('malformed');
  const parts = token.split('.');
  if (parts.length !== 3) return invalid('malformed');
  let header: unknown;
  let claims: unknown;
  let signature: Buffer;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
    signature = decodeBytes(parts[2]);
  } catch { return invalid('malformed'); }
  if (!isRecord(header) || header.alg !== 'RS256' || typeof header.kid !== 'string' || !ID.test(header.kid)) return invalid('malformed');
  const publicKey = trustedKeys[header.kid];
  if (!publicKey) return invalid('unknown-key');
  let signed: boolean;
  try { signed = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), publicKey, signature); }
  catch { return invalid('unknown-key'); }
  if (!signed) return invalid('bad-signature');
  if (!validClaims(claims)) return invalid('malformed');
  if (claims.keyId !== header.kid) return invalid('malformed');
  if (claims.deviceId !== expected.deviceId) return invalid('wrong-device');
  if (claims.productId !== expected.productId) return invalid('wrong-product');

  const now = expected.now ?? Date.now();
  if (now + 5 * 60_000 < Date.parse(claims.issuedAt)) return invalid('clock-rollback');
  if (now < Date.parse(claims.startsAt)) return invalid('not-started', 'unauthenticated');
  if (claims.expiresAt !== null && now >= Date.parse(claims.expiresAt)) return invalid('expired', 'expired');
  if (expected.offline && now > Date.parse(claims.offlineUntil)) return invalid('offline-window-ended', 'server_error');
  if (expected.offline && now > Date.parse(claims.refreshAfter)) return { state: 'offline_grace', claims, reason: 'offline-grace' };
  return { state: 'active', claims, reason: 'valid' };
}
