# KOKO License Server (development)

The server is a separate service inside this repository. It uses Node's built-in HTTP and SQLite APIs, so it adds no npm dependencies. Use Node.js 22.13 or newer for `node:sqlite`; run the desktop app with its existing Electron runtime. The service stores its database under `data/`, which is ignored by Git.

## Local setup

1. Copy `.env.example` to `.env` and replace `LICENSE_ADMIN_TOKEN` with a random value of at least 32 characters. Keep `.env`, `secrets/`, the SQLite database, and backups out of source control.
2. Generate an RSA signing pair with `npm.cmd run license:keygen`. The script refuses to overwrite an existing pair. Keep `secrets/license-private.pem` only on the server. The public key is safe to configure in the desktop.
3. Set the Desktop's public settings in the same PowerShell session used to launch Electron:

   ```powershell
   $env:KOKO_LICENSE_API_BASE_URL = 'http://127.0.0.1:8787'
   $env:KOKO_LICENSE_PRODUCT_ID = 'koko-photobooth'
   $pem = Get-Content .\secrets\license-public.pem -Raw
   $env:KOKO_LICENSE_TRUSTED_KEYS_JSON = @{ 'koko-local-dev-1' = $pem } | ConvertTo-Json -Compress
   ```

4. Start the backend in one terminal with `npm.cmd run license:server`. It binds to loopback by default. In a second terminal set the same Desktop environment variables and run `npm.cmd start`.
5. Open **Account & License** in KOKO and enter the development key returned in the next step.

## Issue a development license

The development issuance route requires the server-side admin bearer token and is unavailable whenever `NODE_ENV` or `LICENSE_ENV` is `production`:

```powershell
$headers = @{ Authorization = "Bearer $env:LICENSE_ADMIN_TOKEN" }
$license = Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:8787/v1/admin/development/licenses' `
  -Headers $headers -ContentType 'application/json' `
  -Body '{"planId":"annual","email":"operator@example.test"}'
$license.licenseKey
```

Plan IDs are `monthly`, `annual`, and `lifetime`. The server returns each raw key once; it stores only a SHA-256 hash. The development prefix is visible in the returned key. The optional `durationDays` field supports expiry tests (1–3650 days).

## API contract

- `GET /health` — service health.
- `GET /v1/desktop/plans` — active plan configuration from SQLite.
- `POST /v1/desktop/licenses/activate` — validates key, product, expiry, revocation, and available device seat; atomically registers the installation and returns a server-signed RS256 entitlement.
- `POST /v1/desktop/leases/refresh` — verifies the entitlement signature and device/product binding, then checks the live license and activation state before renewing the signed entitlement.
- `POST /v1/desktop/licenses/deactivate` — verifies the signed device entitlement and releases the activation seat.
- `POST /v1/admin/development/licenses` — local/test issuance only, requires `LICENSE_ADMIN_TOKEN`, returns 404 in production.
- `POST /v1/admin/licenses/:id/revoke` — admin-token-protected revocation with idempotency key.

Activation and refresh do not trust Renderer fields or local storage. Electron Main independently verifies the server's JWS, product, installation ID, dates, and features before it permits Capture. A verified token allows at most the configured offline grace interval (default 72 hours); Desktop also stores a local highest-observed clock watermark and fails closed on detected clock rollback. That watermark is best-effort local state, not hardware-backed anti-tamper storage, so a determined machine owner can alter local files/clock. Before commercial deployment, move this watermark and installation identity into reviewed Windows DPAPI/macOS Keychain storage and assess device cloning. Photos and local Gallery remain available after license expiry.

## Data and operational limits

SQLite includes `users`, `plans`, `licenses`, `activations`, `audit_logs`, `idempotency_keys`, and a future-facing `payments` table. Plan seed rows are server-side defaults and can be changed in the database. The payment table does not mean that a provider or webhook is connected. The service does not collect card data and does not issue paid entitlements. Development licenses are the only issuance flow in this phase.

The server includes per-IP/per-route in-memory rate limiting and bounded JSON bodies. Production startup requires `LICENSE_HTTPS_TERMINATED=true`, an admin token of at least 32 characters, and an HTTPS-terminating reverse proxy; a non-loopback listener also requires the HTTPS proxy declaration. For production, replace the local SQLite deployment with a managed database or a reviewed multi-instance-safe setup, use durable distributed rate limits, store signing keys in a secret manager/KMS with rotation, protect admin operations with real operator authentication, configure backups/retention/monitoring, and implement the selected payment provider's server-side reconciliation plus signed, idempotent webhooks. Do not expose the development server directly to the public internet. Customer sales and production issuance are not ready until those controls and external activation checks are completed.

Each plan stores a photo retention window and an aggregate storage quota per license. New albums inherit their license's plan retention window; uploads across all albums for one license share its quota. Legacy albums without a license association keep their recorded expiry and are not counted against a license quota. Existing albums are not shortened or extended when a plan's retention policy changes. Plan defaults for new installations are `KOKO_PHOTO_CLOUD_RETENTION_DAYS` (90) and `KOKO_PHOTO_CLOUD_TENANT_QUOTA_BYTES` (5 GiB); values are copied into seeded plan records only when those plans are first created.

An administrator can change an individual plan's policy with `PUT /v1/admin/plans/{planId}/photo-policy`, using the server admin bearer token and this JSON body:

```json
{ "retentionDays": 90, "storageQuotaBytes": 5368709120 }
```

Retention accepts 1–3650 days; quota accepts 1 MiB–1 TiB. Quota changes apply immediately to all licenses on that plan and are audit logged. Retention changes apply to albums created after the change. `GET /v1/desktop/plans` includes both policy fields.

## Private photo folders (development MVP)

After each capture round, Desktop asks the signed-in License Server for a private folder and uploads each original JPEG (maximum 20 MiB per image and four images/200 MiB per folder). Files are stored beneath `KOKO_PHOTO_CLOUD_PATH` (default `./data/photo-cloud`); SQLite stores folder/photo metadata and only hashes of the separate upload and read-only share keys. The Desktop keeps the upload key in its local user-data directory. The owner receives a private download link after upload completes. The share key is carried in the URL fragment, which browsers do not send in the initial HTTP request. Anyone the owner gives that link to can view and download the folder, so treat it like a password. Folders are created per capture round; folders created under one license share its aggregate storage quota.

The default development server binds to `127.0.0.1`, so links work only on the same computer. To let phones or other people download over the internet, deploy this service behind an HTTPS reverse proxy at a public domain, point Desktop's `KOKO_LICENSE_API_BASE_URL` and `KOKO_PHOTO_PUBLIC_BASE_URL` at that origin, and set `LICENSE_HOST`/`LICENSE_HTTPS_TERMINATED` according to the production proxy setup above. Do not expose the HTTP development listener directly. This MVP does not yet provide an account recovery flow, key revocation, archive export, or remote deletion.

## Checks

Run `npm.cmd run test:license-server`, `npm.cmd run test:photo-cloud`, `npm.cmd run test:license-runtime`, `npm.cmd run test:license`, and `npm.cmd run typecheck`. The server tests start an HTTP listener on an ephemeral loopback port and pass its actual signed response through the same `LicenseRuntime` used by Electron Main.
