# Continuation note — KOKO Studio 0.1.29

Last updated: 2026-11-05

## Status since 0.1.26

- 0.1.29 added account cloud photo sync, guest share links, printer readiness and an update banner. A later commit adds an in-app "Report a problem" form on the Help page (email draft with app version, OS and license state only; text is also copied for users without a mail app).
- UX plan in progress: Phase 0 baseline screenshots and click/time measurement; Phase 1 design tokens (about 228 colours and 74 font sizes to consolidate); Phase 2 onboarding and navigation; Phase 3 split `src/renderer/main.tsx` and add simulated end-to-end tests; Phase 4 guest mode, template packs, filters, GIF, event summary.
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
