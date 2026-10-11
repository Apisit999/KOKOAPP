# KOKO Photobooth implementation status

Last reviewed: 2026-10-11

This tracker records the current implementation after the owner authorized work across the full product roadmap. It supersedes older notes that required separate authorization for each milestone. External production deployment, paid-service provisioning, and publishing a release remain separate operational steps.

## Product goal

Deliver a rentable Photobooth desktop application that captures photos and short videos, applies tenant supplied frames, prints the result, gives the event operator a separate guest display, and publishes each capture session to a private mobile friendly album with a QR code. A separate administration service manages tenant licenses, limits, retention, and application releases.

## Current code

- Electron desktop shell, Thai/English settings, device licensing, local event and capture-session records.
- Web camera preview, still-frame capture, local JPEG storage, and short WebM recording.
- Optional camera export-folder monitoring: stable JPEGs are validated and copied into the local library, assigned to the active event, deduplicated across restarts, and source files are left untouched.
- Custom transparent PNG overlays for photo compositions and guest video; video output adapts to the frame ratio.
- Local photo template composition and print dialog.
- Private cloud folder credentials, JPEG upload, public share page protected by the share key, local retry for interrupted photo uploads.
- Session QR generated locally in the desktop renderer after all session media uploads.
- WebM upload, protected playback/download on the same private album, idempotent local upload tracking, and retry after restarting the app.
- Optional second full-screen guest window on a connected display. The operator window keeps camera ownership, can select among available displays, and sends a low resolution preview, status, and the album QR to the guest window.
- Album owners can revoke a session link from the session history. Revocation is enforced by the server for gallery listing and media downloads, and the desktop app stores the revoked state so it will not recreate or upload to that link.
- Album links expire automatically according to each license plan's retention setting (seeded default 90 days, configurable from 1 to 3650 days). Expired links are denied immediately; an hourly cleanup job removes album files and records.
- The photo template editor lets renters drag and resize every photo opening, adjust its normalized position with keyboard-accessible sliders, preview their transparent PNG frame, and save custom layouts used by capture sessions and printing.
- The video frame editor lets renters place and resize their transparent PNG frame over the camera preview. The recording canvas uses the same normalized geometry for landscape, portrait, and square clips.
- Photo and video templates each support up to six editable text layers with text, color, size, alignment, and normalized position. Photo layers render into exported/printed compositions; video layers render into the live camera preview and recorded WebM. Session snapshots retain the layer settings.
- Each photo/video template can add up to four PNG sticker layers, each up to 100 KB, and position/resize them independently. Stickers render into printed/exported photos and recorded clips, and are kept in the session template snapshot.
- Live camera preview now uses the selected recording aspect ratio and crop-to-fill behavior, with video frames, stickers, and text placed inside the same composition area.
- Video capture can optionally record microphone audio. The microphone is off by default and is requested only after the operator enables audio and starts a video capture; audio tracks are stopped when recording ends or is cancelled.
- License plans now carry per-license photo retention and aggregate storage quota policies. New cloud albums bind to the verified license, expiry is fixed from that license plan at album creation, and photo/video uploads share the license quota across albums. Admins can update plan policy through a token-protected, audited server endpoint.
- The operator dashboard now includes a live event readiness checklist for the active event, camera, local storage, KOKO template, license-backed album/QR delivery, plus optional guest display and print setup shortcuts.
- Retrying a session upload now streams per-file progress to the Sessions page, showing checked media and successful uploads as they happen.
- Capture-session history is no longer silently truncated at 2,000 rounds; the operator can page through history and older sessions are retrievable by ID for sharing and recovery.
- Startup and retry recovery now recheck operator status and will not publish a cancelled or retaken session, including when a retake occurs while an upload is queued.
- Saved photo/video templates can be exported as a versioned portable JSON archive and imported with strict schema, embedded-image, layer, geometry, duplicate-ID, and size validation. Imports merge by template ID and preserve unrelated saved templates.
- The desktop app can import the existing KOKOMEMORY uploader JSON for one booking album, encrypt the credential with Windows safeStorage, optionally store the matching customer gallery URL, and queue JPEG uploads only after a capture session is confirmed. Upload jobs snapshot their booking/album destination, recover interrupted jobs at startup, retry transient failures, and never expose the uploader token to the renderer.
- Print setup now discovers Windows printers and sends composed PNGs through a durable local print queue with printer, A4/A5/Letter/4×6 paper, orientation, and copies options. It records when Windows accepts a print request, recovers jobs interrupted before submission, permits retry after failures, and lets operators cancel queued jobs before they enter the spooler.

