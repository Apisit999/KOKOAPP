# KOKO Photobooth — project overview

## Milestone 0 findings (29 September 2026)

- `D:\pKOKO` was empty before these documents were created; it has no Git repository or existing project files to preserve. It is the current writable planning workspace. The preferred final project location, `C:\KOKOPhotobooth`, is outside this workspace and has not been created or inspected. Moving the project there requires an explicit workspace/permission change.
- The existing website at `C:\KOKOwedding` is present. Only its source was read. It remains a separate Next.js application; no website files were changed. Its `package.json` lists React 19.1, Next 16.3.6, Firebase client/Admin, and the R2 S3 SDK. This is context, not a dependency list for the desktop app.
- `cmd /c node --version` returned `v24.20.0`; npm `11.19.0`; pnpm `11.24.0`; Corepack `0.35.0`. Direct `node` from PowerShell was denied and `.ps1` package-manager shims were blocked by execution policy, so commands for implementation should use approved `.cmd` executables and verify the environment again. Yarn was not found.
- The current website contains booking-scoped gallery routes and an album-share model. See `ARCHITECTURE.md` for the inspected API contracts and gaps. No production API calls or credentials were used.

## Product outcome

An event operator can complete setup, run a guest capture, review/retake, and safely retain photos on a Windows computer without internet. Later milestones add templates, watched-folder imports, authorized cloud delivery, gallery links, printing, and commercial operations. The app never treats cloud upload as the primary save operation.

## Who uses it

- **Operator:** configures devices, storage, event, template and sync; sees plain-language recovery actions.
- **Guest:** uses a limited full-screen capture flow with large touch targets and a predictable countdown.
- **Support technician:** can inspect redacted diagnostics and recovery state without access to image contents or secrets by default.

## Experience direction

Use a warm, modern KOKO identity: deep charcoal canvas, restrained coral/peach accents, crisp typography, strong photo emphasis and generous spacing. Provide a high-contrast variant for bright venues. Check the website's brand assets and usage rights before reusing individual assets; do not copy its UI wholesale. Define reusable design tokens, keyboard focus, Thai/English text expansion, minimum comfortable touch target size, and responsive layouts for common laptop and touch-screen resolutions. Validate colors, fonts, and physical screen legibility with operators before visual polish is accepted.

The guest surface shows preview, progress, countdown, capture result and only essential actions. Operator setup and diagnostics live behind a distinct control entry. A persistent status strip shows camera, local-save health, storage, sync, and printer only when enabled. In an offline event, show `Saved on this computer` separately from `Uploaded`.

## Release boundaries

Milestone 0 produces planning documents only. Milestones 1–3 create an offline local booth. Cloud integration is a separately gated milestone because identity, album authority, upload contracts, and publication policy need server work. Printing and direct DSLR control remain independent optional integrations.

## Decisions needing product confirmation

1. Is a local event allowed without an existing website booking? If so, who later maps it to a booking/album?
2. Which photos may guests see: all event photos, a selected album, or operator-approved photos only? What consent and retention rules apply?
3. What Windows versions, minimum hardware, touch display dimensions, and primary operator language are required?
4. Which camera models/webcams and printer models will be supplied for certification? Is 4×6, strip, or another output the first template?
5. Who operates cloud access at events (individual staff account, managed device, or both), and how long must an event work offline?
6. Where should local originals be stored, how large can events be, and who owns backups?

These are product and deployment choices; architecture can proceed with configurable defaults, but cloud publication and real-event release cannot be accepted before they are answered.
