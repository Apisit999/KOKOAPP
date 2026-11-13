# Continuation note — KOKO Studio 0.1.29

Last updated: 2026-11-10

## Update (2026-11-13): newest status, read before the 2026-11-10 handoff

- Branch `main` is 20 commits ahead of `origin/main` (head 52a4465). Still nothing pushed; the owner has no camera, printer or other hardware to test with right now. Ask before pushing.
- Built since the 2026-11-10 handoff: print-sheet preview with a cut line for 2-up strips, A5 and A4 portrait sizes and a 6-photo vertical strip, Guest clip length as a template setting (5, 10, 15 or 20 s), a colour filter for composed photos (black & white, vintage, vivid, soft, warm, cool). Open ideas (1) to (3) of the older list are therefore done.
- Simulated check on 2026-11-13: typecheck passes, 153 unit tests pass, and the end-to-end phases first, summary, design, csp, sizes, video, rounds (20), disk-full, slideshow and the Guest phases (guest, guest-sizes, guest-multi, guest-video, guest-disk-full) pass. `cloud` and `fonts` were not rerun (they passed on 2026-11-10; nothing since touched them).
- `slideshow` failed once and then passed twice on rerun: the script reads the slideshow id list right after "ready", before the new photo is indexed. It is a script timing issue; the script should wait for the list to grow.
- QA pitfalls found: in PowerShell read the public key with `[IO.File]::ReadAllText`, not `Get-Content -Raw` (otherwise `ConvertTo-Json` writes `{"value": ...}` and the app reports "License service is not configured"); the licence config is baked in when packaging; run each operator phase on a fresh profile after `first`, because several phases in one profile leave state that makes later phases time out on "preview button".
- The QA server was stopped and a clean package rebuilt (no QA key in `out/`).
- Next, in order: screenshots of Guest, Templates and the print preview for a visual review; GIF; fix the slideshow wait; whole-event gallery with a PIN (needs cloud server code that is not in this repo). Real-hardware testing is still required before any event.

## Handoff (2026-11-10): read this first

- Branch `main` is 13 commits ahead of `origin/main` (last pushed 89e7ed0, then everything up to 441a82a is local only). **Nothing has been pushed since; the owner wanted to test by hand first.** Ask before pushing.
- Since 0.1.29 (all on 2026-11-10): Guest mode kiosk fixes and video clips (template setting "Guest captures"), kill/disk-full recovery fixes, album QR on short screens, custom fonts, import-your-own-design (PNG with transparent windows), a Content-Security-Policy fix (`connect-src` now allows `data:` and `blob:`; without it frame PNGs and stickers could not be composed), live slideshow on the guest display, and template sizes (vertical 2x6 strip, 4x6 portrait/landscape, square, story, 5x7; 1 to 4 photos; 2 strips per 4x6 sheet when printing).
- Tests: `npm run typecheck` and every `npm run test:*` pass (31 suites). End-to-end checks live in `scripts/verify-simulated-session.cjs` (phases: first, guest, guest-resume, guest-sizes, guest-multi, guest-video, guest-disk-full, rounds, video, summary, disk-full, kill-mid-round + after-kill, csp, fonts, design, slideshow, sizes, cloud) and `scripts/verify-renderer-ui.cjs`; all passed on 2026-11-10. How to run them, the throwaway-QA-package rule and per-phase prerequisites are in docs/TEST_PLAN.md. Run `first` on a fresh artifact directory first; Guest phases leave a profile in Guest mode, so run operator phases (fonts, slideshow, rounds, video, summary, disk-full, sizes) before them or use another profile.
- After any QA run: stop the license server on port 8787, unset the `KOKO_*` variables, run `npm run package` again, and confirm `out/` contains no `MIIBojANBgkqhkiG9w0BAQEFAAOCAY8A`. The package in `out/` is currently clean.
- Not tested anywhere: a real camera, printer (including the 2-strips-per-sheet print), touch screen, second monitor, the target PC, the real account cloud (only a simulated API) and scanning the QR with a phone.
- Open ideas, in the order I would do them: (1) a print preview of the 4x6 sheet with two strips; (2) more sizes (A4/A5, 6-photo strip); (3) configurable Guest clip length (fixed 10 s now); (4) whole-event gallery with a PIN, which needs the cloud server code that is not in this repo; (5) filters / GIF from the older Phase 4 list.
- Compared with qdrop.app the booth covers roughly a third of the features that site claims (it is a gallery/sales platform); the missing parts (face search, selling, FTP receiver, multi-camera, gallery PIN/branding) need server work.

