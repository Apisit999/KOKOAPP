# Data model and local persistence

## Ownership and relationships

`Event` is an operator-created local event. It may later map to a website booking after server authorization; it is not automatically a booking. One event has multiple `Session` records (runs/configuration windows). A session owns captures; a `Photo` is never reassigned silently. A cloud `Album` is a server-authorized share/collection attached to a booking; an event can target more than one album, and a session may have one selected album at capture time. A photo stores an immutable target association snapshot until an explicit, audited correction. Gallery permission is a server property of album/share, never inferred from event name.

## Planned schema (types and key rules)

| Entity | Key fields |
| --- | --- |
| Event | `id` UUID, name, local timezone, date, optional `cloudBookingId`, mapping state, created/updated timestamps |
| Session | `id` UUID, `eventId`, start/end/state, `cameraSourceId`, configuration snapshot, optional authorized `albumId`, recovery marker |
| AlbumMapping | local ID, `eventId`, server booking/album IDs, display label, permission/expiry snapshot, last verified time |
| Photo | `id` UUID (upload uses normalized 32-hex form if required by current API), `eventId`, `sessionId`, optional album mapping, source kind, captured UTC time, original/processed/thumbnail relative paths, bytes, MIME, width/height, SHA-256, processing state, integrity state, retake group/selection state, cloud object ID/status |
| UploadJob | `id`, unique `(photoId, rendition, albumId)`, state, attempt count, next attempt, operation ID, last error code, bytes progress, updated time |
| Template | ID/version, layout definition, asset references/checksums, output dimensions, print intent; immutable version once used |
| CameraDevice / PrinterDevice | stable local reference if available, model/name, capabilities snapshot, last seen; no promise that OS device IDs persist |
| AppSettings | schema version, storage root, language, UI mode, capture defaults, low-space threshold, safe feature flags |
| DeviceRegistration / License | future milestone: server ID, status, expiry/grace data; secrets stored outside DB in OS credential vault |

Do not store image binaries in SQLite/Firestore. Use relative owned paths in DB; compute absolute paths only under a validated data root and reject traversal, symlink/reparse escape and unexpected extensions. Cloud metadata should reference object IDs, not local Windows paths.

## State machines

- `Photo`: `capturing → local_ready → processing → processed` or `needs_attention`; upload state is separate. Retake creates a new photo linked by `retakeGroupId`; an operator selects the keeper, while originals remain until an explicit retention action.
- `UploadJob`: `pending → preparing → transferring → confirming → complete`; transient errors go to `retry_wait`, auth errors to `auth_required`, scope/conflict/integrity errors to `blocked`, and manual action can requeue only after conditions are repaired. On restart, in-flight jobs return to reconciliation before new transfer.
- Publication is separate from upload completion: `local_only`, `uploaded_private`, `published`, `revoked` are server-derived states where available.

## Storage and migration

Default to Windows per-user app data for DB/logs and a separately chosen, visible photo root with free-space checks and write-test. Final default must be validated with operator workflow and Windows permissions. Layout: `events/<event-uuid>/sessions/<session-uuid>/originals/<photo-uuid>.jpg`, separate `processed`, `thumbs`, `tmp`, and `quarantine`. Persist a manifest or DB export for recovery. Treat removable/network storage as unsupported until atomic rename and failure behavior are tested; warn before changing roots. Use one database transaction for photo metadata plus upload intention, with atomic file staging as described in architecture.

At startup, compare recent DB entries and filesystem inventory incrementally, then offer a full integrity scan. Missing original or hash mismatch blocks upload/print and records an operator-visible problem; orphan valid files enter quarantine for recovery. Backups copy a consistent SQLite snapshot and photos with manifest/checksums; verify a sample restore before release. No silent cleanup. A future deletion policy needs explicit confirmation, retention age, cloud integrity proof, trash window and audit event. Schema migrations are versioned, backed up, forward-only per release and tested on a previous-version copy. A failed migration leaves originals untouched and offers recovery/rollback via previous installer and backup-compatible DB policy.
