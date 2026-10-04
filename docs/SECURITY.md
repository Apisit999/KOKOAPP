# Security and privacy plan

## Assets, actors and trust boundaries

Private photo originals, album assignment, credentials and published links are the highest-risk assets. Actors include guests at a touch screen, event operators, a person with access to the Windows user account, a malicious file in a watched folder, and an untrusted network. Boundaries are renderer→preload→main, external folder→owned photo store, desktop→KOKO API→R2/Firestore, and operator→guest mode. Local disk encryption is an OS/deployment control; app access control cannot protect against a fully compromised Windows account.

## Controls

- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; bundled/local UI only; restrictive CSP; disable webview and uncontrolled windows, deny unexpected navigation, validate all IPC sender frames and payloads, allow media permission only for the app origin and selected camera, and allowlisted HTTPS external links only after user action. Review fuses and custom local protocol at packaging.
- IPC: expose only named commands (for example `saveCapture`, `chooseStorageRoot`, `getStatus`) with schema validation and size/rate limits. No arbitrary path, shell, URL, Node object or raw IPC bridge. File chooser returns a validated capability-like selection, not an unrestricted renderer file path.
- Files: validate content signature and decode, byte/pixel limits, extension normalization, path containment including Windows reparse points, safe generated names, temporary file permissions and cleanup. Recheck a watched file after copy. Never execute metadata, templates or imported content.
- Identity: public Firebase/API config may be packaged; user/device tokens belong in Windows Credential Manager or a reviewed OS-protected store, not source/renderer/localStorage/logs. Firebase Admin, R2 keys, signing secrets and production passwords remain server-only. Refresh and logout clear credentials; server revocation denies future access. Define offline grace separately from live server authorization.
- Cloud: HTTPS, server-side event and album permission checks for every operation, short-lived upload grants, strict MIME/size/object validation, idempotency, audit logs and explicit gallery publication. Do not infer permission from a local booking ID or QR string. Token in URL is a privacy risk; review the website's existing guest-share scheme before using it.
- Diagnostics: structured errors with IDs and timestamps, redact tokens, signed URLs, customer names and private paths where possible; no photo bytes in logs. A support export previews included categories and requires operator action.
- Releases: signed installer/update when commercially released, pinned dependencies, SBOM/vulnerability review, staging rollout, preservation of user data, integrity verification and documented rollback. Versioned DB migration backup before update.

## Specific abuse tests before production

Attempt renderer IPC calls from a wrong frame/origin; oversized captures; traversal and NTFS junction escapes; decompression bombs/invalid JPEGs; album swap during queued upload; replay/reuse of photo IDs; stolen/revoked/expired token; upload confirmation against a different object; QR access after revocation; offline operation after logout; tampered local DB/manifest; unsafe external navigation; installer/update tampering. Record residual risks and mitigation owners before a real event.

## Privacy operations

Obtain event consent and define capture/publication notice in the operator process. Keep local and cloud retention as separate policies. Allow operator to export event inventory, revoke gallery sharing, and request server deletion according to the final policy. Avoid default public gallery visibility. A successful upload does not authorize deleting a local original.
