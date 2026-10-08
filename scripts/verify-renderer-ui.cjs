// Exercise the packaged renderer with its real Main/Preload bridge and an
// isolated profile. This never changes licensing, grants capture or opens a camera.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [archiveArg, outputArg] = process.argv.slice(2);
if (!archiveArg || !outputArg) throw new Error('Usage: electron scripts/verify-renderer-ui.cjs <app.asar> <artifact-directory>');
const archive = path.resolve(archiveArg);
const output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const report = { screenshots: [], checks: [], rendererErrors: [], assetErrors: [] };
let started = false;
let stage = 'application startup';
const pause = () => new Promise(resolve => setTimeout(resolve, 300));
const evaluate = (win, js) => win.webContents.executeJavaScript(js);
app.on('browser-window-created', (_event, win) => {
  if (started) return;
  started = true;
  win.webContents.on('console-message', (_event, details) => {
    if (details?.level === 'error') report.rendererErrors.push(details.message);
  });
  win.webContents.session.webRequest.onErrorOccurred(details => {
    if (/\.(css|woff2)(?:\?|$)/.test(details.url)) report.assetErrors.push({ url: details.url, error: details.error });
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      stage = 'Thai language reload';
      await changeLanguage(win, 'th');
      await evaluate(win, `Promise.all([
        document.fonts.load('400 24px "Noto Sans Thai"', 'เก็บภาพช่วงเวลาที่มีความหมาย'),
        document.fonts.load('500 24px "Noto Sans Thai"', 'ตั้งค่ากล้อง'),
        document.fonts.load('600 24px "Noto Sans Thai"', 'เริ่มถ่ายภาพ'),
        document.fonts.load('400 48px "Cormorant Garamond"', 'Capture Studio'),
        document.fonts.load('500 48px "Cormorant Garamond"', 'KOKO')
      ])`);
      await pause();
      for (const [width, height] of [[1280,720],[1366,768],[1920,1080]]) {
        win.setContentSize(width, height);
        await pause();
        await inspect(win, 'activation', width, height);
      }
      await evaluate(win, `Array.from(document.querySelectorAll('.sidebar nav button')).find(button => /Settings|ตั้งค่า/.test(button.textContent))?.click()`);
      await pause();
      await evaluate(win, `Array.from(document.querySelectorAll('.diagnostics-link button')).find(button => /diagnostics|วินิจฉัย/i.test(button.textContent))?.click()`);
      await pause();
      for (const [width, height] of [[1280,720],[1366,768],[1920,1080]]) {
        win.setContentSize(width, height);
        await pause();
        await inspect(win, 'diagnostics', width, height);
      }
      stage = 'English language reload';
      await changeLanguage(win, 'en');
      win.setContentSize(1280, 720);
      await inspect(win, 'activation-en', 1280, 720);
      for (const name of ['Gallery', 'Templates', 'Events', 'Settings', 'Print']) {
        stage = `English ${name} page`;
        await evaluate(win, `Array.from(document.querySelectorAll('.sidebar nav button')).find(button => button.textContent.trim() === ${JSON.stringify(name)})?.click()`);
        await pause();
        await inspect(win, name.toLowerCase() + '-en', 1280, 720);
      }
      await evaluate(win, `document.querySelector('.topbar-account').click()`);
      await pause();
      await inspect(win, 'account-en', 1280, 720);
      await evaluate(win, `document.querySelector('.brand-button').click()`);
      await pause();
      await inspect(win, 'dashboard-en', 1280, 720);
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      report.reducedMotion = await evaluate(win, `({ matches: matchMedia('(prefers-reduced-motion: reduce)').matches, transition: getComputedStyle(document.querySelector('.primary')).transitionDuration })`);
      win.webContents.debugger.detach();
      if (!report.reducedMotion.matches || report.reducedMotion.transition !== '0s') throw new Error('Reduced-motion transition check failed');
      if (report.rendererErrors.length || report.assetErrors.length) throw new Error('Renderer or stylesheet/font errors were reported');
      finish(0);
    } catch (error) {
      report.failure = String(error);
      report.failureStage = stage;
      finish(1);
    }
  });
});
async function changeLanguage(win, language) {
  await evaluate(win, `window.koko.saveSettings({ language: ${JSON.stringify(language)}, highContrast: false, fullscreen: false })`);
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  await pause();
}
async function inspect(win, page, width, height) {
  const loadedFaces = await evaluate(win, `Promise.all([
    document.fonts.load('400 24px "Noto Sans Thai"', 'ภาษาไทย'),
    document.fonts.load('400 48px "Cormorant Garamond"', 'Capture Studio')
  ]).then(async faces => { await document.fonts.ready; return faces.map(group => group.length); })`);
  await pause();
  const check = await evaluate(win, `(() => {
    const h1 = document.querySelector('h1');
    const root = document.querySelector('.app');
    const preview = document.querySelector('.camera-preview');
    const camera = preview && preview.getBoundingClientRect();
    return {
      page: ${JSON.stringify(page)}, width: innerWidth, height: innerHeight, language: root?.lang,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      heading: h1?.textContent, headingFont: h1 && getComputedStyle(h1).fontFamily,
      uiFont: root && getComputedStyle(root).fontFamily,
      thaiLoaded: document.fonts.check('400 24px "Noto Sans Thai"', 'ภาษาไทย'),
      editorialLoaded: document.fonts.check('400 48px "Cormorant Garamond"', 'Capture Studio'),
      bridgePresent: typeof window.koko?.getStatus === 'function',
      decorativePointerEvents: getComputedStyle(document.querySelector('.shell'),'::before').pointerEvents,
      preview: camera && { width: camera.width, height: camera.height }
    };
  })()`);
  report.checks.push(check);
  check.loadedFontFaces = loadedFaces;
  if (check.horizontalOverflow || loadedFaces.some(count => count < 1) || !check.thaiLoaded || !check.editorialLoaded || !check.bridgePresent || check.decorativePointerEvents !== 'none') throw new Error('Font, bridge, decoration or horizontal overflow check failed');
  const screenshot = `${page}-${width}x${height}.png`;
  fs.writeFileSync(path.join(output, screenshot), (await win.webContents.capturePage()).toPNG());
  report.screenshots.push(screenshot);
}
function finish(code) {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(code);
}
setTimeout(() => { report.failure = 'Renderer inspection timed out'; finish(1); }, 45000).unref();
require(path.join(archive, '.vite', 'build', 'main.cjs'));