## Work completed in this increment

- Extended the private album API, storage schema, desktop client, and retry flow to include WebM clips.
- Made the customer album load video only when the guest chooses to play or download it, to avoid downloading every large clip on a phone at once.
- Added a locally generated QR for a completed private album. The secret album URL is not sent to a third-party QR service.
- Added a second display window that shows the live preview, event name, capture status, and the private album QR.
- Added owner authenticated album-link revocation, persistent desktop state, and a server check that blocks existing photo and video links after revocation.
- Added configurable album expiry, visible expiry dates, server-side access enforcement, and scheduled removal of expired album media.
- Added movable/resizable photo-opening geometry, precise slider controls, layout reset, saved-template compatibility for older templates, and persistent session snapshots.
- Added movable/resizable video-frame geometry shared by live preview and the recorded WebM canvas, with output-pixel mapping checks for portrait and landscape dimensions.
- Added reusable text-layer validation and wrapping, separate photo/video layer controls and previews, canvas rendering in print/export/recorded video, and persistent session snapshot data.
- Added validated PNG sticker import, movable/resizable independent photo and video image layers, renderer bitmap loading/cleanup, canvas compositing, and snapshot persistence.
- Matched the live camera preview composition bounds and video overlays to the aspect ratio and crop used by saved recordings.
- Added opt-in microphone audio for recorded clips, including framed clips, with explicit permission prompting and track cleanup.
- Added focused server, client, recovery, and QR checks.
- Added an opt-in camera export-folder watcher with a renderer-safe IPC contract, persistent resume setting, asynchronous file scanning, stable-file detection, bounded JPEG validation, and source-key idempotency in the photo index.
- Added regression coverage for import stability, unchanged source files, restart deduplication, crash-window idempotency, and invalid/non-JPEG files.
- Fixed capture-history pagination and cloud-recovery lookup so older pending sessions remain reachable without silently dropping local history.
- Added regression checks for retake/cancel safety during recovery and for retaining history beyond 2,000 sessions.
- Added portable template archive import/export in the desktop app, with three archive validation/merge checks.
- Added a KOKOMEMORY desktop client for the website's existing init/signed-storage-upload/confirm contract, a durable per-album queue, encrypted credential storage, safe uploader-file import, retry recovery, and session/Settings controls. This implementation was aligned to a read-only review of the KOKOMEMORY source contract; the website repository was not modified.
- Added Windows printer discovery and an application-managed durable print queue with composition preview, paper/orientation/copies options, retry for failed jobs, cancel for pending jobs, and status persistence after restart.
- Added a salted Guest exit PIN stored by Electron Main, five-attempt lockout, PIN prompts for Guest mode exit paths, persistent kiosk state across unexpected restarts, and close/second-instance interception.
- Added a server-listed Free plan, self-service signed Free entitlement per installation identifier, account-page claim UI, and cloud feature denial in the app and server. Free includes capture, printing, and templates; paid plans retain cloud sync.

## Verification and limits

- Free Early Access now has a server-signed per-installation entitlement with local capture, printing, and template features. Cloud albums are denied for Free. This is not yet linked to a kokomemory.com customer account, and the packaged build has no production API URL or trusted public key. See docs/COMMERCIAL_DEVELOPMENT_PLAN_TH.md and artifacts/verification/0.1.26/free-readiness.json.

