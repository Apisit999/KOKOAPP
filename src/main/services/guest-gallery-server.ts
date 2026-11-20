import http from 'node:http';

export type GalleryPhoto = { bytes: Uint8Array };
export type GalleryRound = { title: string; photoCount: number; expiresAt: number };
export type GalleryDeps = {
  /** The round a token opens (null = unknown/expired/revoked). */
  resolve(token: string): GalleryRound | null;
  /** Original JPEG bytes of the Nth photo of that round (0-based), or null. */
  readPhoto(token: string, index: number): GalleryPhoto | null;
  /** Re-encode a JPEG so its longest side is at most maxSide. */
  render(bytes: Uint8Array, maxSide: number): Uint8Array;
  now?: () => number;
};
export type GalleryStatus = { enabled: boolean; port: number | null; lastError: string | null; servedPhotos: number; servedPages: number };

const SIZES: Record<string, number> = { thumb: 400, preview: 1600, download: 2800 };
const RATE_PER_MINUTE = 240;

function esc(value: string) { return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string); }

export function galleryPage(round: GalleryRound, token: string): string {
  const title = esc(round.title || 'KOKO Photobooth');
  const base = `/s/${token}`;
  const items = Array.from({ length: round.photoCount }, (_, i) => i);
  const grid = items.map(i => `<button class="cell" type="button" data-i="${i}" aria-label="${i + 1}"><img src="${base}/p/${i}?size=thumb" alt="" loading="lazy" width="400" height="400"></button>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${title}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#111;color:#f5efe4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:20px 16px 120px}
h1{font-size:19px;margin:6px 0 4px;text-align:center;font-weight:600}.sub{margin:0 0 16px;text-align:center;color:#c9c0ae;font-size:14px}
#banner{display:none;margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#3a2f12;color:#ffe6a3;font-size:14px;line-height:1.45}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;max-width:640px;margin:0 auto}.cell{padding:0;border:0;background:#222;border-radius:10px;overflow:hidden;aspect-ratio:1}
.cell img{width:100%;height:100%;object-fit:cover;display:block}
.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#111e;backdrop-filter:blur(8px);display:flex;flex-direction:column;gap:6px;align-items:center}
#all{width:min(100%,420px);padding:15px;border-radius:14px;border:0;background:#d9c9a3;color:#1a1508;font-size:17px;font-weight:700}
#all:disabled{opacity:.6}#st{font-size:14px;min-height:1.3em;color:#c9c0ae}#st.ok{color:#9be3a8}#st.bad{color:#ff9d9d}
#view{position:fixed;inset:0;background:#000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px}
#view img{max-width:100%;max-height:78vh;object-fit:contain}#view .row{display:flex;gap:10px}
#view a,#view button{padding:12px 18px;border-radius:12px;border:1px solid #d9c9a3;background:#1d1a15;color:#f5efe4;font-size:16px;text-decoration:none}
.hint{max-width:640px;margin:14px auto 0;font-size:13px;color:#8f8777;text-align:center}
</style></head><body>
<h1>${title}</h1><p class="sub" id="sub"></p>
<div id="banner" role="note"></div>
<div class="grid">${grid}</div>
<p class="hint" id="hint"></p>
<div class="bar"><button id="all" type="button"></button><div id="st" role="status"></div></div>
<div id="view" role="dialog"><img id="big" alt=""><div class="row"><a id="dl" download></a><button id="close" type="button"></button></div></div>
<script>
(function(){
var th=(navigator.language||'th').toLowerCase().indexOf('th')===0,N=${round.photoCount},B=${JSON.stringify(base)};
var T={sub:th?'แตะรูปเพื่อดู หรือกดปุ่มด้านล่างเพื่อบันทึกทุกรูปลงมือถือ':'Tap a photo to view, or save them all to your phone below.',all:th?'บันทึกทั้งหมดลงอัลบั้ม':'Save all to my photos',
dl:th?'ดาวน์โหลดรูปนี้':'Download this photo',close:th?'ปิด':'Close',prep:th?'กำลังเตรียมรูป ':'Preparing ',saved:th?'บันทึกแล้ว ':'Saved ',fail:th?'บันทึกไม่สำเร็จ ลองกดอีกครั้ง หรือกดค้างที่รูปแล้วเลือกบันทึก':'Could not save. Try again, or press and hold a photo and choose Save.',
hold:th?'ทางลัด: กดค้างที่รูปแล้วเลือก “บันทึกรูปภาพ” ได้เสมอ':'Tip: press and hold any photo and choose Save Image.',
inapp:th?'ถ้าบันทึกไม่ได้ ให้เปิดลิงก์นี้ในเบราว์เซอร์ปกติ (Safari / Chrome) ที่เมนู ••• แล้วเลือก “เปิดในเบราว์เซอร์”':'If saving does not work, open this page in your normal browser (Safari / Chrome) from the ••• menu.',
legacy:th?'เบราว์เซอร์นี้ไม่รองรับบันทึกทีเดียว ระบบจะดาวน์โหลดทีละรูปให้':'This browser cannot save in one step; downloading one by one.'};
function $(id){return document.getElementById(id);}
$('sub').textContent=T.sub;$('all').textContent=T.all;$('hint').textContent=T.hold;$('dl').textContent=T.dl;$('close').textContent=T.close;
var ua=navigator.userAgent||'';if(/FBAN|FBAV|Instagram|Line\\//i.test(ua)){var b=$('banner');b.style.display='block';b.textContent=T.inapp;}
function st(t,c){var e=$('st');e.textContent=t;e.className=c||'';}
function url(i,size,dl){return B+'/p/'+i+'?size='+size+(dl?'&dl=1':'');}
var cells=document.querySelectorAll('.cell');
for(var k=0;k<cells.length;k++)cells[k].onclick=function(){var i=this.getAttribute('data-i');$('big').src=url(i,'preview');$('dl').href=url(i,'download',1);$('dl').setAttribute('download','KOKO_'+(+i+1)+'.jpg');$('view').style.display='flex';};
$('close').onclick=function(){$('view').style.display='none';$('big').removeAttribute('src');};
function getFile(i){return fetch(url(i,'download')).then(function(r){if(!r.ok)throw new Error('http');return r.blob();}).then(function(bl){return new File([bl],'KOKO_'+(i+1)+'.jpg',{type:'image/jpeg'});});}
function sequentialDownload(){
  st(T.legacy);var i=0;(function next(){if(i>=N){st(T.saved+N+'/'+N,'ok');return;}var a=document.createElement('a');a.href=url(i,'download',1);a.download='KOKO_'+(i+1)+'.jpg';document.body.appendChild(a);a.click();a.remove();i++;st(T.saved+i+'/'+N);setTimeout(next,700);})();
}
$('all').onclick=function(){
  var btn=this;btn.disabled=true;
  var canShare=!!(navigator.canShare&&navigator.share&&window.File);
  if(!canShare){sequentialDownload();btn.disabled=false;return;}
  var files=[],i=0;
  (function load(){
    if(i<N){st(T.prep+(i+1)+'/'+N);getFile(i).then(function(f){files.push(f);i++;load();}).catch(function(){st(T.fail,'bad');btn.disabled=false;});return;}
    if(!navigator.canShare({files:files})){sequentialDownload();btn.disabled=false;return;}
    navigator.share({files:files}).then(function(){st(T.saved+N+'/'+N,'ok');}).catch(function(e){if(e&&e.name==='AbortError'){st('');}else{st(T.fail,'bad');}}).then(function(){btn.disabled=false;});
  })();
};
})();
</script></body></html>`;
}

function expiredPage(): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>KOKO</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111;color:#f5efe4;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="font-size:20px">ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว</h1><p style="color:#c9c0ae">This link has expired or was removed.<br>ติดต่อเจ้าหน้าที่ของงานเพื่อขอรูปอีกครั้ง</p></div></body></html>`;
}

