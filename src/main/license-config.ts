import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LicenseFeature } from '../shared/license-contract';

/** Public deployment configuration. The private signing key must never reach this process. */
const localDevelopment = !app.isPackaged;
export const LICENSE_API_BASE_URL = process.env.KOKO_LICENSE_API_BASE_URL || (localDevelopment ? 'http://127.0.0.1:8787' : '');
export const PHOTO_CLOUD_PUBLIC_BASE_URL = process.env.KOKO_PHOTO_PUBLIC_BASE_URL || LICENSE_API_BASE_URL;
export const LICENSE_PRODUCT_ID = process.env.KOKO_LICENSE_PRODUCT_ID ?? 'koko-photobooth';
function readTrustedKeys(): Readonly<Record<string, string>> {
  try {
    const value: unknown = JSON.parse(process.env.KOKO_LICENSE_TRUSTED_KEYS_JSON ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value).filter(([key, pem]) => /^[A-Za-z0-9._:-]{1,160}$/.test(key) && typeof pem === 'string' && pem.includes('BEGIN PUBLIC KEY'));
      if (entries.length) return Object.freeze(Object.fromEntries(entries));
    }
  } catch { return Object.freeze({}); }
  if (localDevelopment) {
    try {
      const publicKeyPath = path.join(app.getAppPath(), 'secrets', 'license-public.pem');
      if (existsSync(publicKeyPath)) return Object.freeze({ 'koko-local-dev-1': readFileSync(publicKeyPath, 'utf8') });
    } catch { /* Local license configuration is optional for development. */ }
  }
  return Object.freeze({});
}
export const LICENSE_TRUSTED_KEYS = readTrustedKeys();
export const LICENSE_FEATURES: readonly LicenseFeature[] = ['capture', 'printing', 'templates', 'cloud_sync'];
