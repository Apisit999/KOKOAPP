# KOKO Photobooth implementation status

Last reviewed: 2026-10-04

This tracker records the current implementation after the owner authorized work across the full product roadmap. It supersedes older notes that required separate authorization for each milestone. External production deployment, paid-service provisioning, and publishing a release remain separate operational steps.

## Product goal

Deliver a rentable Photobooth desktop application that captures photos and short videos, applies tenant supplied frames, prints the result, gives the event operator a separate guest display, and publishes each capture session to a private mobile friendly album with a QR code. A separate administration service manages tenant licenses, limits, retention, and application releases.

## Current code

- Electron desktop shell, Thai/English settings, device licensing, local event and capture-session records.
- Web camera preview, still-frame capture, local JPEG storage, and short WebM recording.
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

## Verification and limits

- `npm.cmd run typecheck` passed after these changes.
- `npm.cmd run test:license-server` (10 tests) and `npm.cmd run test:photo-cloud` (5 tests) passed. Album expiry test confirms the public link is denied and stored WebM is removed.
- `npm.cmd run test:template-layout` (3 tests) and `npm.cmd run test:capture-sessions` (4 tests) passed; saved capture sessions preserve photo layout settings and normalized video geometry maps correctly to output pixels.
- `npm.cmd run test:template-layers` (3 tests) checks safe text/sticker layers, wrapping, and normalized canvas drawing.
- `npm.cmd run test:template-layout` (3 tests), `npm.cmd run test:capture-sessions` (4 tests), and `npm.cmd run test:template-layers` (3 tests) passed after the preview composition change.
- `npm.cmd run test:camera` (5 tests) and `npm.cmd run test:capture-sessions` (4 tests) passed after adding optional microphone audio.
- QR generation is covered by `npm.cmd run test:qr`.
- Latest continuation checks: `npm.cmd run typecheck` passed; `npm.cmd run test:license-server` passed (11 tests), including plan retention updates and aggregate quota enforcement across albums with isolation between licenses; `npm.cmd run test:photo-cloud` passed (5 tests).
- Windows x64 installer 0.1.16 is staged under `artifacts/releases/0.1.16/` with SHA-256 checksums. It includes album expiry/revocation, adjustable photo/video frames, editable text and PNG sticker layers, portrait-video sizing, aspect-matched live preview, and optional microphone audio.
- The new guest display has not yet been exercised with a physical second monitor, and the web album has not yet been scanned from a target phone in this environment.
- Webcam recording uses Chromium's WebM output; microphone audio is optional and depends on the device and browser permission. DSLR shutter control is not implemented.
- Stickers are currently limited to PNG assets up to 100 KB and four per photo/video format; multi-file bundle import and shared team template libraries are not implemented.
- The online album currently uses one unlisted secret URL per capture session. PIN login, tenant-specific quotas, and multi-tenant administrator UI are still required before selling a managed cloud service. Retention is currently a server-wide setting.
- Windows packaging exists, but the installer is unsigned. Signed auto-update is not implemented; customers will need to install a downloaded update manually. macOS packaging is not implemented.

## Next implementation order

1. Test guest-display connect, close, changing monitors, hot unplug, and reconnect on physical displays; verify microphone allow/deny, audio in framed/unframed clips, and microphone disconnect on the target PC.
2. Verify installer install, upgrade, preserved user data, and uninstall behavior on a target Windows computer.
3. Finish media delivery: confirm mixed photo/video customer gallery on a phone, QR readability at print size, recovery after network loss, and clear upload progress.
4. Add secure guest access options (such as a PIN) before any production cloud rollout; per-license plan storage/retention controls are now implemented.
5. Test approved print layouts, real paper dimensions, and color output; consider a shared template library for multi-device rental teams.
6. Expand camera adapters only against named models and official vendor support; keep the webcam path available.
7. Complete deployment operations: signed installer, update channel and rollback, backups, monitoring, support diagnostics, and a real event rehearsal.
