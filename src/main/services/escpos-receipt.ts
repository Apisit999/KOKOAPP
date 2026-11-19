import { Socket } from 'node:net';
import QRCode from 'qrcode';

/**
 * Guest receipt as raw ESC/POS bytes: short, cheap and fast (no driver, no PDF).
 * The QR uses the printer's own QR command (GS ( k), which is sharper and faster than printing an image.
 * Text is ASCII only: Thai code pages differ between printer models, so Thai text is drawn by the app as a 1-bit picture
 * (`captionRaster`) and sent with the raster command, which every ESC/POS printer understands.
 */
import { RASTER_MAX_HEIGHT, RASTER_MAX_WIDTH, type ReceiptRaster } from '../../shared/receipt-raster.ts';
export { RASTER_MAX_HEIGHT, RASTER_MAX_WIDTH, rasterFromRgba, type ReceiptRaster } from '../../shared/receipt-raster.ts';
export type ReceiptInput = {
  shareUrl: string;
  shortCode?: string | null;
  /** Printed under the code, e.g. kokomemory.com/e/<id>, for guests who cannot scan. */
  eventUrl?: string | null;
  /** Shown only when it is plain ASCII. */
  eventName?: string | null;
  expiresAt?: string | null;
  paper?: 58 | 80;
  /** Replaces the event name and the "Scan for your photos" line, so any language prints. */
  captionRaster?: ReceiptRaster | null;
  /** A short message under the validity line, drawn by the app so Thai prints on any model. */
  footerRaster?: ReceiptRaster | null;
};

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
const MAX_QR_BYTES = 700;
const ascii = (value: string) => /^[\x20-\x7e]*$/.test(value);
const text = (value: string) => Buffer.from(value.replace(/[^\x20-\x7e]/g, ''), 'ascii');

/** Model 2, error correction M, module size chosen for the paper width. */
/** Printable dots across the paper: 48 mm on 58 mm paper, 72 mm on 80 mm paper, at 203 dpi. */
const PAPER_DOTS = { 58: 384, 80: 576 } as const;
const PAPER_COLUMNS = { 58: 32, 80: 48 } as const;
/** Starts from the preferred size and shrinks it until the code fits the paper; below 3 dots per module a phone cannot read it. */
function fitModuleSize(data: string, paper: 58 | 80) {
  const modules = QRCode.create(data, { errorCorrectionLevel: 'M' }).modules.size;
  for (let size = paper === 58 ? 5 : 7; size >= 3; size--) if (modules * size <= PAPER_DOTS[paper]) return size;
  throw new Error('This link is too long to print as a QR code on this paper');
}
/** Hard-wraps text to the paper width: a link or code must never be cut off. */
const wrap = (value: string, columns: number) => value.match(new RegExp(`.{1,${columns}}`, 'g')) ?? [];
function qr(data: string, moduleSize: number) {
  const payload = Buffer.from(data, 'ascii');
  if (payload.length < 1 || payload.length > MAX_QR_BYTES) throw new Error('QR data is too long for a receipt');
  const store = payload.length + 3;
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00]), // model 2
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize]), // module size
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31]), // error correction M
    Buffer.from([GS, 0x28, 0x6b, store & 0xff, store >> 8, 0x31, 0x50, 0x30]), payload, // store
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]), // print
  ]);
}

/** GS v 0 in strips, so printers with small buffers do not drop rows. */
export function rasterCommands(raster: ReceiptRaster): Buffer {
  const { width, height, data } = raster;
  if (!Number.isInteger(width) || width < 8 || width > RASTER_MAX_WIDTH || width % 8 !== 0) throw new Error('Invalid receipt image');
  if (!Number.isInteger(height) || height < 1 || height > RASTER_MAX_HEIGHT) throw new Error('Invalid receipt image');
  const rowBytes = width / 8;
  if (data.length !== rowBytes * height) throw new Error('Invalid receipt image');
  const strips: Buffer[] = [];
  for (let y = 0; y < height; y += 128) {
    const rows = Math.min(128, height - y);
    strips.push(Buffer.from([GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8]), Buffer.from(data.subarray(y * rowBytes, (y + rows) * rowBytes)));
  }
  return Buffer.concat(strips);
}

/** "kokomemory.com/e/abc" is easier to type than the full https:// link. */
const shortUrl = (value: string) => value.replace(/^https?:\/\//, '').replace(/\/+$/, '');

export function buildReceipt(input: ReceiptInput): Uint8Array {
  let url: URL;
  try { url = new URL(input.shareUrl); } catch { throw new Error('Invalid guest link'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Invalid guest link');
  if (!ascii(input.shareUrl)) throw new Error('Invalid guest link');
  const paper = input.paper ?? 58;
  const parts: Buffer[] = [
    Buffer.from([ESC, 0x40]), // reset
    Buffer.from([ESC, 0x61, 1]), // centre
    Buffer.from([ESC, 0x45, 1, GS, 0x21, 0x11]), text('KOKO MEMORY'), Buffer.from([GS, 0x21, 0x00, ESC, 0x45, 0, LF]),
  ];
  if (input.captionRaster) parts.push(rasterCommands(input.captionRaster));
  else {
    if (input.eventName && ascii(input.eventName)) parts.push(text(input.eventName.slice(0, paper === 58 ? 32 : 48)), Buffer.from([LF]));
    parts.push(text('Scan for your photos'), Buffer.from([LF]));
  }
  parts.push(qr(input.shareUrl, fitModuleSize(input.shareUrl, paper)), Buffer.from([LF]));
  if (input.shortCode && /^[2-9A-HJ-NP-Z]{8}$/.test(input.shortCode)) {
    parts.push(text('or enter code'), Buffer.from([LF, ESC, 0x45, 1, GS, 0x21, 0x01]), text(`${input.shortCode.slice(0, 4)} ${input.shortCode.slice(4)}`), Buffer.from([GS, 0x21, 0x00, ESC, 0x45, 0, LF]));
    if (input.eventUrl && ascii(input.eventUrl)) for (const row of wrap(`at ${shortUrl(input.eventUrl)}`, PAPER_COLUMNS[paper])) parts.push(text(row), Buffer.from([LF]));
  }
  if (input.expiresAt && Number.isFinite(Date.parse(input.expiresAt))) {
    const date = new Date(input.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
    parts.push(text(`Valid until ${date}`), Buffer.from([LF]));
  }
  if (input.footerRaster) parts.push(Buffer.from([LF]), rasterCommands(input.footerRaster));
  // Minimal feed, then a partial cut: the receipt stays as short as the content.
  parts.push(Buffer.from([GS, 0x56, 0x42, 3]));
  return new Uint8Array(Buffer.concat(parts));
}

/** Sends raw bytes to a network receipt printer (port 9100). Resolves once the printer accepted every byte. */
export function sendToNetworkPrinter(host: string, bytes: Uint8Array, options: { port?: number; timeoutMs?: number } = {}): Promise<void> {
  const port = options.port ?? 9100;
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(new Error('Invalid printer address'));
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; socket.destroy(); if (error) reject(error); else resolve(); };
    socket.setTimeout(options.timeoutMs ?? 5000, () => finish(new Error('Receipt printer did not answer')));
    socket.once('error', error => finish(new Error(`Receipt printer unavailable: ${error.message}`)));
    socket.connect(port, host, () => { socket.end(Buffer.from(bytes), () => finish()); });
  });
}
