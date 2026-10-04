/** Client/server boundary for licensing. These types do not grant access on their own. */
export type LicenseState =
  | 'loading'
  | 'unauthenticated'
  | 'unlicensed'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'device_limit'
  | 'offline_grace'
  | 'server_error';

export type LicenseFeature = 'capture' | 'printing' | 'templates' | 'cloud_sync';

export type Plan = {
  id: string;
  version: number;
  name: string;
  billingPeriod: 'month' | 'year' | 'lifetime';
  amountMinor: number;
  currency: string;
  deviceLimit: number;
  features: LicenseFeature[];
  photoRetentionDays?: number;
  photoStorageQuotaBytes?: number;
};

/** Claims carried by a compact JWS signed by the licensing server. */
export type EntitlementClaims = {
  schemaVersion: 1;
  keyId: string;
  licenseId: string;
  deviceId: string;
  productId: string;
  issuedAt: string;
  startsAt: string;
  expiresAt: string | null;
  refreshAfter: string;
  offlineUntil: string;
  features: LicenseFeature[];
};
/** Server-issued compact JWS; the private signing key never leaves the server. */
export type SignedEntitlement = string;

export type LicenseSnapshot = {
  state: LicenseState;
  checkedAt: string | null;
  expiresAt: string | null;
  offlineUntil: string | null;
  features: LicenseFeature[];
};

/**
 * Contract only. A production implementation must use an authenticated HTTPS API,
 * verify server-signed entitlements in Electron Main, and never infer payment from
 * a checkout redirect or renderer/local storage.
 */
export interface LicenseBackend {
  getSnapshot(): Promise<LicenseSnapshot>;
  login(input: { email: string; password: string }): Promise<void>;
  register(input: { email: string; password: string }): Promise<void>;
  listPlans(): Promise<Plan[]>;
  beginCheckout(input: { planId: string; idempotencyKey: string }): Promise<{ checkoutUrl: string }>;
  activate(input: { licenseKey: string; idempotencyKey: string }): Promise<SignedEntitlement>;
  deactivateDevice(input: { deviceId: string; idempotencyKey: string }): Promise<void>;
}
