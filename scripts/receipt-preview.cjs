// Shows the guest receipt the way a printer would put it on paper, without a printer.
// Usage: node scripts/receipt-preview.cjs [--message "Thank you"] [--paper 58|80] [--event "Event name" (optional: off by default)] [--lang th|en] [--out receipt.png] [--url https://...]
// It builds the receipt with the app's own code, runs the bytes through a virtual ESC/POS printer, draws the result in
// Microsoft Edge (headless) and tries to read the printed QR code back with the browser's barcode detector.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildReceipt } = require('../src/main/services/escpos-receipt.ts');
const { emulate } = require('../tests/helpers/escpos-emulator.cjs');

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []));
const paper = args.paper === '80' ? 80 : 58;
const lang = args.lang === 'en' ? 'en' : 'th';
// Like the app, the event name is left off unless asked for (--event): it is often the customers' own names.
const eventName = args.event ?? null;
// --message: the event's own thank-you line under the validity date (Thai is fine).
const message = args.message ?? null;
const shareUrl = args.url ?? `https://kokomemory.com/s/${'A1b2C3d4'.repeat(5)}xyz?openExternalBrowser=1`;
const out = path.resolve(args.out ?? 'receipt-preview.png');
const EDGE = process.env.EDGE_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(candidate => fs.existsSync(candidate));
if (!EDGE) { console.error('Microsoft Edge was not found. Set EDGE_PATH to a Chromium-based browser.'); process.exit(2); }

const DRAW_CAPTION = `(async (width, size, name, caption) => {
  const FONT = "'IBM Plex Sans Thai','Noto Sans Thai','Leelawadee UI',Tahoma,'Segoe UI',sans-serif";
  const lines = [...(name ? [{ text: name, size: size + 2, weight: 600 }] : []), ...(caption ? [{ text: caption, size, weight: 400 }] : [])];
  const canvas = document.createElement('canvas'); const x = canvas.getContext('2d', { willReadFrequently: true });
  const font = line => line.weight + ' ' + line.size + 'px ' + FONT; const wrapped = [];
  for (const line of lines) {
    x.font = font(line); let current = '';
    for (const word of Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(line.text), part => part.segment)) {
      if (current && x.measureText(current + word).width > width - 16) { wrapped.push({ ...line, text: current.trim() }); current = ''; }
      for (const char of x.measureText(word).width > width - 16 ? Array.from(word) : [word]) {
        if (current && x.measureText(current + char).width > width - 16) { wrapped.push({ ...line, text: current.trim() }); current = char; } else current += char;
      }
    }
    if (current.trim()) wrapped.push({ ...line, text: current.trim() });
  }
  const height = wrapped.reduce((total, line) => total + Math.round(line.size * 1.7), 0) + 12;
  canvas.width = width; canvas.height = height; x.fillStyle = '#fff'; x.fillRect(0, 0, width, height); x.fillStyle = '#000'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let y = 6; for (const line of wrapped) { const row = Math.round(line.size * 1.7); x.font = font(line); x.fillText(line.text, width / 2, y + row / 2); y += row; }
  const rgba = Array.from(x.getImageData(0, 0, width, height).data);
  return { width, height, rgba };
})`;