/** Public guest page + photo endpoints. Only the secret token in the path opens a round; nothing is listed. */
export class GuestGalleryServer {
  private server: http.Server | null = null;
  private portNumber: number | null = null;
  private lastError: string | null = null;
  private servedPhotos = 0;
  private servedPages = 0;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly cache = new Map<string, Uint8Array>();
  private readonly deps: GalleryDeps;

  constructor(deps: GalleryDeps) { this.deps = deps; }

  async start(port: number, host = '0.0.0.0'): Promise<GalleryStatus> {
    await this.stop();
    this.lastError = null;
    const server = http.createServer((request, response) => { try { this.handle(request, response); } catch (error) { this.lastError = error instanceof Error ? error.message.slice(0, 300) : 'gallery error'; if (!response.headersSent) { response.writeHead(500); } response.end(); } });
    server.requestTimeout = 60_000;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
    server.on('error', error => { this.lastError = error.message; });
    this.server = server;
    this.portNumber = (server.address() as { port: number }).port;
    return this.status();
  }

  async stop(): Promise<GalleryStatus> {
    const server = this.server;
    this.server = null; this.portNumber = null; this.cache.clear();
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
    return this.status();
  }

  status(): GalleryStatus { return { enabled: this.server !== null, port: this.portNumber, lastError: this.lastError, servedPhotos: this.servedPhotos, servedPages: this.servedPages }; }

