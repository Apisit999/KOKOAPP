# Supported desktop platforms

KOKO Studio distributes desktop builds for these operating systems only:

| Platform | Installer/archive | Architectures |
| --- | --- | --- |
| Windows | Squirrel Setup.exe | x64 |
| macOS | ZIP containing `KOKO Studio.app` | Apple Silicon arm64, Intel x64 |

Forge makers are restricted to `win32` and `darwin`; Linux artifacts are not produced.

## Build commands

- Windows: `npm run make`
- macOS Apple Silicon: `npm run make:mac:arm64`
- macOS Intel: `npm run make:mac:x64`

The macOS ZIP can be assembled from Windows. A DMG, code signing and notarization require a macOS build environment and Apple Developer credentials, so those are not part of the current artifact. The unsigned ZIP must be tested on both Mac architectures before a public release.

The macOS app bundle includes camera and microphone usage descriptions in its Info.plist. Camera, printer, install, update and Gatekeeper behavior still need a Mac hardware/device validation pass.