- `npm.cmd run typecheck` passed; all 20 automated test files passed (84 tests), including capture recovery, photo storage, template archive validation, camera-folder import/idempotency, mocked KOKOMEMORY integration, and print-queue recovery.
- Windows x64 setup executable and full Squirrel package for 0.1.26 are staged under `artifacts/releases/0.1.26/`, with `INSTALL.txt` and verified SHA-256 checksums in `SHA256SUMS.txt`. Authenticode reports `NotSigned`.
- The 0.1.25 packaged UI harness passed 15 checks for PIN setup, Thai/English pages, and assets. The 0.1.26 harness could not run because Windows AppContainer denied access to the build folder; the new Free UI has not yet been visually verified in the packaged app. See `artifacts/verification/0.1.26/free-readiness.json`.
- The camera-folder service test imports from a temporary folder into the durable photo store, preserves the source file, and tests restart/crash-window deduplication. Real camera export software and JPEG samples still need a field test; direct DSLR shutter control is not implemented.
- The print queue status `submitted` means Windows accepted the request; it cannot confirm that paper physically came out. Paper sizing, borderless modes, color output, printer selection, and offline/printer-driver behavior still need checks against the supported printer matrix.
- KOKOMEMORY uploads have been exercised against a mocked API contract only. A real booking uploader JSON and staging album are still needed for an end-to-end live upload check. The customer gallery QR/token is separate from the uploader JSON, so the operator must paste the exact gallery URL from the KOKOMEMORY admin page if the app needs to show or copy that link. Upload supports JPEG photos up to 25 MB; KOKOMEMORY video publishing is not implemented.
- Remaining release work includes production License API URL and trusted signing key configuration, connecting Free claims to kokomemory.com accounts, a signed installer, update channel and rollback, installation/upgrade/uninstall checks on a target Windows computer, payment checkout/webhooks, and a real event rehearsal. macOS packaging is not implemented.
- Sticker assets remain PNG-only, up to 100 KB and four per photo/video format. Multi-file template bundles and shared team libraries are not implemented. The existing cloud album still uses one secret URL per capture session and needs PIN access before production cloud rollout.

## Next implementation order

1. Complete a hardware-free Free workflow using sample captures and simulated print status, including review/retake, composition, confirmation, and restart recovery.
2. Fix and rerun the packaged UI harness for 0.1.26 from a Windows-readable application directory.
3. Configure the production License API URL and trusted public key; connect Free entitlements to kokomemory.com accounts when its source/API is available.
4. Verify KOKOMEMORY upload and gallery QR with a staging booking; decide the Free cloud allowance before enabling it.
5. Add checkout, payment confirmation/webhooks, renewals, and owner administration after package prices and terms are selected.
6. Test installation/upgrade and the camera/printer/guest-display matrix when target devices are available.
7. Complete signing, update/rollback, diagnostics, backups, and an event rehearsal.

## Follow-up fixes and verification (2026-10-11, 0.1.27)

- Fixed Free reactivation after local deactivation, refresh after offline grace when server is reachable, and seeded paid plan migration to include cloud_sync without losing custom features.
- Changed built-in sample photo URL to be relative to the packaged renderer page. Confirmed four SVG assets are included in app.asar.
- Added a no-device simulated print result to the application-managed queue.
- Verification after changes: typecheck passed, 88/88 tests across 20 files passed, and Windows x64 Squirrel installer generated. Packaged Thai UI rendered at three desktop resolutions; the UI harness did not complete because the packaged app has no configured license service. Physical hardware, production activation, installer lifecycle, and code signing remain unverified.
- Release bundle: artifacts/releases/0.1.27. See artifacts/verification/0.1.27/readiness.json and docs/PROJECT_READINESS_REVIEW_TH.md.
