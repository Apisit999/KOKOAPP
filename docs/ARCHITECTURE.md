# Architecture

## Current expansion plan — 30 September 2026

The Thai [product roadmap](PRODUCT_ROADMAP_TH.md), [camera compatibility plan](CAMERA_COMPATIBILITY_PLAN.md), and [rental/licensing plan](RENTAL_LICENSING_PLAN.md) extend this original architecture. They prioritize dedicated Canon/Sony cameras, reserve phone support as a later extension, and define signed device-bound rental leases. The shipped camera remains the M2.1 Web MediaDevices preview implementation; M2.2 now adds user-selected local photo storage and a bounded save IPC. Vendor adapters and licensing services are not implemented.

## Runtime boundary

```text
React guest/operator renderer (sandboxed)
  → typed, narrow preload commands and events
  → Electron main process (validation, lifecycle, permissions)
  → services: camera source | capture/session | photo store | metadata store
  → later: template renderer | folder importer | sync client | printer | diagnostics

Camera → verified local original → metadata transaction → durable upload job
      → authorized HTTPS API → R2 object → verified Firestore metadata → gallery
```

Camera preview can use Chromium `navigator.mediaDevices` inside the isolated renderer with an explicit permission handler; capture bytes must cross a bounded, validated IPC command to the privileged local-save service. Never make a renderer blob or UI success message the durable record. Native device SDK work, if needed, belongs in a separate adapter/process. A sandboxed preload must expose named operations rather than `ipcRenderer` itself. Main validates sender origin/frame, payload shape and size, current session and allowed paths.

## Process and module ownership

| Module | Milestone | Responsibility / boundary |
| --- | --- | --- |
| App shell | 1 | single-instance lifecycle, window state, routing, guarded fullscreen, settings, errors; operator/guest modes |
| Camera manager | 2 webcam; 5 folder; 9 SDK | `listCapabilities`, `connect`, `preview`, `capture`, `disconnect`; reports source type explicitly |
| Session | 2 basic; 3 durable | countdown, retake, review, event/session ownership, interruption recovery |
| Template engine | 4 | versioned layout inputs, deterministic rendering, original untouched |
| Local photo library | 2–3 | immutable originals, derived assets, integrity and free-space monitoring |
| Upload queue | 6 | durable state machine, bounded concurrency, retry and reconciliation |
| Cloud integration | 6–7 | authentication, server authorization, booking/album mapping, upload confirmation, publication/link status |
| Printer | 8 | capability discovery, preview, job state, device-specific failure reporting |
| Diagnostics | 1 basic; expanded per milestone | structured local logs and redacted export |

## Failure ordering and recovery

Assign a UUID before capture. Write to a temporary file in the same storage volume, flush/close, validate type and dimensions, calculate SHA-256, then atomically rename to the immutable original path. Only then commit the photo metadata and queue intention in one SQLite transaction. If the process dies between rename and commit, startup reconciliation inventories orphan files and offers safe import/quarantine. If metadata exists but file is missing or hash differs, mark `needs_attention`, block upload, and retain the record. Partial files are never shown as complete; stale temporary files are quarantined after inspection. Disk-full aborts capture with a clear operator message and preserves previous files. No automatic original deletion.

SQLite is justified once sessions, photo metadata and upload jobs must survive restart atomically. Store binaries in the filesystem. Keep DB, WAL and photos in a per-user or configured data root outside the installer, with volume permissions, backups and migration journal. Assess a maintained SQLite driver compatible with the exact Electron runtime at Milestone 2; Node's own SQLite API was still release-candidate in current v24 docs, so it is not locked in now. Put DB work behind a small repository module, not a generic ORM.

## Camera strategy

`CameraSource` exposes identity, capabilities, connection state and a capture contract, with source-specific error codes. A webcam uses `getUserMedia` and explicit resolution negotiation; preview frame resolution, autofocus, device permission, and captured image fidelity must be measured on hardware. A folder source in Milestone 5 imports files from an external tethering app; it cannot trigger the shutter. Completion requires stable size/mtime over a configured interval, successful exclusive/read-open and decode, then hash/inode-path duplicate checks and copying into the owned store. Direct Canon control requires separate SDK, model, license, bitness and redistribution feasibility review. A compatibility list records exact camera model, firmware, connection method, OS and tested functions. Other brands are unpromised.

## Current website contracts inspected read-only

Source: `C:\KOKOwedding\src\app\api\admin\gallery\[bookingId]\uploads\route.ts`, `...\uploads\device-token\route.ts`, `...\share\route.ts`, and `C:\KOKOwedding\src\app\api\gallery\[bookingId]\route.ts`. The `/api/admin/gallery/upload` POST is an alias to `/api/r2-test`; it is not an approved desktop upload contract. These are source-level observations, not live API verification.