## Status since 0.1.26

- 0.1.29 added account cloud photo sync, guest share links, printer readiness and an update banner. A later commit adds an in-app "Report a problem" form on the Help page (email draft with app version, OS and license state only; text is also copied for users without a mail app).
- UX plan in progress: Phase 0 baseline screenshots and click/time measurement; Phase 1 design tokens (done, 6ffca2d); Phase 2 onboarding and navigation; Phase 3 split `src/renderer/main.tsx` and add simulated end-to-end tests; Phase 4 guest mode, template packs, filters, GIF, event summary.
- Done since: dashboard shows one next step and groups the sidebar by workflow; Settings and the template editor fold advanced options; `src/renderer/main.tsx` is split into per-area modules; ready-made template presets (`template-presets.ts`); Guest mode is kiosk-ready (preview starts by itself, operator controls hidden, shutter and Retake/Finish stay on screen from 800x1280 to 1920x1080, Thai and English, next guest starts clean, no PIN prompt when it resumes after a restart); the Free plan no longer attempts cloud sync.
- Hardware-free end-to-end check: `scripts/verify-simulated-session.cjs` (phases first, second, rounds, guest, guest-sizes, guest-resume). See "Hardware-free session check" in docs/TEST_PLAN.md for how to build the throwaway QA package; never ship that package. The Windows package in `out/` must be rebuilt without the QA variables before distribution, and no installer has been made from this work.
- Custom fonts (Templates page: Your fonts, per-template title/footer font, per-text-layer font, packed into exported template archives) and Import your own design (PNG with transparent windows, windows found automatically) were added on 2026-11-10; a Content-Security-Policy bug that blocked frame PNGs and stickers was fixed. Live slideshow on the guest display (Guest view page > Live slideshow; off by default; settings in slideshow.json; shared logic in src/shared/slideshow.ts) was added on 2026-11-10. Template sizes (src/shared/template-size.ts): vertical photo strip 2x6 (3 or 4 photos, prints 2 strips per 4x6 sheet), portrait/landscape 4x6 postcard, square, story 9:16, 5x7, plus the original sizes for old templates; photo count is now 1 to 4; 8 new presets; imported designs pick their size from their shape. Added on 2026-11-10. Known gaps: no real camera, printer, touch screen or target-PC run; the real account cloud (only a simulated API is tested) and phone scanning of the QR are untested; photos from a retaken round deliberately stay in the library (decided); landscape Guest layout keeps the preview small on 720-768px high screens; the version is still 0.1.29.
- The "Next work" list below is still valid; the 0.1.26 details are kept for history.

## Worktree at 0.1.26

- Version 0.1.26 adds a server-signed Free plan for capture, printing, and templates on one persistent installation identifier. Cloud albums are excluded from Free in both the desktop runtime and server endpoints; paid plans retain cloud sync. The Account page has a Free claim action.
- Free self-claims are not yet tied to a kokomemory.com account. The package has no production License API URL or trusted public signing key, so customer Free activation is not available until service hosting/build configuration is supplied.
- `npm.cmd run typecheck` passed. All 20 test files passed, 84/84 tests. Windows x64 make completed; installer, full package, manifest, install notes, and recomputed SHA-256 sums are in `artifacts/releases/0.1.26/`. The installer is unsigned.
- Inspected app.asar; no `.env`, private key, secrets directory, or PEM files were included.
- The packaged 0.1.26 renderer harness is blocked by the Windows AppContainer ACL in this environment and produced no report. Earlier 0.1.25 renderer checks do not cover the Free UI. The detailed result is `artifacts/verification/0.1.26/free-readiness.json`.

## Next work

1. Add and verify a clearly labeled simulated printer and run a hardware-free Free sample session from capture through review, composition, print queue, and restart recovery.
2. Rerun packaged UI validation from an application directory that permits AppContainer access.
3. Configure production License API URL/key and connect Free claim to kokomemory.com accounts when the website source and API deployment are available.
4. Decide Free cloud allowance, then verify staging gallery/upload and implement payment/order/webhook flows after prices and terms are defined.
5. Install/upgrade on a target Windows computer and test the camera, printer, and guest display when hardware is available.

## Verification limits

- No physical camera/printer, KOKOMEMORY staging booking, packaged UI report for 0.1.26, or install lifecycle validation is available yet.
- Free claim is per installation ID, not an authenticated website account.
- Checkout, payment confirmation, automatic renewal, code signing, update channel, and rollback are not implemented.
