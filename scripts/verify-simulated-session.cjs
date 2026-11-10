// Hardware-free end-to-end check of the packaged app: Free claim -> storage -> event -> capture with the
// simulated camera through the real UI -> confirm -> composition input -> simulated print -> restart recovery.
// Requires a local License Server (npm run license:server) and KOKO_LICENSE_* env vars; see docs/TEST_PLAN.md.
// Usage: electron scripts/verify-simulated-session.cjs <app.asar> <artifact-directory> <first|second>
const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [archiveArg, outputArg, phase = 'first'] = process.argv.slice(2);
if (!archiveArg || !outputArg) throw new Error('Usage: electron scripts/verify-simulated-session.cjs <app.asar> <artifact-directory> <first|second>');
const archive = path.resolve(archiveArg);
const output = path.resolve(outputArg);
const storageDir = path.join(output, 'photos');
fs.mkdirSync(storageDir, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [storageDir] });
const report = { phase, steps: [], rendererErrors: [] };
// Full-disk simulation (phase disk-full): fail photo-byte writes with ENOSPC after `fullAfter` successful ones.
let fullAfter = Infinity; let fdWrites = 0; let failMode = 'all';
if (phase === 'disk-full' || phase === 'guest-disk-full') {
  const nodeFs = require('node:fs'); const realWrite = nodeFs.writeFileSync;
  nodeFs.writeFileSync = function (target, data, ...rest) {
    if (typeof target === 'number' && fullAfter !== Infinity && data && data.length > 50 && (failMode === 'all' || typeof data !== 'string')) {
      if (fdWrites++ >= fullAfter) { realWrite.call(this, target, typeof data === 'string' ? data.slice(0, Math.floor(data.length / 2)) : data.subarray(0, Math.floor(data.length / 2)), ...rest); const error = new Error('ENOSPC: no space left on device, write'); error.code = 'ENOSPC'; throw error; }
    }
    return realWrite.call(this, target, data, ...rest);
  };
}
// Simulated account cloud (phase cloud): the app talks to /v1/desktop/cloud/* and PUTs photos to an https URL; both go through the global fetch.
let cloudMode = 'ok'; const cloudMock = { events: 0, inits: 0, puts: 0, confirms: 0, shares: 0, uploaded: new Set(), putBytes: 0, shareUrls: [] };
if (phase === 'cloud') {
  const realFetch = globalThis.fetch;
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = String((input && input.url) || input);
    if (url.startsWith('https://qa-upload.invalid/')) {
      if (cloudMode === 'down') throw new TypeError('network down');
      cloudMock.puts++; cloudMock.putBytes += init.body ? init.body.length : 0; return new Response(null, { status: 200 });
    }
    const at = url.indexOf('/v1/desktop/cloud/');
    if (at < 0) return realFetch(input, init);
    if (cloudMode === 'down') return reply(503, { code: 'server_error' });
    const route = url.slice(at + '/v1/desktop/cloud/'.length); const body = JSON.parse(init.body || '{}');
    if (route === 'events') { cloudMock.events++; return reply(200, { eventId: require('node:crypto').randomBytes(16).toString('hex') }); }
    if (route === 'photos/init') { cloudMock.inits++; return cloudMock.uploaded.has(body.photoId) ? reply(200, { alreadyUploaded: true }) : reply(200, { uploadUrl: 'https://qa-upload.invalid/' + body.photoId }); }
    if (route === 'photos/confirm') { cloudMock.confirms++; cloudMock.uploaded.add(body.photoId); return reply(200, { ok: true }); }
    if (route === 'shares') { cloudMock.shares++; const link = 'http://127.0.0.1:8787/share#qa-' + body.sessionId; cloudMock.shareUrls.push(link); return reply(200, { url: link, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() }); }
    if (route === 'shares/revoke') return reply(200, { ok: true });
    return reply(404, { code: 'not_found' });
  };
}
let started = false;
let stage = 'startup';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win, js) => win.webContents.executeJavaScript(js);
async function waitFor(win, js, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(win, js)) return;
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const clickButton = (win, scope, text) => evaluate(win, `(() => { const b = Array.from(document.querySelectorAll(${JSON.stringify(scope)})).find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (b) b.click(); return Boolean(b); })()`);
const clickCount = (win, n) => evaluate(win, `(() => { const b = Array.from(document.querySelectorAll('[aria-label="Photos per session"] button')).find(x => x.textContent.trim().startsWith(${JSON.stringify(String(n))})); if (b) b.click(); return Boolean(b); })()`);
const step = (name, data) => report.steps.push({ name, ...data });
const shot = async (win, name) => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());

