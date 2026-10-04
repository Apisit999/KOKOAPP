# Risk register

Likelihood and impact are initial estimates; update after hardware and API verification. Owner roles are proposed.

| Risk | L/I | Mitigation and evidence gate | Owner |
| --- | --- | --- | --- |
| Wrong event or album receives private photo | Medium / Critical | Visible association lock, server authorization per upload, immutable target snapshot, staging wrong-scope tests, operator QR review | Product + API |
| Loss of original during crash, disk full or update | Medium / Critical | Atomic staging, integrity/hash scan, low-space reserve, consistent backup/restore and update rehearsal | Desktop + QA |
| Existing website upload route unsuitable for desktop | High / High | Contract review, staging tests, device lifecycle and idempotency design; no assumed reuse | API |
| Webcam quality/permissions vary across Windows PCs | High / Medium | Named-device matrix, permission diagnostics, fallback camera selection and physical rehearsal | Camera + QA |
| EOS Utility writes incomplete/repeated JPEGs | Medium / High | Stability/decode checks, duplicate hashes, source folder remains intact, exact app-version test | Camera + QA |
| SQLite driver or image library fails in packaged Electron | Medium / High | Check ABI/maintenance before adding, packaged smoke test and rollback | Desktop |
| Token or signed URL leaks through logs/support export | Medium / High | OS protected credentials, redaction tests, short-lived scopes, export preview | Security |
| Guest gallery accidentally public or stale QR persists | Medium / Critical | Separate publication action, server canonical URL/expiry/revocation, guest-device test | API + Product |
| Printer driver ignores layout or reports poor errors | High / Medium | Printer-specific profiles and acceptance list, optional printing and export fallback | Print + QA |
| Auto-update damages local data | Medium / Critical | User data outside install dir, backup/migration rehearsal, staged rollout and rollback | Release |
| Venue workload exceeds storage/performance | Medium / High | Reference PC benchmarks, disk forecast and reserve, bounded processing, event-sized rehearsal | QA + Ops |
| Licensing blocks valid offline event | Medium / High | Explicit grace policy, offline rehearsal and operator recovery process; defer enforcement | Product + API |

## Immediate blockers for later milestones

M1: decide writable project location and target Windows floor. M2: supply one webcam and reference PC for physical acceptance. M5: supply Canon/tether workflow for certification. M6–7: approve server contract, staging account, album policy and identity model. M8: identify target printer, media and driver. M10: decide retention/licensing business rules and signing/update distribution.
