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
setTimeout(() => { report.failure = `Timed out at ${stage}`; finish(1); }, ["rounds", "guest-multi"].includes(phase) ? 900000 : 90000).unref();
require(path.join(archive, '.vite', 'build', 'main.cjs'));