app.on('browser-window-created', (_event, win) => {
  if (started) return;
  started = true;
  win.webContents.on('console-message', (_event, details) => { if (details?.level === 'error') report.rendererErrors.push(details.message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const html = path.join(archive, '.vite', 'renderer', 'main_window', 'index.html');
      if (phase === 'first') {
        stage = 'setup';
        await evaluate(win, `window.koko.saveSettings({ language: 'en', highContrast: false, fullscreen: false })`);
        const license = await evaluate(win, `window.koko.claimFreeLicense()`);
        step('free-claim', { state: license.state, features: license.features });
        if (license.state !== 'active' || !license.features.includes('capture')) throw new Error('Free claim did not grant capture');
        const storage = await evaluate(win, `window.koko.choosePhotoStorage()`);
        step('storage', { configured: storage.configured });
        const event = await evaluate(win, `window.koko.createEvent({ name: 'Simulated QA event', date: null, notes: '' })`);
        await evaluate(win, `window.koko.setActiveEvent(${JSON.stringify(event.id)})`);
        step('event', { id: event.id });
        stage = 'reload with simulated camera';
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(800);
        await clickButton(win, '.sidebar nav button', 'Capture');
        stage = 'camera ready';
        await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Start live preview')`, 'preview button', 15000);
        await clickButton(win, 'button', 'Start live preview');
        await waitFor(win, `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled)`, 'capture button enabled', 20000);
        await shot(win, 'capture-ready');
        step('camera-ready', { simulated: true });
        stage = 'capture';
        await clickButton(win, '.countdown-options button', 'OFF');
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Finish round')`, 'review screen', 30000);
        await shot(win, 'review');
        await wait(800);
        const cloudNote = await evaluate(win, `(document.querySelector('.photo-cloud-share') || {}).innerText || ''`);
        step('review-shown', { cloudNote });
        if (!/does not include online albums/.test(cloudNote)) throw new Error(`Free plan review shows the wrong cloud message: ${cloudNote}`);
        await clickButton(win, 'button', 'Finish round');
        await wait(1500);
        const sessions = await evaluate(win, `window.koko.listCaptureSessions(10, 0)`);
        const latest = sessions[0];
        step('session', { count: sessions.length, status: latest?.status, photos: latest?.photoIds?.length });
        if (!latest || latest.status !== 'confirmed' || latest.photoIds.length < 1) throw new Error('Session was not confirmed with a photo');
        const status = await evaluate(win, `window.koko.getPhotoStorageStatus()`);
        step('storage-after', { photoCount: status.photoCount });
        if (status.photoCount < 1) throw new Error('No photo stored');
        stage = 'simulated print';
        const png = await evaluate(win, `(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#c9a24a'; x.fillRect(0, 0, 600, 400); const blob = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await blob.arrayBuffer())); })()`);
        const job = await evaluate(win, `window.koko.submitPrintImage(new Uint8Array(${JSON.stringify(png)}), { printerName: '__koko_simulated_printer__', paper: '4x6', landscape: false, copies: 1 })`);
        step('print', { status: job.status });
        if (job.status !== 'simulated') throw new Error(`Simulated print returned status ${job.status}`);
      } else if (phase === 'guest') {
        stage = 'guest mode';
        await evaluate(win, `window.koko.setGuestExitPin(null, '718293')`).catch(() => undefined);
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(1000);
        // The app resumes Guest mode after a reload, so only walk through the dashboard when it did not.
        if (!(await evaluate(win, `Boolean(document.querySelector('.guest-capture'))`))) {
          await evaluate(win, `document.querySelector('.brand-button').click()`);
          await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Start Guest mode')`, 'dashboard', 8000);
          await clickButton(win, 'button', 'Start Guest mode');
        }
        await clickButton(win, 'button', 'Stay in Photobooth');
        await waitFor(win, `Boolean(document.querySelector('.guest-capture'))`, 'guest mode', 10000);
        if (process.env.KOKO_QA_CSS) await win.webContents.insertCSS(fs.readFileSync(process.env.KOKO_QA_CSS, 'utf8'));
        stage = 'guest auto-start';
        await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'capture button without pressing Start live preview', 20000);
        const hidden = await evaluate(win, `({ startButton: Array.from(document.querySelectorAll('.guest-capture button')).some(b => b.offsetParent && /Start live preview/.test(b.textContent)), sampleCard: Boolean(document.querySelector('.guest-capture .sample-session-card')?.offsetParent), cameraSelect: Boolean(document.querySelector('.guest-capture .camera-select-label')?.offsetParent), settingsGear: Boolean(document.querySelector('.guest-capture .camera-settings-button')?.offsetParent), techNote: Boolean(document.querySelector('.guest-capture .camera-capability-note')?.offsetParent), discSize: Math.round(document.querySelector('.guest-capture .capture-disc').getBoundingClientRect().width), scrolls: document.documentElement.scrollHeight > innerHeight, innerHeight, scrollHeight: document.documentElement.scrollHeight })`);
        step('guest-controls', hidden);
        step('guest-reach-ready', await evaluate(win, `({ innerHeight, disc: Math.round(document.querySelector('.guest-capture .capture-disc').getBoundingClientRect().bottom), finish: (() => { const b = Array.from(document.querySelectorAll('.guest-capture button')).find(x => x.textContent.trim() === 'Finish round'); return b ? Math.round(b.getBoundingClientRect().bottom) : null; })(), retake: (() => { const b = Array.from(document.querySelectorAll('.guest-capture button')).find(x => x.textContent.trim() === 'Retake'); return b ? Math.round(b.getBoundingClientRect().bottom) : null; })() })`));
        if (hidden.startButton || hidden.sampleCard || hidden.cameraSelect || hidden.settingsGear || hidden.techNote) throw new Error('Guest mode still shows operator controls: ' + JSON.stringify(hidden));
        stage = 'guest capture round';
        await evaluate(win, `document.querySelector('.guest-capture .capture-disc').click()`);
        await waitFor(win, `Array.from(document.querySelectorAll('.guest-capture button')).some(b => b.textContent.trim() === 'Finish round')`, 'guest review', 40000);
        await wait(500);
        step('guest-reach-review', await evaluate(win, `({ innerHeight, disc: Math.round(document.querySelector('.guest-capture .capture-disc').getBoundingClientRect().bottom), finish: (() => { const b = Array.from(document.querySelectorAll('.guest-capture button')).find(x => x.textContent.trim() === 'Finish round'); return b ? Math.round(b.getBoundingClientRect().bottom) : null; })(), retake: (() => { const b = Array.from(document.querySelectorAll('.guest-capture button')).find(x => x.textContent.trim() === 'Retake'); return b ? Math.round(b.getBoundingClientRect().bottom) : null; })() })`));
        await shot(win, 'guest-review');
        await clickButton(win, '.guest-capture button', 'Finish round');
        await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'ready for next guest', 20000);
        await wait(500);
        const next = await evaluate(win, `({ innerHeight, disc: Math.round(document.querySelector('.guest-capture .capture-disc').getBoundingClientRect().bottom), staleThumbs: document.querySelectorAll('.guest-capture .guest-round-photo').length })`);
        step('guest-reach-next', next);
        if (next.disc > next.innerHeight || next.staleThumbs > 0) throw new Error('Next guest starts with a stale or off-screen state: ' + JSON.stringify(next));
        step('guest-round', { next: 'ready' });
        await wait(500);
        for (const [w, h] of [[1920, 1080], [1280, 720], [800, 1280]]) {
          win.setContentSize(w, h); await wait(600);
          await shot(win, `guest-${w}x${h}`);
          step(`guest-${w}x${h}`, await evaluate(win, `({ overflowX: document.documentElement.scrollWidth > innerWidth, overflowY: document.documentElement.scrollHeight > innerHeight, scrollH: document.documentElement.scrollHeight, buttons: Array.from(document.querySelectorAll('.guest-capture button')).filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0, 30) + '@' + Math.round(b.getBoundingClientRect().height)) })`));
        }
      } else if (phase === 'guest-resume') {
        // Real restart: Guest mode was left active in this profile by an earlier run. No reload, no clicks.
        stage = 'guest resume';
        await waitFor(win, `Boolean(document.querySelector('.guest-capture'))`, 'Guest mode to resume after restart', 15000);
        await wait(1500);
        const resumed = await evaluate(win, `({ guest: Boolean(document.querySelector('.guest-capture')), exitPrompt: Boolean(document.querySelector('.guest-exit-backdrop')), operatorShell: Boolean(document.querySelector('.shell')) })`);
        await shot(win, 'guest-resumed');
        step('guest-resumed', resumed);
        if (!resumed.guest || resumed.exitPrompt || resumed.operatorShell) throw new Error('Guest mode did not resume cleanly: ' + JSON.stringify(resumed));
      } else if (phase === 'guest-sizes') {
        // Guest mode at several screen sizes and in Thai, using Chromium device emulation (the test window itself cannot be resized).
        const lang = process.env.KOKO_QA_LANG || 'th';
        stage = 'guest sizes setup';
        await evaluate(win, `window.koko.saveSettings({ language: '${lang}', highContrast: false, fullscreen: false })`);
        await evaluate(win, `window.koko.setGuestExitPin(null, '718293')`).catch(() => undefined);
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(1000);
        if (!(await evaluate(win, `Boolean(document.querySelector('.guest-capture'))`))) {
          await evaluate(win, `document.querySelector('.brand-button').click()`);
          await wait(800);
          await evaluate(win, `(() => { const b = document.querySelector('.welcome-actions .camera-secondary'); if (b) b.click(); })()`);
        }
        await waitFor(win, `Boolean(document.querySelector('.guest-capture'))`, 'guest mode', 10000);
        await evaluate(win, `(() => { const b = document.querySelector('.guest-exit-backdrop button'); if (b) b.click(); })()`);
        if (process.env.KOKO_QA_CSS) await win.webContents.insertCSS(fs.readFileSync(process.env.KOKO_QA_CSS, 'utf8'));
        // Bottom of the whole shutter block (disc plus its caption), so a clipped caption is caught.
        const discBottom = `Math.round(document.querySelector('.guest-capture .capture-actions').getBoundingClientRect().bottom)`;
        const actionBottoms = `(() => { const bs = Array.from(document.querySelectorAll('.guest-capture .review-actions button')); return bs.map(b => Math.round(b.getBoundingClientRect().bottom)); })()`;
        const results = [];
        for (const [w, h] of [[800, 1280], [1024, 768], [1280, 720], [1366, 768], [1920, 1080]]) {
          stage = `guest ${w}x${h}`;
          win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 }, viewSize: { width: w, height: h }, deviceScaleFactor: 1, scale: 1 });
          await wait(900);
          await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'ready', 20000);
          const ready = await evaluate(win, `(() => { const r = sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }; return { innerWidth, innerHeight, disc: ${discBottom}, overflowX: document.documentElement.scrollWidth > innerWidth, preview: r('.guest-capture .camera-preview'), panel: r('.guest-capture .camera-panel'), left: r('.guest-capture .studio-left'), main: r('.guest-capture'), strip: r('.guest-capture .capture-strip') }; })()`);
          await shot(win, `guest-${lang}-${w}x${h}-ready`);
          await evaluate(win, `document.querySelector('.guest-capture .capture-disc').click()`);
          await waitFor(win, `document.querySelectorAll('.guest-capture .review-actions button').length >= 2`, 'review', 40000);
          await wait(600);
          const review = await evaluate(win, `({ buttons: ${actionBottoms}, innerHeight })`);
          await shot(win, `guest-${lang}-${w}x${h}-review`);
          await evaluate(win, `(() => { const bs = document.querySelectorAll('.guest-capture .review-actions button'); bs[bs.length - 1].click(); })()`);
          await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'ready again', 20000);
          await wait(400);
          const next = await evaluate(win, `({ disc: ${discBottom}, innerHeight })`);
          const entry = { size: `${w}x${h}`, ready, reviewBottoms: review.buttons, next, readyFits: ready.disc <= h, reviewFits: review.buttons.every(b => b <= h), nextFits: next.disc <= h };
          results.push(entry);
          step(`guest-${lang}-${w}x${h}`, entry);
        }
        win.webContents.disableDeviceEmulation();
        report.allFit = results.every(r => r.readyFits && r.reviewFits && r.nextFits && !r.ready.overflowX);
        if (!report.allFit) throw new Error('Guest mode does not fit every tested size: ' + JSON.stringify(results.filter(r => !(r.readyFits && r.reviewFits && r.nextFits && !r.ready.overflowX)).map(r => r.size)));
      } else if (phase === 'guest-multi') {
        // Guest mode with multi-photo templates (4 and 2 photos): the round must take every photo (plus the saved composition image), show the composition, fit the screen and leave the next guest clean.
        stage = 'guest multi setup';
        await evaluate(win, `window.koko.setGuestExitPin(null, '718293')`).catch(() => undefined);
        const mk = (id, count) => ({ id, name: 'QA ' + count, count, title: 'QA title', footer: 'KOKO STUDIO', background: '#171714', frame: '#d6b36a', showDate: true, logo: '', overlay: '', videoOverlay: '', textLayers: [], videoTextLayers: [], imageLayers: [], videoImageLayers: [] });
        const results = [];
        for (const count of [4, 2]) {
          stage = `guest multi ${count}`;
          await evaluate(win, `(() => { localStorage.setItem('koko.saved-templates.v1', JSON.stringify([${JSON.stringify(mk('qa-' + count, count))}])); localStorage.setItem('koko.guest-template.v1', 'qa-${count}'); })()`);
          await win.loadFile(html, { query: { camera: 'simulated' } });
          await wait(1000);
          if (!(await evaluate(win, `Boolean(document.querySelector('.guest-capture'))`))) {
            await evaluate(win, `document.querySelector('.brand-button').click()`);
            await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Start Guest mode')`, 'dashboard', 8000);
            await clickButton(win, 'button', 'Start Guest mode');
            await clickButton(win, 'button', 'Stay in Photobooth');
          }
          await waitFor(win, `Boolean(document.querySelector('.guest-capture'))`, 'guest mode', 10000);
          await evaluate(win, `(() => { const b = document.querySelector('.guest-exit-backdrop button'); if (b) b.click(); })()`);
          for (const [w, h] of [[1280, 720], [800, 1280]]) {
            win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 }, viewSize: { width: w, height: h }, deviceScaleFactor: 1, scale: 1 });
            await wait(900);
            await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'ready', 20000);
            const before = (await evaluate(win, `window.koko.getPhotoStorageStatus()`)).photoCount;
            await evaluate(win, `document.querySelector('.guest-capture .capture-disc').click()`);
            await waitFor(win, `document.querySelectorAll('.guest-capture .review-actions button').length >= 2`, 'review', 90000);
            await wait(1500);
            const review = await evaluate(win, `({ innerHeight, thumbs: document.querySelectorAll('.guest-capture .guest-round-photo').length, composition: Boolean(document.querySelector('.guest-capture .guest-composition img')), overflowX: document.documentElement.scrollWidth > innerWidth, buttons: Array.from(document.querySelectorAll('.guest-capture .review-actions button')).map(b => Math.round(b.getBoundingClientRect().bottom)) })`);
            await shot(win, `guest-multi-${count}-${w}x${h}-review`);
            await evaluate(win, `(() => { const bs = document.querySelectorAll('.guest-capture .review-actions button'); bs[bs.length - 1].click(); })()`);
            await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'ready again', 20000);
            await wait(500);
            const after = (await evaluate(win, `window.koko.getPhotoStorageStatus()`)).photoCount;
            const stale = await evaluate(win, `document.querySelectorAll('.guest-capture .guest-round-photo').length`);
            const entry = { count, size: `${w}x${h}`, review, photosAdded: after - before, stale, ok: review.thumbs === count && review.composition && !review.overflowX && review.buttons.every(b => b <= h) && after - before === count + 1 && stale === 0 };
            results.push(entry); step(`guest-multi-${count}-${w}x${h}`, entry);
          }
          win.webContents.disableDeviceEmulation();
        }
        await evaluate(win, `localStorage.removeItem('koko.saved-templates.v1'); localStorage.removeItem('koko.guest-template.v1')`);
        report.allOk = results.every(r => r.ok);
        if (!report.allOk) throw new Error('Guest multi-photo round failed: ' + JSON.stringify(results.filter(r => !r.ok)));
      } else if (phase === 'video') {
        // Operator-side video clip with the simulated camera: record a 5s clip, review it, finish the round and check the stored WebM.
        const hasText = text => `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`;
        stage = 'video prepare';
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(800);
        await clickButton(win, '.sidebar nav button', 'Capture');
        await waitFor(win, hasText('Start live preview'), 'preview button');
        await clickButton(win, 'button', 'Start live preview');
        await waitFor(win, `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled)`, 'capture ready', 20000);
        await clickButton(win, '.countdown-options button', 'OFF');
        await clickButton(win, '[aria-label="Choose photo or video"] button', 'Video');
        await waitFor(win, `Boolean(document.querySelector('[aria-label="Choose video length"]'))`, 'video options', 5000);
        await clickButton(win, '[aria-label="Choose video length"] button', '5s');
        const mic = await evaluate(win, `(() => { const c = document.querySelector('.audio-toggle input'); if (c && c.checked) c.click(); return c ? c.checked : null; })()`);
        step('video-options', { micOff: mic === false });
        const before = await evaluate(win, `window.koko.listCaptureSessions(200, 0)`);
        stage = 'video record';
        const started = Date.now();
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, hasText('Finish round'), 'video review', 40000);
        const elapsed = Date.now() - started;
        await shot(win, 'video-review');
        const reviewInfo = await evaluate(win, `({ video: Boolean(document.querySelector('video[controls], .review-video, .capture-review video')), text: document.body.innerText.slice(0, 300) })`);
        await clickButton(win, 'button', 'Finish round');
        await waitFor(win, `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled) && !(${hasText('Finish round')})`, 'ready after finish', 20000);
        stage = 'video verify';
        const after = await evaluate(win, `window.koko.listCaptureSessions(200, 0)`);
        const session = after[0];
        const ids = session?.videoIds ?? [];
        let clip = null;
        if (ids.length) clip = await evaluate(win, `(async () => { const r = await window.koko.readVideo(${JSON.stringify(ids[0])}); const b = r.webmBytes; return { bytes: b.length, magic: Array.from(b.slice(0, 4)).map(x => x.toString(16)).join(''), durationMs: r.video.durationMs, width: r.video.width, height: r.video.height, mime: r.video.mimeType }; })()`);
        const entry = { elapsedMs: elapsed, sessionsAdded: after.length - before.length, status: session?.status, videoIds: ids.length, photoIds: (session?.photoIds ?? []).length, clip, reviewInfo };
        step('video-clip', entry);
        const ok = after.length === before.length + 1 && session.status === 'confirmed' && ids.length === 1 && clip && clip.magic === '1a45dfa3' && clip.bytes > 5000 && clip.durationMs >= 4000 && clip.durationMs <= 8000;
        report.videoOk = Boolean(ok);
        if (!ok) throw new Error('Video round failed: ' + JSON.stringify(entry));
      } else if (phase === 'guest-video') {
        // Guest mode with a video-clip template: the guest just taps the shutter, gets a clip to review, and the stored file is a valid WebM.
        stage = 'guest video setup';
        await evaluate(win, `window.koko.setGuestExitPin(null, '718293')`).catch(() => undefined);
        const tpl = { id: 'qa-video', name: 'QA video', count: 1, mediaMode: 'video', title: 'QA', footer: 'KOKO STUDIO', background: '#171714', frame: '#d6b36a', showDate: true, logo: '', overlay: '', videoOverlay: '', textLayers: [], videoTextLayers: [], imageLayers: [], videoImageLayers: [] };
        await evaluate(win, `(() => { localStorage.setItem('koko.saved-templates.v1', JSON.stringify([${JSON.stringify(tpl)}])); localStorage.setItem('koko.guest-template.v1', 'qa-video'); })()`);
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(1000);
        if (!(await evaluate(win, `Boolean(document.querySelector('.guest-capture'))`))) {
          await evaluate(win, `document.querySelector('.brand-button').click()`);
          await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Start Guest mode')`, 'dashboard', 8000);
          await clickButton(win, 'button', 'Start Guest mode');
          await clickButton(win, 'button', 'Stay in Photobooth');
        }
        await waitFor(win, `Boolean(document.querySelector('.guest-capture'))`, 'guest mode', 10000);
        await evaluate(win, `(() => { const b = document.querySelector('.guest-exit-backdrop button'); if (b) b.click(); })()`);
        const results = [];
        for (const [w, h] of [[1280, 720], [800, 1280]]) {
          stage = `guest video ${w}x${h}`;
          win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 }, viewSize: { width: w, height: h }, deviceScaleFactor: 1, scale: 1 });
          await wait(900);
          await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'ready', 20000);
          const sessionsBefore = (await evaluate(win, `window.koko.listCaptureSessions(200, 0)`)).length;
          await evaluate(win, `document.querySelector('.guest-capture .capture-disc').click()`);
          await waitFor(win, `document.querySelectorAll('.guest-capture .review-actions button').length >= 2`, 'review', 60000);
          await wait(1000);
          const review = await evaluate(win, `({ innerHeight, clipShown: Boolean(document.querySelector('.guest-capture .guest-composition video')), overflowX: document.documentElement.scrollWidth > innerWidth, buttons: Array.from(document.querySelectorAll('.guest-capture .review-actions button')).map(b => Math.round(b.getBoundingClientRect().bottom)) })`);
          await shot(win, `guest-video-${w}x${h}-review`);
          await evaluate(win, `(() => { const bs = document.querySelectorAll('.guest-capture .review-actions button'); bs[bs.length - 1].click(); })()`);
          await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'ready again', 20000);
          await wait(500);
          const sessions = await evaluate(win, `window.koko.listCaptureSessions(200, 0)`);
          const ids = sessions[0]?.videoIds ?? [];
          let clip = null;
          if (ids.length) clip = await evaluate(win, `(async () => { const r = await window.koko.readVideo(${JSON.stringify(ids[0])}); const b = r.webmBytes; return { bytes: b.length, magic: Array.from(b.slice(0, 4)).map(x => x.toString(16)).join(''), durationMs: r.video.durationMs }; })()`);
          const stale = await evaluate(win, `document.querySelectorAll('.guest-capture .guest-round-photo, .guest-capture .guest-composition').length`);
          const entry = { size: `${w}x${h}`, review, sessionsAdded: sessions.length - sessionsBefore, status: sessions[0]?.status, videos: ids.length, clip, stale, ok: review.clipShown && !review.overflowX && review.buttons.every(b => b <= h) && sessions.length - sessionsBefore === 1 && sessions[0]?.status === 'confirmed' && ids.length === 1 && clip && clip.magic === '1a45dfa3' && clip.bytes > 5000 && clip.durationMs >= 8000 && clip.durationMs <= 14000 && stale === 0 };
          results.push(entry); step(`guest-video-${w}x${h}`, entry);
        }
        win.webContents.disableDeviceEmulation();
        await evaluate(win, `localStorage.removeItem('koko.saved-templates.v1'); localStorage.removeItem('koko.guest-template.v1')`);
        report.allOk = results.every(r => r.ok);
        if (!report.allOk) throw new Error('Guest video round failed: ' + JSON.stringify(results.filter(r => !r.ok)));
      } else if (phase === 'kill-mid-round') {
        // Starts a 4-photo round and hard-kills the whole process once two photos are on disk. Run `after-kill` on the same profile next.
        const hasText = text => `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`;
        stage = 'kill prepare';
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(800);
        await clickButton(win, '.sidebar nav button', 'Capture');
        await waitFor(win, hasText('Start live preview'), 'preview button');
        await clickButton(win, 'button', 'Start live preview');
        await waitFor(win, `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled)`, 'capture ready', 20000);
        await clickButton(win, '.countdown-options button', 'OFF');
        await clickCount(win, 4);
        const photosBefore = (await evaluate(win, `window.koko.getPhotoStorageStatus()`)).photoCount;
        const sessionsBefore = (await evaluate(win, `window.koko.listCaptureSessions(200, 0)`)).length;
        stage = 'kill mid round';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        let seen = 0;
        for (let i = 0; i < 200 && seen < photosBefore + Number(process.env.KOKO_QA_KILL_AFTER || 2); i++) { seen = (await evaluate(win, `window.koko.getPhotoStorageStatus()`)).photoCount; if (seen < photosBefore + Number(process.env.KOKO_QA_KILL_AFTER || 2)) await wait(25); }
        report.killed = { photosBefore, sessionsBefore, photosAtKill: seen };
        fs.writeFileSync(path.join(output, 'kill-state.json'), JSON.stringify(report.killed));
        fs.writeFileSync(path.join(output, 'report-kill-mid-round.json'), JSON.stringify(report, null, 2));
        console.log('KILLING at', JSON.stringify(report.killed));
        process.kill(process.pid, 'SIGKILL');
      } else if (phase === 'after-kill') {
        stage = 'after kill';
        const state = JSON.parse(fs.readFileSync(path.join(output, 'kill-state.json'), 'utf8'));
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(1500);
        const sessions = await evaluate(win, `window.koko.listCaptureSessions(200, 0)`);
        const status = await evaluate(win, `window.koko.getPhotoStorageStatus()`);
        const issues = await evaluate(win, `window.koko.inspectPhotoRecovery()`);
        const killed = sessions[0];
        const photos = await evaluate(win, `window.koko.listPhotos(0, 100)`);
        const stored = new Set(photos.map(p => p.id));
        const missing = (killed?.photoIds ?? []).filter(id => !stored.has(id));
        step('after-kill', { sessionsAdded: sessions.length - state.sessionsBefore, killedStatus: killed?.status, sessionPhotos: (killed?.photoIds ?? []).length, photoCount: status.photoCount, photosAtKill: state.photosAtKill, pendingRecovery: status.pendingRecovery, issues, missing });
        // The app must still work: take a normal 1-photo round and finish it.
        const hasText = text => `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`;
        await clickButton(win, '.sidebar nav button', 'Capture');
        await waitFor(win, hasText('Start live preview'), 'preview button');
        await clickButton(win, 'button', 'Start live preview');
        await waitFor(win, `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled)`, 'capture ready', 20000);
        await clickButton(win, '.countdown-options button', 'OFF');
        await clickCount(win, 1);
        stage = 'round after kill';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, hasText('Finish round'), 'review after kill', 30000);
        await clickButton(win, 'button', 'Finish round');
        await waitFor(win, `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled) && !(${hasText('Finish round')})`, 'ready after finish', 20000);
        const after = await evaluate(win, `window.koko.listCaptureSessions(200, 0)`);
        const finalStatus = await evaluate(win, `window.koko.getPhotoStorageStatus()`);
        const bad = issues.filter(i => ['invalid-index', 'missing-photo', 'storage-unavailable'].includes(i.kind));
        const ok = ['interrupted', 'review'].includes(killed?.status) && sessions.length - state.sessionsBefore === 1 && missing.length === 0 && bad.length === 0
          && (killed.photoIds.length >= 1 && killed.photoIds.length <= 4) && status.photoCount >= state.photosBefore + killed.photoIds.length
          && after[0]?.status === 'confirmed' && after.length === sessions.length + 1 && finalStatus.photoCount === status.photoCount + 1 && finalStatus.pendingRecovery === status.pendingRecovery;
        step('round-after-kill', { latestStatus: after[0]?.status, sessions: after.length, photos: finalStatus.photoCount, ok });
        report.killOk = ok;
        if (!ok) throw new Error('State after a mid-round kill is not clean');
      } else if (phase === 'disk-full') {
        // Simulated full disk: photo-byte writes fail with ENOSPC (after writing half the bytes, like a real full volume) once armed.
        const hasText = text => `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`;
        const bodyHas = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
        const readyJs = `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled) && !(${hasText('Finish round')})`;
        const inspect = async () => {
          const status = await evaluate(win, `window.koko.getPhotoStorageStatus()`);
          const issues = await evaluate(win, `window.koko.inspectPhotoRecovery()`);
          return { photos: status.photoCount, pending: status.pendingRecovery, issues };
        };
        stage = 'disk-full prepare';
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(800);
        await clickButton(win, '.sidebar nav button', 'Capture');
        await waitFor(win, hasText('Start live preview'), 'preview button');
        await clickButton(win, 'button', 'Start live preview');
        await waitFor(win, readyJs, 'capture ready', 20000);
        await clickButton(win, '.countdown-options button', 'OFF');
        const results = {};
        // 1) Disk already full: the first photo cannot be saved.
        await clickCount(win, 1);
        const base = await inspect();
        fdWrites = 0; failMode = 'all'; fullAfter = 0;
        stage = 'disk-full first photo';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, bodyHas('storage disk is full'), 'free-space message', 30000);
        await wait(1500);
        fullAfter = Infinity;
        const afterFail = await inspect();
        const sessionsA = await evaluate(win, `window.koko.listCaptureSessions(5, 0)`);
        await shot(win, 'disk-full-first');
        let stuck = !(await evaluate(win, readyJs)) && !(await evaluate(win, hasText('Finish round')));
        results.first = { base, afterFail, latest: sessionsA[0] && { status: sessionsA[0].status, photos: sessionsA[0].photoIds.length }, stuck };
        step('disk-full-first', results.first);
        if (await evaluate(win, hasText('Finish round'))) await clickButton(win, 'button', 'Finish round');
        await waitFor(win, readyJs, 'ready after full-disk failure', 20000);
        // 2) The disk fills up after two photos of a 4-photo round.
        await clickCount(win, 4);
        const base2 = await inspect();
        fdWrites = 0; failMode = 'bytes'; fullAfter = 1;
        stage = 'disk-full mid round';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, `${bodyHas('storage disk is full')} || ${hasText('Finish round')}`, 'review or free-space message mid round', 40000);
        await wait(1500);
        fullAfter = Infinity;
        const afterMid = await inspect();
        const sessionsB = await evaluate(win, `window.koko.listCaptureSessions(5, 0)`);
        await shot(win, 'disk-full-mid');
        const midLatest = sessionsB[0];
        const unreadable = [];
        for (const id of midLatest?.photoIds ?? []) { try { await evaluate(win, `window.koko.readPhoto(${JSON.stringify(id)}).then(r => r.jpegBytes.length)`); } catch { unreadable.push(id); } }
        const messageShown = await evaluate(win, bodyHas('storage disk is full'));
        const screenText = await evaluate(win, `document.body.innerText.replace(/\s+/g, ' ')`);
        const midUi = { screenTail: screenText.slice(screenText.indexOf('CAPTURE STRIP')), messageShown, finishVisible: await evaluate(win, hasText('Finish round')), retakeVisible: await evaluate(win, hasText('Retake')), ready: await evaluate(win, readyJs) };
        results.mid = { base2, afterMid, latest: midLatest && { status: midLatest.status, photos: midLatest.photoIds.length }, unreadable, ui: midUi };
        step('disk-full-mid', results.mid);
        if (midUi.finishVisible) await clickButton(win, 'button', 'Finish round');
        await waitFor(win, readyJs, 'ready after mid-round failure', 20000);
        // 3) Space is freed: a normal round works again.
        await clickCount(win, 1);
        const base3 = await inspect();
        stage = 'disk-full recovered round';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, hasText('Finish round'), 'review after freeing space', 30000);
        await clickButton(win, 'button', 'Finish round');
        await waitFor(win, readyJs, 'ready after recovered round', 20000);
        const end = await inspect();
        const latest = (await evaluate(win, `window.koko.listCaptureSessions(5, 0)`))[0];
        results.recovered = { base3, end, status: latest?.status };
        step('disk-full-recovered', results.recovered);
        const badKinds = list => list.filter(i => ['invalid-index', 'missing-photo', 'storage-unavailable', 'incomplete-write'].includes(i.kind));
        const ok = afterFail.photos === base.photos && afterFail.pending === 0 && !badKinds(afterFail.issues).length && !stuck
          && afterMid.pending === 0 && !badKinds(afterMid.issues).length && unreadable.length === 0 && (midLatest?.photoIds.length ?? 0) === 1 && afterMid.photos === base2.photos + 1 && midUi.messageShown
          && end.photos === base3.photos + 1 && end.pending === 0 && !badKinds(end.issues).length && latest?.status === 'confirmed';
        report.diskFullOk = ok;
        if (!ok) throw new Error('Full-disk handling is not clean: ' + JSON.stringify(results));
      } else if (phase === 'guest-disk-full') {
        // Guest mode, 2-photo template: the disk fills up before the second photo. The guest must be told the round is incomplete, still be able to finish, and the next round must work.
        stage = 'guest disk-full setup';
        await evaluate(win, `window.koko.setGuestExitPin(null, '718293')`).catch(() => undefined);
        const tpl = { id: 'qa-2', name: 'QA 2', count: 2, title: 'QA', footer: 'KOKO STUDIO', background: '#171714', frame: '#d6b36a', showDate: true, logo: '', overlay: '', videoOverlay: '', textLayers: [], videoTextLayers: [], imageLayers: [], videoImageLayers: [] };
        await evaluate(win, `(() => { localStorage.setItem('koko.saved-templates.v1', JSON.stringify([${JSON.stringify(tpl)}])); localStorage.setItem('koko.guest-template.v1', 'qa-2'); })()`);
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(1000);
        if (!(await evaluate(win, `Boolean(document.querySelector('.guest-capture'))`))) {
          await evaluate(win, `document.querySelector('.brand-button').click()`);
          await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Start Guest mode')`, 'dashboard', 8000);
          await clickButton(win, 'button', 'Start Guest mode');
          await clickButton(win, 'button', 'Stay in Photobooth');
        }
        await waitFor(win, `Boolean(document.querySelector('.guest-capture'))`, 'guest mode', 10000);
        await evaluate(win, `(() => { const b = document.querySelector('.guest-exit-backdrop button'); if (b) b.click(); })()`);
        const readyJs = `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`;
        const results = [];
        for (const [w, h] of [[1280, 720], [800, 1280]]) {
          stage = `guest disk-full ${w}x${h}`;
          win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 }, viewSize: { width: w, height: h }, deviceScaleFactor: 1, scale: 1 });
          await wait(900);
          await waitFor(win, readyJs, 'ready', 20000);
          // Round A: the second photo cannot be saved.
          fdWrites = 0; failMode = 'bytes'; fullAfter = 1;
          await evaluate(win, `document.querySelector('.guest-capture .capture-disc').click()`);
          await waitFor(win, `document.querySelectorAll('.guest-capture .review-actions button').length >= 2`, 'review of incomplete round', 60000);
          await wait(1000);
          fullAfter = Infinity;
          const warn = await evaluate(win, `({ warning: Boolean(document.querySelector('.guest-capture .guest-review-warning')), innerHeight, overflowX: document.documentElement.scrollWidth > innerWidth, thumbs: document.querySelectorAll('.guest-capture .guest-round-photo').length, buttons: Array.from(document.querySelectorAll('.guest-capture .review-actions button')).map(b => Math.round(b.getBoundingClientRect().bottom)) })`);
          await shot(win, `guest-disk-full-${w}x${h}-review`);
          await evaluate(win, `(() => { const bs = document.querySelectorAll('.guest-capture .review-actions button'); bs[bs.length - 1].click(); })()`);
          await waitFor(win, readyJs, 'ready after incomplete round', 20000);
          await wait(500);
          const incomplete = (await evaluate(win, `window.koko.listCaptureSessions(5, 0)`))[0];
          const noWarningAfter = !(await evaluate(win, `Boolean(document.querySelector('.guest-capture .guest-review-warning'))`));
          // Round B: space is back, the round is complete and shows no warning.
          await evaluate(win, `document.querySelector('.guest-capture .capture-disc').click()`);
          await waitFor(win, `document.querySelectorAll('.guest-capture .review-actions button').length >= 2`, 'review of full round', 60000);
          await wait(1000);
          const full = await evaluate(win, `({ warning: Boolean(document.querySelector('.guest-capture .guest-review-warning')), thumbs: document.querySelectorAll('.guest-capture .guest-round-photo').length, composition: Boolean(document.querySelector('.guest-capture .guest-composition img')) })`);
          await evaluate(win, `(() => { const bs = document.querySelectorAll('.guest-capture .review-actions button'); bs[bs.length - 1].click(); })()`);
          await waitFor(win, readyJs, 'ready after full round', 20000);
          const entry = { size: `${w}x${h}`, warn, incompleteStatus: incomplete?.status, incompletePhotos: incomplete?.photoIds.length, noWarningAfter, full,
            ok: warn.warning && warn.thumbs === 1 && !warn.overflowX && warn.buttons.every(b => b <= h) && incomplete?.status === 'confirmed' && incomplete.photoIds.length === 1 && noWarningAfter && !full.warning && full.thumbs === 2 && full.composition };
          results.push(entry); step(`guest-disk-full-${w}x${h}`, entry);
        }
        win.webContents.disableDeviceEmulation();
        await evaluate(win, `localStorage.removeItem('koko.saved-templates.v1'); localStorage.removeItem('koko.guest-template.v1')`);
        report.allOk = results.every(r => r.ok);
        if (!report.allOk) throw new Error('Guest full-disk round failed: ' + JSON.stringify(results.filter(r => !r.ok)));
      } else if (phase === 'cloud') {
        // Paid plan with online albums against the local License/Photo-cloud server: QR + private album link in the operator review and in Guest mode, and the uploaded photo is really on the server.
        const key = process.env.KOKO_QA_LICENSE_KEY;
        if (!key) throw new Error('Set KOKO_QA_LICENSE_KEY to a paid-plan key issued by the local server');
        const hasText = text => `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`;
        const readyJs = `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled) && !(${hasText('Finish round')})`;
        stage = 'cloud setup';
        await evaluate(win, `window.koko.saveSettings({ language: 'en', highContrast: false, fullscreen: false })`);
        const license = await evaluate(win, `window.koko.activateLicense(${JSON.stringify(key)})`);
        step('license', { state: license.state, features: license.features });
        if (license.state !== 'active' || !license.features.includes('cloud_sync')) throw new Error('Paid key did not activate with cloud_sync: ' + JSON.stringify(license));
        await evaluate(win, `window.koko.choosePhotoStorage()`);
        const event = await evaluate(win, `window.koko.createEvent({ name: 'Cloud QA event', date: null, notes: '' })`);
        await evaluate(win, `window.koko.setActiveEvent(${JSON.stringify(event.id)})`);
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(800);
        await clickButton(win, '.sidebar nav button', 'Capture');
        await waitFor(win, hasText('Start live preview'), 'preview button', 15000);
        await clickButton(win, 'button', 'Start live preview');
        await waitFor(win, readyJs, 'capture ready', 20000);
        await clickButton(win, '.countdown-options button', 'OFF');
        await clickCount(win, 1);
        stage = 'cloud operator round';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, hasText('Finish round'), 'review', 30000);
        try { await waitFor(win, `Boolean(document.querySelector('.photo-cloud-share .private-album-qr img'))`, 'album QR in operator review', 40000); } catch (error) { throw new Error(error.message + ' | cloud note: ' + (await evaluate(win, `(document.querySelector('.photo-cloud-share') || {}).innerText || '(no cloud block)'`))); }
        const op = await evaluate(win, `(() => { const img = document.querySelector('.photo-cloud-share .private-album-qr img'); return { text: document.querySelector('.photo-cloud-share').innerText, qrLoaded: Boolean(img && img.complete && img.naturalWidth > 20), qrSrcIsData: /^data:image/.test(img ? img.src : ''), copyButton: Array.from(document.querySelectorAll('.photo-cloud-share button')).some(b => /Copy private album link/.test(b.textContent)) }; })()`);
        await shot(win, 'cloud-operator-review');
        await clickButton(win, 'button', 'Finish round');
        await waitFor(win, readyJs, 'ready after finish', 20000);
        const session = (await evaluate(win, `window.koko.listCaptureSessions(1, 0)`))[0];
        const sync = await evaluate(win, `window.koko.syncPhotoCloudSession(${JSON.stringify(session.id)})`);
        step('cloud-account', { shareIsMockLink: sync.shareUrl === cloudMock.shareUrls[0], uploadedCount: sync.uploadedCount, mediaCount: sync.mediaCount, events: cloudMock.events, puts: cloudMock.puts, confirms: cloudMock.confirms, shares: cloudMock.shares, putBytes: cloudMock.putBytes });
        const opOk = op.qrLoaded && op.qrSrcIsData && op.copyButton && /uploaded to its private album/.test(op.text);
        const serverOk = Boolean(sync.shareUrl) && sync.shareUrl === cloudMock.shareUrls[0] && sync.uploadedCount === sync.mediaCount && sync.mediaCount === 1 && cloudMock.puts === 1 && cloudMock.confirms === 1 && cloudMock.events === 1 && cloudMock.putBytes > 1000;
        // The cloud is down: the round must still finish locally, say the upload is incomplete, and Retry upload must recover once it is back.
        stage = 'cloud down then retry';
        cloudMode = 'down';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, hasText('Finish round'), 'review while cloud down', 30000);
        await waitFor(win, `/cloud upload is incomplete/.test((document.querySelector('.photo-cloud-share') || {}).innerText || '')`, 'incomplete notice', 40000);
        const downState = await evaluate(win, `({ qr: Boolean(document.querySelector('.photo-cloud-share .private-album-qr')), retry: Array.from(document.querySelectorAll('.photo-cloud-share button')).some(b => /Retry upload/.test(b.textContent)), saved: document.body.innerText.includes('saved') })`);
        await shot(win, 'cloud-down-review');
        cloudMode = 'ok';
        await clickButton(win, '.photo-cloud-share button', 'Retry upload');
        await waitFor(win, `Boolean(document.querySelector('.photo-cloud-share .private-album-qr img'))`, 'QR after retry', 40000);
        const afterRetry = await evaluate(win, `({ text: document.querySelector('.photo-cloud-share').innerText })`);
        await clickButton(win, 'button', 'Finish round');
        await waitFor(win, readyJs, 'ready after retry round', 20000);
        const retryOk = !downState.qr && downState.retry && /uploaded to its private album/.test(afterRetry.text) && cloudMock.puts === 2 && cloudMock.confirms === 2;
        step('cloud-retry', { downState, afterRetry: afterRetry.text.slice(0, 80), puts: cloudMock.puts, confirms: cloudMock.confirms, retryOk });
        step('cloud-operator', { ...op, opOk, serverOk });
        // Guest mode: the QR is what the guest scans.
        stage = 'cloud guest round';
        await evaluate(win, `window.koko.setGuestExitPin(null, '718293')`).catch(() => undefined);
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(1000);
        await evaluate(win, `document.querySelector('.brand-button').click()`);
        await waitFor(win, hasText('Start Guest mode'), 'dashboard', 8000);
        await clickButton(win, 'button', 'Start Guest mode');
        await clickButton(win, 'button', 'Stay in Photobooth');
        await waitFor(win, `Boolean(document.querySelector('.guest-capture'))`, 'guest mode', 10000);
        const guestResults = [];
        for (const [w, h] of [[1280, 720], [800, 1280]]) {
          win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 }, viewSize: { width: w, height: h }, deviceScaleFactor: 1, scale: 1 });
          await wait(900);
          await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'guest ready', 20000);
          await evaluate(win, `document.querySelector('.guest-capture .capture-disc').click()`);
          await waitFor(win, `document.querySelectorAll('.guest-capture .review-actions button').length >= 2`, 'guest review', 40000);
          await waitFor(win, `Boolean(document.querySelector('.guest-capture .private-album-qr img'))`, 'guest QR', 40000);
          await wait(800);
          const g = await evaluate(win, `(() => { const img = document.querySelector('.guest-capture .private-album-qr img'); const r = img.getBoundingClientRect(); const buttons = Array.from(document.querySelectorAll('.guest-capture .review-actions button')).map(b => Math.round(b.getBoundingClientRect().bottom)); const bar = document.querySelector('.guest-capture .review-feedback').getBoundingClientRect(); return { innerHeight, qrLoaded: img.complete && img.naturalWidth > 20, qrSize: [Math.round(r.width), Math.round(r.height)], qrTop: Math.round(r.top), qrBottom: Math.round(r.bottom), barTop: Math.round(bar.top), buttons, overflowX: document.documentElement.scrollWidth > innerWidth }; })()`);
          await shot(win, `cloud-guest-${w}x${h}-review`);
          await evaluate(win, `(() => { const bs = document.querySelectorAll('.guest-capture .review-actions button'); bs[bs.length - 1].click(); })()`);
          await waitFor(win, `Boolean(document.querySelector('.guest-capture .capture-disc') && !document.querySelector('.guest-capture .capture-disc').disabled)`, 'guest ready again', 20000);
          const stale = await evaluate(win, `document.querySelectorAll('.guest-capture .private-album-qr').length`);
          const entry = { size: `${w}x${h}`, ...g, stale, ok: g.qrLoaded && g.qrSize[0] >= 100 && g.qrBottom <= g.innerHeight && g.qrTop >= 0 && !g.overflowX && g.buttons.every(b => b <= h) && stale === 0 };
          guestResults.push(entry); step(`cloud-guest-${w}x${h}`, entry);
        }
        win.webContents.disableDeviceEmulation();
        report.cloudOk = opOk && serverOk && retryOk && guestResults.every(r => r.ok);
        if (!report.cloudOk) throw new Error('Cloud album check failed: ' + JSON.stringify({ opOk, serverOk, retryOk, guestResults }));
      } else if (phase === 'summary') {
        // The per-event Summary on the Events page must match what the stored capture sessions say (counts computed here independently of the app's own code).
        stage = 'summary';
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(1000);
        await clickButton(win, '.sidebar nav button', 'Events');
        await waitFor(win, `Boolean(document.querySelector('.event-card'))`, 'event card', 10000);
        const eventsList = (await evaluate(win, `window.koko.listEvents()`)).events;
        const target = eventsList.find(item => item.name === 'Simulated QA event') || eventsList[0];
        const all = [];
        for (let offset = 0; ; offset += 100) { const page = await evaluate(win, `window.koko.listCaptureSessions(100, ${offset})`); all.push(...page); if (page.length < 100) break; }
        const own = all.filter(item => item.eventId === target.id);
        const count = status => own.filter(item => item.status === status).length;
        const confirmed = own.filter(item => item.status === 'confirmed');
        const expected = { confirmed: confirmed.length, rounds: own.length, photos: confirmed.reduce((sum, item) => sum + item.photoIds.length, 0), videos: confirmed.reduce((sum, item) => sum + (item.videoIds || []).length, 0), retaken: count('retaken'), cancelled: count('cancelled') };
        expected.unfinished = own.length - expected.confirmed - expected.retaken - expected.cancelled;
        const clicked = await evaluate(win, `(() => { const card = Array.from(document.querySelectorAll('.event-card')).find(c => c.querySelector('h3') && c.querySelector('h3').textContent.trim() === ${JSON.stringify(target.name)}); const b = card && Array.from(card.querySelectorAll('button')).find(x => x.textContent.trim() === 'Summary'); if (b) b.click(); return Boolean(b); })()`);
        if (!clicked) throw new Error('Summary button not found');
        await waitFor(win, `Boolean(document.querySelector('.event-summary'))`, 'summary block', 10000);
        const shown = await evaluate(win, `(() => { const rows = Object.fromEntries(Array.from(document.querySelectorAll('.event-summary > div')).map(d => [d.querySelector('dt').textContent.trim(), d.querySelector('dd').textContent.trim()])); return { rows, overflowX: document.documentElement.scrollWidth > innerWidth }; })()`);
        await shot(win, 'event-summary');
        const rows = shown.rows;
        const actual = { completed: rows['Completed rounds'], photos: rows['Photos / clips'], other: rows['Retaken / cancelled / unfinished'] };
        const want = { completed: `${expected.confirmed} / ${expected.rounds}`, photos: `${expected.photos} / ${expected.videos}`, other: `${expected.retaken} / ${expected.cancelled} / ${expected.unfinished}` };
        const ok = actual.completed === want.completed && actual.photos === want.photos && actual.other === want.other && !shown.overflowX;
        step('event-summary', { actual, want, rowsShown: Object.keys(rows), overflowX: shown.overflowX, ok });
        report.summaryOk = ok;
        if (!ok) throw new Error('Event summary does not match stored sessions: ' + JSON.stringify({ actual, want }));
      } else if (phase === 'rounds') {
        const rounds = Number(process.env.KOKO_QA_ROUNDS || 100);
        const hasText = text => `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)})`;
        const ready = `Boolean(document.querySelector('.capture-disc') && !document.querySelector('.capture-disc').disabled) && !(${hasText('Finish round')})`;
        const before = await evaluate(win, `window.koko.listCaptureSessions(200, 0)`);
        const photosBefore = (await evaluate(win, `window.koko.getPhotoStorageStatus()`)).photoCount;
        stage = 'prepare capture page';
        await win.loadFile(html, { query: { camera: 'simulated' } });
        await wait(800);
        await clickButton(win, '.sidebar nav button', 'Capture');
        await waitFor(win, hasText('Start live preview'), 'preview button');
        await clickButton(win, 'button', 'Start live preview');
        await waitFor(win, ready, 'capture ready', 20000);
        await clickButton(win, '.countdown-options button', 'OFF');
        const captureRound = async label => {
          stage = label;
          await evaluate(win, `document.querySelector('.capture-disc').click()`);
          await waitFor(win, hasText('Finish round'), `review (${label})`, 30000);
        };
        const finishRound = async () => { await clickButton(win, 'button', 'Finish round'); await waitFor(win, ready, 'ready after finish', 20000); };
        // 4-photo round
        await clickCount(win, 4);
        if (!(await evaluate(win, `document.querySelector('[aria-pressed="true"][class="selected"]') !== null`))) throw new Error('Photo count buttons not found');
        await captureRound('4-photo round');
        await finishRound();
        // retake: first take is discarded, the second take is confirmed
        await clickCount(win, 2);
        await captureRound('retake first take');
        await clickButton(win, 'button', 'Retake');
        await wait(600);
        await waitFor(win, hasText('Finish round'), 'review after retake', 30000);
        await finishRound();
        // cancel during countdown
        await clickCount(win, 1);
        await clickButton(win, '.countdown-options button', '3s');
        stage = 'cancel during countdown';
        await evaluate(win, `document.querySelector('.capture-disc').click()`);
        await waitFor(win, hasText('Cancel session') || `Array.from(document.querySelectorAll('.cancel-session')).length > 0`, 'cancel button', 8000);
        await evaluate(win, `document.querySelector('.cancel-session').click()`);
        await waitFor(win, ready, 'ready after cancel', 20000);
        await clickButton(win, '.countdown-options button', 'OFF');
        // consecutive single-photo rounds
        for (let i = 0; i < rounds; i++) { await captureRound(`round ${i + 1}/${rounds}`); await finishRound(); }
        stage = 'tally';
        const sessions = await evaluate(win, `window.koko.listCaptureSessions(200, 0)`);
        const added = sessions.length - before.length;
        const tally = sessions.reduce((all, s) => ({ ...all, [s.status]: (all[s.status] || 0) + 1 }), {});
        const status = await evaluate(win, `window.koko.getPhotoStorageStatus()`);
        const recovery = await evaluate(win, `window.koko.inspectPhotoRecovery()`);
        step('rounds', { perSession: sessions.slice(0, added).reverse().slice(0, 4).map(s => [s.status, s.photoIds.length]), requested: rounds, sessionsAdded: added, tally, photosAdded: status.photoCount - photosBefore, photoCount: status.photoCount, pendingRecovery: status.pendingRecovery, recoveryIssues: recovery.length });
        const confirmedAdded = (tally.confirmed || 0) - before.filter(s => s.status === 'confirmed').length;
        if (confirmedAdded !== rounds + 2) throw new Error(`Expected ${rounds + 2} new confirmed sessions, got ${confirmedAdded}`);
        if (status.pendingRecovery !== 0 || recovery.length !== 0) throw new Error('Photo storage needs recovery after the rounds');
      } else {
        stage = 'recovery after restart';
        const sessions = await evaluate(win, `window.koko.listCaptureSessions(10, 0)`);
        const status = await evaluate(win, `window.koko.getPhotoStorageStatus()`);
        const jobs = await evaluate(win, `window.koko.listPrintJobs()`);
        const license = await evaluate(win, `window.koko.getLicenseStatus ? window.koko.getLicenseStatus() : null`);
        step('after-restart', { sessions: sessions.length, latestStatus: sessions[0]?.status, photos: status.photoCount, pendingRecovery: status.pendingRecovery, printJobs: jobs.length, printStatus: jobs[0]?.status, license: license?.state });
        if (!sessions.length || sessions[0].status !== 'confirmed' || status.photoCount < 1 || status.pendingRecovery !== 0 || !jobs.length) throw new Error('State was not recovered after restart');
      }
      report.ok = report.rendererErrors.length === 0;
      finish(report.ok ? 0 : 1);
    } catch (error) {
      report.failure = String(error);
      report.failureStage = stage;
      try { await shot(win, 'failure'); report.visibleText = (await evaluate(win, `document.body.innerText.slice(0, 600)`)); } catch { /* window may be gone */ }
      finish(1);
    }
  });
});
function finish(code) {
  fs.writeFileSync(path.join(output, `report-${phase}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(code);
}
setTimeout(() => { report.failure = `Timed out at ${stage}`; finish(1); }, ["rounds", "guest-multi", "video", "guest-video", "after-kill", "disk-full", "guest-disk-full", "summary", "cloud"].includes(phase) ? 900000 : 90000).unref();
require(path.join(archive, '.vite', 'build', 'main.cjs'));
