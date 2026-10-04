# KOKO Desktop License API Contract

Status: client contract implemented; no production API, public signing key, or payment provider is configured in this repository.

## Desktop configuration

Set `LICENSE_API_BASE_URL` to the production HTTPS origin, set `LICENSE_TRUSTED_KEYS` to a key ID to PEM public-key map, and keep `LICENSE_PRODUCT_ID` aligned with the server product. These values are public configuration. Never put a signing private key, payment secret, or provider API key in this repository or Desktop build. Use a different trusted public key for staging and production where practical.

The Desktop persists a random installation ID and the signed entitlement in the OS user data directory. The installation ID is not a secret. The entitlement is accepted only after RS256 signature, key ID, product ID, installation ID, feature list, and date checks pass in Electron Main. Local files and Renderer state cannot grant features by themselves.

## Endpoints

All requests use HTTPS JSON, a bounded request timeout, and a server generated decision. The server must authorize every operation and rate limit license-key attempts.

### Activate

`POST /v1/desktop/licenses/activate`

Request:

```json
{
  "licenseKey": "customer supplied key",
  "deviceId": "desktop installation UUID",
  "productId": "koko-photobooth",
  "idempotencyKey": "random request UUID"
}
```

Successful response:

```json
{ "entitlement": "base64url-header.base64url-claims.base64url-signature" }
```

Error response uses a stable `code`: `invalid_license`, `expired`, `revoked`, `device_limit`, `rate_limited`, or `server_error`. A success redirect or payment page is never evidence of activation. The license service issues the entitlement only after its own purchase/administrator policy confirms the right to use the product.

### Refresh

`POST /v1/desktop/leases/refresh`

Request contains `deviceId`, `productId`, and the current signed `entitlement`. A normal response contains a newly signed `entitlement`. A terminal response may contain `{ "state": "revoked" }`, `{ "state": "device_limit" }`, or `{ "state": "expired" }`. The server checks current payment/renewal status, device activation, and revocation before signing a replacement.

## Photo storage policy

`GET /v1/desktop/plans` includes `photoRetentionDays` and `photoStorageQuotaBytes`. `POST /v1/desktop/photo-folders` binds each new album to the verified license and uses its plan's retention setting. Photo and video uploads are checked against aggregate bytes stored in all non-expired albums for that license; per-album limits still apply.

Administrators may update plan policy with `PUT /v1/admin/plans/{planId}/photo-policy` and the admin bearer token:

```json
{ "retentionDays": 90, "storageQuotaBytes": 5368709120 }
```

The endpoint accepts 1–3650 retention days and 1 MiB–1 TiB of storage. Quota applies immediately to every license on that plan. Retention applies to albums created after the update; an album retains its creation-time expiry.

## Entitlement claims

The RS256 JWS protected header contains `alg: RS256` and a trusted `kid`. The payload contains `schemaVersion: 1`, matching `keyId`, `licenseId`, `deviceId`, `productId`, `issuedAt`, `startsAt`, `expiresAt` (ISO timestamp or `null` for lifetime), `refreshAfter`, `offlineUntil`, and a list of `capture`, `printing`, `templates`, and/or `cloud_sync` features. `offlineUntil` must be bounded by server policy. Unknown keys, algorithms, features, or schema versions are rejected.

The Desktop allows a feature only after Main verifies the entitlement. When offline, Main permits a feature until the signed `offlineUntil` timestamp and reports `offline_grace` after `refreshAfter`. After the deadline, protected work is denied. Gallery read and export operations remain local and do not require a License.

## Server responsibilities still required

Implement transactional seat reservation, user authentication and authorization, plan-version configuration, subscription/payment reconciliation, provider webhook signature verification, webhook and command idempotency, renewal and revocation, audit logging, and key rotation. Never store card data. Checkout completion must be confirmed by server-side provider reconciliation before creating an entitlement. Define support recovery for a lost device and publish stable error codes before enabling activation for customers.
