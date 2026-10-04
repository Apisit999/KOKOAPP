# Test and evidence plan

No application tests were run in Milestone 0 because no application was implemented. The source and environment inspection described in `PROJECT_OVERVIEW.md` was performed; endpoint behavior has not been exercised against a running server.

## Automated tests, when relevant milestones are implemented

- Unit: generated safe paths/filenames; MIME and dimension validation; session/photo transitions; backoff including 429 and jitter; upload idempotency/conflict; template geometry; credential redaction; scope locks.
- Integration: SQLite migrations, atomic-file staging and power-loss recovery simulation; database/filesystem disagreement; camera adapter with fake source; folder importer with partial/duplicate/renamed files; queue restart and server-state reconciliation; API client against a staging-compatible mock; printer adapter with fake spooler.
- E2E: launch packaged app, select event, capture/import with a simulated source, restart, confirm local original and metadata, simulate offline then reconnect, verify one upload to intended album. Cover fullscreen exit, missing camera, low storage and auth expiration.
- Security: hostile IPC origin/payload, traversal and junctions, invalid/oversized image, expired/revoked token, unauthorized event/album, replayed upload, CSP/navigation, packaged secret scan, dependency audit, gallery link scope/revocation.

Use representative fixtures and independent expected results, especially for template output and recovery. Record command, environment, date and artifact/result for every claimed pass. Keep production cloud access out of routine automated testing.

## Manual and physical-hardware matrix

| Capability | Can build/verify without hardware? | Required hardware or service before accepting claim |
| --- | --- | --- |
| Shell, settings, event model, template math, local filesystem, queue logic | Yes, with simulated inputs and offline tests | Windows target PC for installer/fullscreen/performance |
| Webcam preview/capture and permission recovery | API/adapter logic yes | At least one named webcam on target Windows PC |
| Folder import logic | Yes, synthetic file writes | Canon camera + EOS Utility or selected tethering app for workflow claim |
| Direct Canon shutter control | Interface/research only | Licensed SDK, named Canon model, cable, Windows PC |
| Printer layout/queue | Preview and fake adapter | Each supported printer, driver, paper type |
| Cloud upload, album/QR permissions | Mocked contract and offline queue | Staging KOKO API/account and guest device; production access for final controlled release only |
| Offline capture and recovery | Yes, simulated camera and disk/network faults | Full event rehearsal on actual storage and power setup |

## Release gates

Before any real event, pass: installer and rollback check; supported camera and storage write/free-space check; 100+ consecutive capture rehearsal or a sample matching expected event load; restart during save/queue; offline capture and reconnect; integrity scan; event/album correctness and guest access test; operator recovery drill; backup/restore sample; privacy/consent sign-off. Record failed cases and owners. Printing and direct DSLR gates apply only if those features are enabled.
