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
      stage = 'Guest exit PIN setup and verification';
      await inspect(win, 'settings-pin', 1280, 720);
      report.guestPinFlow = await evaluate(win, `(async () => {
        const panel = document.querySelector('.guest-pin-settings');
        if (!panel) return { panelPresent: false };
        const setValue = (input, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setValue(panel.querySelector('input'), '718293');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const confirmation = panel.querySelectorAll('input')[1];
        if (!confirmation) return { panelPresent: true, confirmationPresent: false };
        setValue(confirmation, '718293');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        Array.from(panel.querySelectorAll('button')).find(button => /Set PIN|ตั้ง PIN/.test(button.textContent))?.click();
        let configured = false;
        for (let i = 0; i < 30 && !configured; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          configured = (await window.koko.getStatus()).guestExitPinConfigured;
        }
        const wrongPinAccepted = await window.koko.verifyGuestExitPin('000000');
        const correctPinAccepted = await window.koko.verifyGuestExitPin('718293');
        const pinLeakedInStatus = JSON.stringify(await window.koko.getStatus()).includes('718293');
        const removed = await window.koko.setGuestExitPin('718293', null);
        const cleared = !(await window.koko.getStatus()).guestExitPinConfigured;
        return { panelPresent: true, confirmationPresent: true, configured, wrongPinAccepted, correctPinAccepted, pinLeakedInStatus, removed, cleared };
      })()`);
      if (!report.guestPinFlow.panelPresent || !report.guestPinFlow.confirmationPresent || !report.guestPinFlow.configured || report.guestPinFlow.wrongPinAccepted || !report.guestPinFlow.correctPinAccepted || report.guestPinFlow.pinLeakedInStatus || !report.guestPinFlow.removed || !report.guestPinFlow.cleared) throw new Error('Guest exit PIN flow failed');
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
      report.freePlanUI = await evaluate(win, `({ freeCardPresent: Boolean(document.querySelector('.free-plan-card')), freeButtonVisible: Boolean(Array.from(document.querySelectorAll('.free-plan-card button')).find(button => /Claim Free license/.test(button.textContent))), cloudExclusionExplained: /Cloud albums are not included/.test(document.querySelector('.free-plan-card')?.textContent || '') })`);
      if (!report.freePlanUI.freeCardPresent || !report.freePlanUI.freeButtonVisible || !report.freePlanUI.cloudExclusionExplained) throw new Error('Free plan account UI check failed');
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
      brokenPublicImages: Array.from(document.images)
        .filter(image => /koko-studio-mark\.png|portrait-one\.svg/.test(image.getAttribute('src') || '') && (!image.complete || image.naturalWidth === 0))
        .map(image => image.getAttribute('src')),
      preview: camera && { width: camera.width, height: camera.height }
    };
  })()`);
  report.checks.push(check);
  check.loadedFontFaces = loadedFaces;
  if (check.horizontalOverflow || check.brokenPublicImages.length || loadedFaces.some(count => count < 1) || !check.thaiLoaded || !check.editorialLoaded || !check.bridgePresent || check.decorativePointerEvents !== 'none') throw new Error('Image, font, bridge, decoration or horizontal overflow check failed');
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
