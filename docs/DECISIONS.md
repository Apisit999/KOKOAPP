# Architecture decision log

Status: `proposed` until Milestone 0 is approved. Changing an accepted decision requires a dated reason and impact on security, data and release.

| ID | Decision | Reason and tradeoff |
| --- | --- | --- |
| D01 | Keep desktop project separate from `C:\KOKOwedding`; use `D:\pKOKO` for this planning phase. | Existing site remains untouched. Preferred C: target needs a workspace change before code starts. |
| D02 | Electron main owns privileged local services; React is sandboxed and uses named preload methods. | Limits renderer compromise; costs explicit IPC contracts. |
| D03 | Save immutable local original before DB/queue/cloud work; repair disagreement on startup. | Preserves captures through outages; needs reconciliation and sufficient disk. |
| D04 | Use SQLite metadata/state plus filesystem images from M2 onward, with final driver chosen against Electron version. | Atomic state and restart recovery without storing large blobs. Node built-in SQLite is not yet the locked choice. |
| D05 | Webcam first, EOS Utility folder import second, direct Canon SDK only after feasibility. | Gives a testable path without claiming vendor control. |
| D06 | Cloud upload and publication are distinct states. | Prevents accidental guest access; requires server permission contract. |
| D07 | Reuse existing website upload code only after endpoint contract and server hardening review. | Source shows useful idempotency and signed URL flow, but no verified desktop device lifecycle. |
| D08 | Printing and licensing are optional later modules. | Protects local capture delivery from device/commercial policy complexity. |
| D09 | Start with npm, Electron Forge/Vite, React/TypeScript; pin exact versions in M1. | Installed tooling and documented Windows packaging; compatibility must be proved by packaged build. |
| D10 | Original photos never auto-delete after upload. | Cloud success alone does not establish retention or recoverability. |

## Open decisions

O01 final project path and write access; O02 minimum OS/hardware; O03 local event↔booking mapping owner; O04 gallery audience/consent; O05 storage/backup/retention; O06 first physical camera/printer matrix; O07 identity/device registration/offline grace; O08 selected photo output dimensions and first template; O09 language and accessible contrast target. Resolve O03/O04/O07 before cloud development; O02/O06 before hardware acceptance.

## Scope update — 30 September 2026

Latest user direction: build a working webcam/computer-camera Photobooth first while dedicated camera hardware is unavailable. [WEBCAM_PHOTOBOOTH_WORK_PLAN.md](WEBCAM_PHOTOBOOTH_WORK_PLAN.md) takes precedence for the next implementation sequence: webcam capture/save, guest countdown/review/retake, photo review/recovery, then events/templates. Canon/Sony feasibility and SDK integration move to the later hardware expansion stage. The current update is planning only.

The user requested planning for a scalable Photobooth with dedicated cameras, phone support, and program rental, then clarified that photographic cameras are the immediate priority and asked to continue planning. This round changes documents only.

Proposed extensions: a camera capability contract independent of browser preview, isolated Canon/Sony SDK helpers when feasibility is proven, an exact model/firmware/transport certification matrix, and signed device-bound rental leases with explicit offline limits. Rental pricing/model, first camera models, and phone use mode remain open. These proposals do not assert device compatibility or activate license enforcement.

See [PRODUCT_ROADMAP_TH.md](PRODUCT_ROADMAP_TH.md) for the revised future sequence. D02/D03/D06/D10 continue to apply; D05 expands the candidate brands to Canon and Sony and moves feasibility earlier, while D08 gains a dedicated commercial workstream. Implementation requires the hardware and service prerequisites documented there. `C:\KOKOwedding` remains outside this change.