const RENDER = `(async (items, paperDots) => {
  const lineHeight = 24, pad = 16;
  const heightOf = item => item.type === 'text' ? lineHeight * item.heightScale : item.type === 'feed' ? lineHeight : item.type === 'raster' ? item.height : item.type === 'qr' ? item.dots + 8 : item.type === 'cut' ? 40 : 0;
  const total = items.reduce((sum, item) => sum + heightOf(item), 0) + pad * 2;
  const canvas = document.createElement('canvas'); canvas.width = paperDots; canvas.height = total; document.body.style.cssText = 'margin:0;background:#bbb;padding:20px'; document.body.appendChild(canvas);
  const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, paperDots, total); c.fillStyle = '#000';
  const place = (width, align) => align === 'center' ? Math.round((paperDots - width) / 2) : align === 'right' ? paperDots - width : 0;
  let y = pad;
  for (const item of items) {
    if (item.type === 'text') {
      const cell = 12 * item.widthScale, width = item.text.length * cell; let x0 = place(width, item.align);
      c.font = (item.bold ? 'bold ' : '') + (22 * item.heightScale) + 'px Consolas, monospace'; c.textBaseline = 'top';
      for (const ch of item.text) { c.save(); c.translate(x0, y); c.scale(item.widthScale * 12 / c.measureText('M').width, 1); c.fillText(ch, 0, 0); c.restore(); x0 += cell; }
    } else if (item.type === 'raster') {
      const image = c.createImageData(item.width, item.height); const bytes = Uint8Array.from(atob(item.dataBase64), ch => ch.charCodeAt(0)); const rowBytes = item.width / 8;
      for (let r = 0; r < item.height; r++) for (let col = 0; col < item.width; col++) { const on = (bytes[r * rowBytes + (col >> 3)] >> (7 - (col & 7))) & 1; const k = (r * item.width + col) * 4; image.data[k] = image.data[k + 1] = image.data[k + 2] = on ? 0 : 255; image.data[k + 3] = 255; }
      c.putImageData(image, place(item.width, item.align), y);
    } else if (item.type === 'qr') {
      const x0 = place(item.dots, item.align); const y0 = y + 4;
      item.matrix.forEach((row, my) => row.forEach((on, mx) => { if (on) c.fillRect(x0 + mx * item.moduleSize, y0 + my * item.moduleSize, item.moduleSize, item.moduleSize); }));
    } else if (item.type === 'cut') {
      c.save(); c.setLineDash([8, 6]); c.strokeStyle = '#888'; c.beginPath(); c.moveTo(0, y + 20); c.lineTo(paperDots, y + 20); c.stroke(); c.restore(); c.fillStyle = '#888'; c.font = '14px sans-serif'; c.fillText('cut', 4, y + 4); c.fillStyle = '#000';
    }
    y += heightOf(item);
  }
  let decoded = null;
  if ('BarcodeDetector' in window) {
    try {
      const qr = items.find(item => item.type === 'qr');
      if (qr) {
        // Quiet zone around the code, as a phone camera would see it on paper.
        const quiet = document.createElement('canvas'); const margin = qr.moduleSize * 4; quiet.width = quiet.height = qr.dots + margin * 2;
        const q = quiet.getContext('2d'); q.fillStyle = '#fff'; q.fillRect(0, 0, quiet.width, quiet.height); q.fillStyle = '#000';
        qr.matrix.forEach((row, my) => row.forEach((on, mx) => { if (on) q.fillRect(margin + mx * qr.moduleSize, margin + my * qr.moduleSize, qr.moduleSize, qr.moduleSize); }));
        const found = await new BarcodeDetector({ formats: ['qr_code'] }).detect(quiet); decoded = found[0]?.rawValue ?? null;
      }
    } catch (error) { decoded = 'ERROR: ' + error.message; }
  } else decoded = 'UNSUPPORTED';
  return { height: total, decoded };
})`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'koko-receipt-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let targets;
    for (let attempt = 0; attempt < 40 && !targets; attempt++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await new Promise(resolve => setTimeout(resolve, 250)); } }
    const ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => { ws.onopen = resolve; });
    let id = 0; const pending = new Map();
    ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) pending.get(message.id)(message); };
    const send = (method, params = {}) => new Promise(resolve => { const request = ++id; pending.set(request, resolve); ws.send(JSON.stringify({ id: request, method, params })); });
    const evaluate = async expression => { const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (reply.result.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails)); return reply.result.result.value; };
    const dots = paper === 58 ? 384 : 576;
    await send('Emulation.setDeviceMetricsOverride', { width: dots + 40, height: 1400, deviceScaleFactor: 1, mobile: false });

    const caption = await evaluate(`${DRAW_CAPTION}(${dots}, ${paper === 58 ? 28 : 32}, ${JSON.stringify(eventName)}, ${JSON.stringify(lang === 'th' ? 'สแกนเพื่อรับรูปของคุณ' : 'Scan for your photos')})`);
    const { rasterFromRgba } = require('../src/shared/receipt-raster.ts');
    const footerImage = message ? await evaluate(`${DRAW_CAPTION}(${dots}, ${paper === 58 ? 26 : 30}, null, ${JSON.stringify(message)})`) : null;
    const footerRaster = footerImage ? rasterFromRgba(Uint8Array.from(footerImage.rgba), footerImage.width, footerImage.height) : null;
    const raster = rasterFromRgba(Uint8Array.from(caption.rgba), caption.width, caption.height);
    const bytes = buildReceipt({ shareUrl, shortCode: 'ABCD2345', eventUrl: 'https://kokomemory.com/e/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), paper, captionRaster: raster, footerRaster });
    const result = emulate(bytes, { paperDots: dots });
    const items = result.items.filter(item => item.type !== 'reset').map(item => item.type === 'raster' ? { ...item, data: undefined, dataBase64: item.data.toString('base64') } : item);
    const rendered = await evaluate(`${RENDER}(${JSON.stringify(items)}, ${dots})`);
    await send('Emulation.setDeviceMetricsOverride', { width: dots + 40, height: rendered.height + 40, deviceScaleFactor: 1, mobile: false });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    ws.close();
    console.log(`Receipt picture: ${out}`);
    console.log(`Paper ${paper} mm (${dots} dots) · ${bytes.length} bytes · ${items.length} elements`);
    console.log(`Problems found by the virtual printer: ${result.problems.length ? result.problems.join('; ') : 'none'}`);
    console.log(`Unknown commands: ${result.unknown.length ? result.unknown.join(', ') : 'none'}`);
    const qr = result.items.find(item => item.type === 'qr');
    console.log(`QR: ${qr.modules} modules x ${qr.moduleSize} dots = ${qr.dots} dots wide, error correction ${qr.ecc}`);
    console.log(`QR read back by the browser: ${rendered.decoded === shareUrl ? 'OK, the link matches exactly' : rendered.decoded === 'UNSUPPORTED' ? 'not checked (this browser has no barcode detector)' : `MISMATCH: ${rendered.decoded}`}`);
    process.exitCode = result.problems.length || rendered.decoded !== shareUrl && rendered.decoded !== 'UNSUPPORTED' ? 1 : 0;
  } finally {
    edge.kill();
    // Edge may still hold its profile files for a moment; leaving a temp folder behind is harmless.
    await new Promise(resolve => setTimeout(resolve, 700));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
})().catch(error => { console.error(error); process.exit(1); });