| Existing path / method | Request / response observed | Auth, validation, retry notes |
| --- | --- | --- |
| `/api/admin/gallery/{bookingId}/uploads` POST | JSON `shareId,fileName,contentType,size,photoId?,checksum?`; returns `photoId,uploadUrl,expiresAt,alreadyUploaded` | Admin or album uploader bearer; booking and nonexpired album check. JPEG/PNG/WebP, max 25 MiB. Photo ID is 32 hex chars. Reuse with matching metadata; conflict 409. Signed PUT URL expires in 15 min. 400/401/404/409/500/503 possible. |
| Same path PATCH | JSON `shareId,photoId`; returns ready status | Same auth and album check; checks R2 object length/type via HEAD, marks Firestore ready. Repeating ready is accepted. Missing/mismatch yields 409; 401/404/500/503 possible. |
| Same path PUT | Query `shareId,photoId`, image body, `content-length/type`; returns ready status | Same auth; same-origin streaming fallback. Repeating ready accepted. 400/401/404/409/500/503 possible. |
| `/api/admin/gallery/{bookingId}/uploads/device-token` POST | JSON `shareId`; returns bearer `token,expiresAt` | Admin only; album share must be valid, unrevoked and unexpired. Issuing a new token replaces stored hash. 400/401/404. This is album uploader token, not full desktop device registration. |
| `/api/admin/gallery/{bookingId}/share` POST/DELETE | POST `scope?,label?` returns share data; DELETE uses token query | Admin only; creates event or album share, default 30-day expiry; DELETE revokes. Response object and external URL contract need further inspection. |
| `/api/gallery/{bookingId}` GET | Optional `since` or `older`; returns up to 100 photos, cursors and signed image URLs | Guest share token, Firebase user for own booking, or admin. Query filters ready/not-deleted and album when scoped. 401/403/404/500. It is a private read API, not proof that a QR URL is safe to publish. |

Observed risk: POST records `uploading` before R2 PUT; crash recovery and cleanup need server agreement. PATCH validates length and MIME but source review did not prove server-side content hashing, unique upload concurrency safety, or photo ownership beyond the album token. An album token may be sufficient for a temporary manual uploader, but desktop device revocation, renewal, scope and audit need design. Do not ship this protocol without contract tests and threat review.

## Proposed server contract (new work, paths intentionally undecided)

1. Authenticate operator and register/revoke device; return short-lived access credential bound to allowed booking/album and refresh rules. Define offline grace explicitly.
2. Resolve booking and permitted album choices with stable IDs and a display label. Server returns visibility/retention permissions. Local event mapping requires operator verification.
3. Initiate upload with client photo UUID, SHA-256, byte length, MIME and target album. Return upload operation ID, short-lived scoped URL, required headers, expiry, and an idempotent already-complete result. Conflict uses a distinct nonretryable code.
4. Confirm uploaded object; server verifies object and association and returns durable cloud photo reference. Document whether checksum is checked end-to-end. Reconciliation reads operation state after timeout so retries do not create duplicates.
5. Publish or link only with separately authorized action. Return canonical HTTPS gallery URL and visibility state; never construct guessed URLs in the desktop app.

All endpoints need OpenAPI schemas, 401 refresh behavior, 403 scope errors, 409 conflicts, 429/5xx retry guidance, request limits, versioning and staging contract tests before Milestone 6. Cloud client remains injectable and can be simulated offline.

## Proposed folder structure

```text
docs/                 product and engineering decisions
src/main/             Electron lifecycle, security, IPC, local services
src/preload/          narrow typed bridge
src/renderer/         React screens, design tokens, guest/operator UX
src/shared/           IPC schemas and domain types without secrets
src/main/camera/      source adapters
src/main/storage/     originals, derivatives, integrity, DB repositories
src/main/sync/        queue and HTTPS client (milestone 6)
src/main/print/       printer adapter (milestone 8)
assets/               licensed, local brand assets
scripts/              build/release helpers
```

## Dependency selection gates

Start with Electron, React, TypeScript, Vite and Electron Forge with its Vite plugin and Windows maker. Forge publishes current Vite-plugin and Squirrel.Windows maker documentation; exact compatible versions, Windows packaging behavior and code-signing route must be pinned and smoke-tested in Milestone 1. Use npm initially because it is installed and gives one lockfile; do not inherit the website's two lockfiles. Tailwind is optional after a small design-token prototype; it is not needed for security or storage. Add a SQLite driver, image decoder/processor, schema validator, QR generator, printer library, or credential-store binding only when their milestone needs them and after checking maintenance, Electron ABI, packaging, license and Windows support. Avoid renderer native modules and duplicate libraries.

Official references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [Electron Forge Vite plugin](https://www.electronforge.io/config/plugins/vite), [Windows maker](https://www.electronforge.io/config/makers/squirrel.windows), [Node SQLite status](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