  private clientKey(request: http.IncomingMessage) {
    const remote = request.socket.remoteAddress ?? '';
    const viaProxy = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const forwarded = viaProxy ? (request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for']) : undefined;
    return String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? remote).split(',')[0].trim();
  }

  private limited(request: http.IncomingMessage) {
    const now = (this.deps.now ?? Date.now)();
    const key = this.clientKey(request);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    bucket.count++;
    return bucket.count > RATE_PER_MINUTE;
  }

  private handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const send = (code: number, body: string | Uint8Array, headers: Record<string, string> = {}) => {
      response.writeHead(code, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
      response.end(body);
    };
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/healthz') { send(200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' }); return; }
    const match = /^\/s\/([A-Za-z0-9_-]{20,40})(?:\/p\/(\d{1,3}))?\/?$/.exec(url.pathname);
    if (!match) { send(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' }); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { send(405, 'Method not allowed'); return; }
    if (this.limited(request)) { send(429, 'Too many requests', { 'Retry-After': '30' }); return; }
    const token = match[1];
    const round = this.deps.resolve(token);
    if (!round) { send(410, expiredPage(), { 'Content-Type': 'text/html; charset=utf-8' }); return; }
    if (match[2] === undefined) {
      this.servedPages++;
      send(200, galleryPage(round, token), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }
    const index = Number(match[2]);
    if (index >= round.photoCount) { send(404, 'Not found'); return; }
    const size = url.searchParams.get('size') ?? 'preview';
    if (size !== 'original' && !(size in SIZES)) { send(400, 'Bad size'); return; }
    const photo = this.deps.readPhoto(token, index);
    if (!photo) { send(404, 'Not found'); return; }
    let bytes: Uint8Array = photo.bytes;
    if (size !== 'original') {
      const key = `${token}:${index}:${size}`;
      const cached = this.cache.get(key);
      if (cached) bytes = cached;
      else {
        bytes = this.deps.render(photo.bytes, SIZES[size]);
        if (size === 'thumb') { if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value as string); this.cache.set(key, bytes); }
      }
    }
    const headers: Record<string, string> = { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'private, max-age=3600' };
    if (url.searchParams.get('dl') === '1') headers['Content-Disposition'] = `attachment; filename="KOKO_${index + 1}.jpg"`;
    this.servedPhotos++;
    send(200, request.method === 'HEAD' ? '' : bytes, headers);
  }
}
