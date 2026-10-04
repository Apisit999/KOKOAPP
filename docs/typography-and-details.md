# KOKO typography and brass details

English brand and editorial headings use Cormorant Garamond 400/500. UI text uses Noto Sans Thai 400/500/600, with separate Thai and Latin WOFF2 subsets. Thai headings use the UI family, normal letter spacing and a larger line height. The Capture Studio heading and KOKO wordmark explicitly use English language metadata.

Fonts are stored in `src/renderer/public/fonts` and ship offline with the renderer. Fontsource packages pin the source versions in package-lock.json; font notices are included alongside the WOFF2 assets. Both families use SIL Open Font License 1.1. Font files are unmodified. `font-display: swap` and Windows/macOS fallbacks preserve usability while loading.

`design-details.css` owns typography tokens, border motifs and interactions. HTML links both renderer stylesheets with Vite's `?direct` mode so strict `style-src 'self'` permits development CSS. Production Vite emits regular external CSS assets.

Decorations use pointer-events:none, stay on matte frame areas and never animate. Preview corner lines sit within the 14px frame padding, outside video pixels. Transitions are 180ms and reduced-motion disables motion feedback and loading rotation.

To inspect a Windows package with the real Main/Preload bridge:

```powershell
npm.cmd exec -- electron scripts/verify-renderer-ui.cjs "out-typography-details-final/KOKO Photobooth-win32-x64/resources/app.asar" artifacts/typography-details
```

The isolated profile stays inside the artifact directory. The script requests actual fonts, checks horizontal overflow at three content viewport sizes, captures Activation and Diagnostics, then navigates the available English pages and checks reduced-motion using Chromium's media emulation. Capture remains gated when no valid backend entitlement is configured. The Electron test runner reports the Electron runtime version in the version badge; the normal packaged executable reports the application version. These checks do not test live webcam capture or macOS.
