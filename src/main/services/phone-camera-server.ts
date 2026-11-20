import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import os from 'node:os';

export type PhoneCameraStatus = { enabled: boolean; url: string | null; receivedCount: number; lastError: string | null };

const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

/** Picks the address a phone on the same Wi-Fi/hotspot can reach, preferring private home/office ranges. */
export function lanAddress(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string | null {
  const all: string[] = [];
  for (const list of Object.values(interfaces)) for (const item of list ?? []) if (item.family === 'IPv4' && !item.internal) all.push(item.address);
  const rank = (ip: string) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return all.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const PAGE = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>KOKO Camera</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;background:#111;color:#f5efe4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center}
h1{font-size:20px;margin:0;font-weight:600;letter-spacing:.04em}p{margin:0;color:#c9c0ae;line-height:1.5}
button{width:min(78vw,260px);aspect-ratio:1;border-radius:50%;border:6px solid #d9c9a3;background:#1d1a15;color:#f5efe4;font-size:20px;font-weight:600}
button:disabled{opacity:.5}#msg{min-height:3em;font-size:17px}.ok{color:#9be3a8}.bad{color:#ff9d9d}
</style></head><body>
<h1>KOKO PHOTOBOOTH</h1>
<p id="hint"></p>
<button id="go" type="button"></button>
<input id="file" type="file" accept="image/*" capture="environment" hidden>
<p id="msg" role="status"></p>
<script>
(function(){
var th=(navigator.language||'th').toLowerCase().indexOf('th')===0;
var T={hint:th?'กดปุ่มเพื่อถ่ายรูป รูปจะส่งเข้าเครื่องถ่ายภาพทันที':'Tap the button to take a photo. It goes straight to the photo booth.',go:th?'ถ่ายรูป':'TAKE PHOTO',busy:th?'กำลังส่งรูป…':'Sending…',done:th?'ส่งแล้ว ':'Sent ',fail:th?'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง':'Could not send. Try again.',big:th?'รูปใหญ่เกินไป':'Photo is too large.'};
var go=document.getElementById('go'),file=document.getElementById('file'),msg=document.getElementById('msg'),sent=0;
document.getElementById('hint').textContent=T.hint;go.textContent=T.go;
go.onclick=function(){file.value='';file.click();};
function say(t,c){msg.textContent=t;msg.className=c||'';}
function toJpeg(f){
  return createImageBitmap(f,{imageOrientation:'from-image'}).then(function(bmp){
    var max=3600,s=Math.min(1,max/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');
    c.width=Math.round(bmp.width*s);c.height=Math.round(bmp.height*s);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    return new Promise(function(res,rej){c.toBlob(function(b){b?res(b):rej(new Error('encode'));},'image/jpeg',0.92);});
  });
}
file.onchange=function(){
  var f=file.files&&file.files[0];if(!f)return;
  go.disabled=true;say(T.busy);
  toJpeg(f).then(function(blob){
    if(blob.size>30*1024*1024)throw new Error('big');
    return fetch(location.pathname.replace(/\\/$/,'')+'/photo',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});
  }).then(function(r){if(!r.ok)throw new Error('http '+r.status);sent++;say(T.done+'('+sent+') ✓','ok');})
  .catch(function(e){say(e&&e.message==='big'?T.big:T.fail,'bad');})
  .then(function(){go.disabled=false;});
};
})();
</script></body></html>`;

/**
 * Tiny LAN-only HTTP server: a phone opens the secret page, takes a photo with its own camera app
 * and posts the JPEG. Only requests that carry the random token in the path are served.
 */
export class PhoneCameraServer {
  private server: http.Server | null = null;
  private token = '';
  private url: string | null = null;
  private received = 0;
  private lastError: string | null = null;
  private readonly onPhoto: (bytes: Uint8Array) => Promise<void>;

  constructor(onPhoto: (bytes: Uint8Array) => Promise<void>) { this.onPhoto = onPhoto; }

  async start(port = 0, host = '0.0.0.0', addressOverride?: string | null): Promise<PhoneCameraStatus> {
    await this.stop();
    this.token = randomBytes(18).toString('base64url');
    this.received = 0;
    this.lastError = null;
    const server = http.createServer((request, response) => { void this.handle(request, response); });
    server.requestTimeout = 60_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
    server.on('error', error => { this.lastError = error.message; });
    this.server = server;
    const bound = (server.address() as { port: number }).port;
    const address = addressOverride === undefined ? lanAddress() : addressOverride;
    this.url = address ? `http://${address}:${bound}/c/${this.token}` : null;
    if (!this.url) this.lastError = 'No Wi-Fi/LAN address found. Connect this computer to the same network as the phone.';
    return this.status();
  }

  async stop(): Promise<PhoneCameraStatus> {
    const server = this.server;
    this.server = null;
    this.url = null;
    this.token = '';
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
    return this.status();
  }

  status(): PhoneCameraStatus { return { enabled: this.server !== null, url: this.url, receivedCount: this.received, lastError: this.lastError }; }

  private tokenMatches(candidate: string) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.token);
    return a.length === b.length && b.length > 0 && timingSafeEqual(a, b);
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const send = (code: number, body: string, type = 'text/plain; charset=utf-8') => {
      response.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      response.end(body);
    };
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const match = /^\/c\/([A-Za-z0-9_-]+)(\/photo)?\/?$/.exec(path);
      if (!match || !this.tokenMatches(match[1])) { send(404, 'Not found'); return; }
      if (!match[2]) {
        if (request.method !== 'GET') { send(405, 'Method not allowed'); return; }
        send(200, PAGE, 'text/html; charset=utf-8');
        return;
      }
      if (request.method !== 'POST') { send(405, 'Method not allowed'); return; }
      const declared = Number(request.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) { send(413, 'Too large'); request.destroy(); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of request) {
        total += (chunk as Buffer).length;
        if (total > MAX_PHOTO_BYTES) { send(413, 'Too large'); request.destroy(); return; }
        chunks.push(chunk as Buffer);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) { send(415, 'JPEG required'); return; }
      await this.onPhoto(bytes);
      this.received++;
      this.lastError = null;
      send(200, JSON.stringify({ ok: true, count: this.received }), 'application/json');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message.slice(0, 300) : 'Could not save the phone photo';
      if (!response.headersSent) send(500, 'Could not save the photo');
    }
  }
}
