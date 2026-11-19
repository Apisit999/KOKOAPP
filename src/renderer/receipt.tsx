import { useEffect, useRef, useState } from 'react';
import type { PrinterStatus, ReceiptCaptionImage, ReceiptPrinterConfig, ReceiptSettings } from '../shared/contract';
import { rasterFromRgba } from '../shared/receipt-raster';
import { MAX_RECEIPT_COPIES, SERIAL_BAUD_RATES } from '../shared/receipt-settings';

/** Printable width in dots at 203 dpi: 48 mm on 58 mm paper, 72 mm on 80 mm paper. */
const PAPER_DOTS = { 58: 384, 80: 576 } as const;
const FONT = "'IBM Plex Sans Thai','Noto Sans Thai','Leelawadee UI',Tahoma,'Segoe UI',sans-serif";

/** Thai has no spaces between words; the browser's own word list lets a line break between words instead of inside one. */
function splitWords(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Segmenter) return Array.from(text);
  return Array.from(new Segmenter('th', { granularity: 'word' }).segment(text), part => part.segment);
}

/**
 * Draws the receipt's words (event name and "scan for your photos") as a black-and-white picture, so Thai prints the same
 * on every printer model instead of depending on the printer's own code pages.
 */
export async function drawReceiptCaption(paper: 58 | 80, eventName: string | null, th: boolean): Promise<ReceiptCaptionImage> {
  const lines: ReceiptLine[] = [];
  if (eventName?.trim()) lines.push({ text: eventName.trim().slice(0, 80), size: paper === 58 ? 30 : 36, weight: 600 });
  lines.push({ text: th ? 'สแกนเพื่อรับรูปของคุณ' : 'Scan for your photos', size: paper === 58 ? 28 : 32, weight: 400 });
  return drawReceiptLines(paper, lines);
}

/** The event's own thank-you message for the bottom of the slip, or null when the event has none. */
export async function drawReceiptFooter(paper: 58 | 80, message: string | null | undefined): Promise<ReceiptCaptionImage | null> {
  const text = message?.trim();
  if (!text) return null;
  return drawReceiptLines(paper, [{ text: text.slice(0, 80), size: paper === 58 ? 26 : 30, weight: 400 }]);
}

type ReceiptLine = { text: string; size: number; weight: number };
async function drawReceiptLines(paper: 58 | 80, lines: ReceiptLine[]): Promise<ReceiptCaptionImage> {
  const width = PAPER_DOTS[paper];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not draw the receipt');
  const font = (line: { size: number; weight: number }) => `${line.weight} ${line.size}px ${FONT}`;
  await Promise.all(lines.map(line => document.fonts.load(font(line), line.text).catch(() => undefined)));
  // Wrap by measuring: Thai has no spaces between words, so fall back to breaking by characters when a line is too wide.
  const wrapped: Array<{ text: string; size: number; weight: number }> = [];
  for (const line of lines) {
    context.font = font(line);
    let current = '';
    for (const word of splitWords(line.text)) {
      if (current && context.measureText(current + word).width > width - 16) { wrapped.push({ ...line, text: current.trim() }); current = ''; }
      // A single word wider than the paper is the only case where we break inside it.
      for (const char of context.measureText(word).width > width - 16 ? Array.from(word) : [word]) {
        if (current && context.measureText(current + char).width > width - 16) { wrapped.push({ ...line, text: current.trim() }); current = char; }
        else current += char;
      }
    }
    if (current.trim()) wrapped.push({ ...line, text: current.trim() });
  }
  const height = Math.min(1000, wrapped.reduce((total, line) => total + Math.round(line.size * 1.7), 0) + 12);
  canvas.width = width; canvas.height = height;
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#000'; context.textAlign = 'center'; context.textBaseline = 'middle';
  let y = 6;
  for (const line of wrapped) {
    const rowHeight = Math.round(line.size * 1.7);
    context.font = font(line);
    context.fillText(line.text, width / 2, y + rowHeight / 2);
    y += rowHeight;
  }
  const pixels = context.getImageData(0, 0, width, height);
  return rasterFromRgba(new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), width, height);
}

/**
 * Prints the guest receipt for one round; with no session it prints a test receipt.
 * The event name is printed only when the owner turned that on: it is often the customers' own names.
 */
export type ReceiptEventInfo = { name: string | null; receiptMessage?: string | null };
export async function printGuestReceipt(sessionId: string | null, event: ReceiptEventInfo | null, th: boolean, copies?: number) {
  const settings = await window.koko.getReceiptSettings();
  if (!settings.printer) throw new Error(th ? 'ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ' : 'No receipt printer is set up.');
  const caption = await drawReceiptCaption(settings.paper, settings.showEventName ? event?.name ?? null : null, th);
  const footer = await drawReceiptFooter(settings.paper, event?.receiptMessage);
  await window.koko.printReceipt(sessionId, caption, copies, footer);
}

/** Plain-language printer state for staff; "unknown" is normal for printers that do not report status. */
export function describePrinterStatus(status: PrinterStatus, th: boolean): { ok: boolean; text: string } {
  switch (status.state) {
    case 'ok': return { ok: true, text: th ? 'เครื่องพิมพ์พร้อมใช้งาน' : 'Printer is ready' };
    case 'paper-low': return { ok: true, text: th ? 'กระดาษใกล้หมด เตรียมม้วนใหม่' : 'Paper is running low. Have a new roll ready.' };
    case 'paper-out': return { ok: false, text: th ? 'กระดาษหมด ใส่ม้วนใหม่' : 'Out of paper. Load a new roll.' };
    case 'cover-open': return { ok: false, text: th ? 'ฝาเครื่องพิมพ์เปิดอยู่ ปิดฝาให้สนิท' : 'The printer cover is open. Close it firmly.' };
    case 'offline': return { ok: false, text: th ? 'เครื่องพิมพ์ออฟไลน์ ตรวจสายและไฟ' : 'The printer is offline. Check the cable and power.' };
    case 'error': return { ok: false, text: th ? 'เครื่องพิมพ์ขัดข้อง ปิดแล้วเปิดใหม่' : 'The printer reports an error. Switch it off and on again.' };
    case 'unreachable': return { ok: false, text: th ? `ติดต่อเครื่องพิมพ์ไม่ได้ (${status.detail ?? 'ไม่ทราบสาเหตุ'})` : `Cannot reach the printer (${status.detail ?? 'unknown reason'}).` };
    default: return { ok: true, text: status.detail === 'installed' || status.detail === 'present' ? (th ? 'พบเครื่องพิมพ์ในเครื่อง แต่รุ่นนี้ไม่รายงานสถานะกระดาษ ลองพิมพ์ใบทดสอบเพื่อยืนยัน' : 'The printer is present but does not report paper status. Print a test receipt to confirm.') : (th ? 'เครื่องพิมพ์ไม่รายงานสถานะ ลองพิมพ์ใบทดสอบเพื่อยืนยัน' : 'The printer does not report its status. Print a test receipt to confirm.') };
  }
}

/** Shows a black-and-white receipt picture exactly as the printer will put it on paper. */
function RasterPreview({ image, label }: { image: ReceiptCaptionImage; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    canvas.width = image.width; canvas.height = image.height;
    const picture = context.createImageData(image.width, image.height);
    const rowBytes = image.width / 8;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const black = (image.data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const at = (y * image.width + x) * 4;
      picture.data[at] = picture.data[at + 1] = picture.data[at + 2] = black ? 0 : 255; picture.data[at + 3] = 255;
    }
    context.putImageData(picture, 0, 0);
  }, [image]);
  return <canvas ref={canvasRef} role="img" aria-label={label} style={{ background: '#fff', maxWidth: '100%', height: 'auto', border: '1px solid #666' }} />;
}

type Kind = 'none' | ReceiptPrinterConfig['kind'];

export function ReceiptSettingsBlock({ th, event }: { th: boolean; event: ReceiptEventInfo | null }) {
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  const [lists, setLists] = useState<{ windows: string[]; serial: string[] }>({ windows: [], serial: [] });
  const [host, setHost] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState<ReceiptCaptionImage | null>(null);
  useEffect(() => { void window.koko.getReceiptLogo().then(setLogo).catch(() => undefined); }, []);
  async function chooseLogo() {
    setBusy(true); setMessage('');
    try {
      const next = await window.koko.importReceiptLogo();
      if (next) {
        setLogo(next.image);
        setMessage(next.inverted
          ? (th ? 'ตั้งโลโก้แล้ว ภาพนี้พื้นมืด ระบบสลับเป็นตัวดำบนพื้นขาวให้เพื่อไม่ให้พิมพ์เป็นก้อนดำ ลองพิมพ์ใบทดสอบเพื่อดูผลจริง' : 'Logo saved. The image is mostly dark, so it was flipped to dark marks on white to avoid a black block. Print a test receipt to check.')
          : (th ? 'ตั้งโลโก้ใบเสร็จแล้ว ลองพิมพ์ใบทดสอบเพื่อดูผลจริง' : 'Receipt logo saved. Print a test receipt to see it on paper.'));
      }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : (th ? 'ตั้งโลโก้ไม่สำเร็จ' : 'Could not set the logo.')); }
    finally { setBusy(false); }
  }
  async function removeLogo() {
    try { await window.koko.clearReceiptLogo(); setLogo(null); setMessage(th ? 'ลบโลโก้แล้ว ใบเสร็จจะใช้ข้อความ KOKO MEMORY' : 'Logo removed. The receipt shows the KOKO MEMORY heading again.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : (th ? 'ลบโลโก้ไม่สำเร็จ' : 'Could not remove the logo.')); }
  }
  useEffect(() => {
    void window.koko.getReceiptSettings().then(value => { setSettings(value); if (value.printer?.kind === 'network') setHost(value.printer.host); }).catch(() => setMessage(th ? 'อ่านการตั้งค่าเครื่องพิมพ์ใบเสร็จไม่ได้' : 'Could not read the receipt printer settings.'));
    void window.koko.listReceiptPrinters().then(setLists).catch(() => undefined);
  }, [th]);
  async function save(next: ReceiptSettings) {
    try { setSettings(await window.koko.saveReceiptSettings(next)); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : (th ? 'บันทึกไม่สำเร็จ' : 'Could not save.')); }
  }
  async function checkStatus() {
    setBusy(true); setMessage('');
    try { const result = describePrinterStatus(await window.koko.getReceiptPrinterStatus(), th); setMessage(result.text); }
    catch (error) { setMessage(error instanceof Error ? error.message : (th ? 'ตรวจสถานะไม่สำเร็จ' : 'Could not check the printer.')); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMessage('');
    try { await printGuestReceipt(null, event, th); setMessage(th ? 'ส่งใบเสร็จทดสอบแล้ว' : 'Test receipt sent.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : (th ? 'พิมพ์ไม่สำเร็จ' : 'Printing failed.')); }
    finally { setBusy(false); }
  }
  if (!settings) return message ? <p role="alert">{message}</p> : null;
  const kind: Kind = settings.printer?.kind ?? 'none';
  const choose = (next: Kind) => {
    if (next === 'none') return void save({ ...settings, autoPrint: false, printer: null });
    if (next === 'network') return void save({ ...settings, printer: { kind: 'network', host: host || '192.168.1.50' } }).then(() => setHost(current => current || '192.168.1.50'));
    if (next === 'windows') return void save({ ...settings, printer: { kind: 'windows', name: lists.windows[0] ?? '' } });
    return void save({ ...settings, printer: { kind: 'serial', port: lists.serial[0] ?? 'COM1' } });
  };
  const printer = settings.printer;
  return <section className="storage-settings receipt-settings">
    <div>
      <strong>{th ? 'เครื่องพิมพ์ใบเสร็จ (QR ให้แขกสแกน)' : 'Receipt printer (guest QR)'}</strong>
      <p>{th ? 'พิมพ์ใบเล็กที่มี QR และรหัสสั้นให้แขกรับรูป ใช้ได้กับเครื่องพิมพ์ความร้อนมาตรฐาน ESC/POS ทุกยี่ห้อ' : 'Prints a small slip with a QR code and short code so guests can get their photos. Works with standard ESC/POS thermal printers of any brand.'}</p>
    </div>
    <div className="setting-row">
      <span>{th ? 'วิธีเชื่อมต่อ' : 'Connection'}</span>
      <div className="segmented-control" role="group" aria-label={th ? 'วิธีเชื่อมต่อ' : 'Connection'}>
        {([['none', th ? 'ไม่ใช้' : 'Off'], ['windows', th ? 'USB / บลูทูธ (ใน Windows)' : 'USB / Bluetooth (Windows)'], ['network', th ? 'LAN / Wi-Fi' : 'LAN / Wi-Fi'], ['serial', th ? 'พอร์ต COM' : 'COM port']] as Array<[Kind, string]>).map(([value, label]) => <button key={value} type="button" className={kind === value ? 'active' : ''} aria-pressed={kind === value} onClick={() => choose(value)}>{label}</button>)}
      </div>
    </div>
    <div className="setting-row"><span>{th ? 'โลโก้บนใบเสร็จ' : 'Receipt logo'}</span>
      {logo ? <RasterPreview image={logo} label={th ? 'ตัวอย่างโลโก้ขาวดำบนใบเสร็จ' : 'Black-and-white preview of the receipt logo'} /> : <small>{th ? 'ยังไม่ได้ตั้ง ใบเสร็จจะพิมพ์ข้อความ KOKO MEMORY' : 'Not set. The receipt prints the KOKO MEMORY heading.'}</small>}
      <div><button type="button" onClick={() => void chooseLogo()} disabled={busy}>{logo ? (th ? 'เปลี่ยนโลโก้' : 'Change logo') : (th ? 'เลือกโลโก้' : 'Choose a logo')}</button>{logo && <>{' '}<button type="button" onClick={() => void removeLogo()}>{th ? 'ลบโลโก้' : 'Remove logo'}</button></>}</div>
      <small>{th ? 'ใช้ภาพโลโก้พื้นขาวหรือโปร่งใส ตัวอักษรเข้ม ระบบจะย่อและแปลงเป็นขาวดำให้ (กว้างสุด 48 มม.)' : 'Use a logo with dark marks on a white or transparent background. It is shrunk and turned black and white (up to 48 mm wide).'}</small></div>
    {printer?.kind === 'windows' && <div className="setting-row"><span>{th ? 'เครื่องพิมพ์ที่ลงไว้ใน Windows' : 'Printer installed in Windows'}</span>
      <select value={printer.name} onChange={event => void save({ ...settings, printer: { kind: 'windows', name: event.target.value } })}>{!lists.windows.includes(printer.name) && <option value={printer.name}>{printer.name || (th ? 'เลือกเครื่องพิมพ์' : 'Choose a printer')}</option>}{lists.windows.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <small>{th ? 'เสียบสาย USB หรือจับคู่บลูทูธใน Windows ก่อน แล้วเลือกชื่อเครื่องที่นี่' : 'Plug in the USB cable or pair Bluetooth in Windows first, then pick it here.'}</small></div>}
    {printer?.kind === 'network' && <div className="setting-row"><span>{th ? 'ที่อยู่ IP ของเครื่องพิมพ์' : 'Printer IP address'}</span>
      <input value={host} inputMode="decimal" placeholder="192.168.1.50" onChange={event => setHost(event.target.value.trim())} onBlur={() => host && host !== printer.host && void save({ ...settings, printer: { kind: 'network', host } })} />
      <small>{th ? 'ดูที่อยู่ได้จากใบทดสอบของเครื่องพิมพ์ (กดปุ่ม Feed ค้างตอนเปิดเครื่อง) พอร์ต 9100' : 'Find it on the printer self-test slip (hold Feed while powering on). Port 9100.'}</small></div>}
    {printer?.kind === 'serial' && <div className="setting-row"><span>{th ? 'พอร์ต COM และความเร็ว' : 'COM port and speed'}</span>
      <div><select value={printer.port} onChange={event => void save({ ...settings, printer: { ...printer, port: event.target.value } })}>{!lists.serial.includes(printer.port) && <option value={printer.port}>{printer.port}</option>}{lists.serial.map(port => <option key={port} value={port}>{port}</option>)}</select>{' '}
        <select value={printer.baud ?? 9600} onChange={event => void save({ ...settings, printer: { ...printer, baud: Number(event.target.value) } })}>{SERIAL_BAUD_RATES.map(rate => <option key={rate} value={rate}>{rate}</option>)}</select></div></div>}
    {printer && <>
      <div className="setting-row"><span>{th ? 'ขนาดกระดาษ' : 'Paper width'}</span><div className="segmented-control" role="group" aria-label={th ? 'ขนาดกระดาษ' : 'Paper width'}>{([58, 80] as const).map(paper => <button key={paper} type="button" className={settings.paper === paper ? 'active' : ''} aria-pressed={settings.paper === paper} onClick={() => void save({ ...settings, paper })}>{paper} mm</button>)}</div></div>
      <div className="setting-row"><span>{th ? 'จำนวนใบต่อรอบ' : 'Slips per round'}</span><div className="segmented-control" role="group" aria-label={th ? 'จำนวนใบต่อรอบ' : 'Slips per round'}><button type="button" aria-label={th ? 'ลดจำนวนใบ' : 'Fewer slips'} onClick={() => void save({ ...settings, copies: Math.max(1, settings.copies - 1) })}>−</button><button type="button" className="active" aria-live="polite">{settings.copies}</button><button type="button" aria-label={th ? 'เพิ่มจำนวนใบ' : 'More slips'} onClick={() => void save({ ...settings, copies: Math.min(MAX_RECEIPT_COPIES, settings.copies + 1) })}>+</button></div><small>{th ? 'ค่าเริ่มต้น 1 ใบต่อกลุ่ม พนักงานเพิ่มได้ตอนพิมพ์แต่ละรอบ' : 'Default is one slip per group. Staff can add more when printing a round.'}</small></div>
      <label className="audio-toggle"><input type="checkbox" checked={settings.showEventName} onChange={event => void save({ ...settings, showEventName: event.target.checked })} /><small>{th ? 'พิมพ์ชื่องานบนใบเสร็จ (ปิดไว้เพื่อความเป็นส่วนตัว เพราะชื่องานมักเป็นชื่อลูกค้า)' : 'Print the event name on the slip (off by default for privacy: event names are often the names of the customers)'}</small></label>
      <label className="audio-toggle"><input type="checkbox" checked={settings.autoPrint} onChange={event => void save({ ...settings, autoPrint: event.target.checked })} /><small>{th ? 'พิมพ์ใบเสร็จอัตโนมัติเมื่อถ่ายเสร็จแต่ละรอบ' : 'Print a receipt automatically after each round'}</small></label>
      <div><button type="button" onClick={() => void checkStatus()} disabled={busy}>{th ? 'ตรวจสถานะเครื่องพิมพ์' : 'Check printer status'}</button>{' '}<button type="button" onClick={() => void test()} disabled={busy}>{busy ? (th ? 'กำลังพิมพ์…' : 'Printing…') : (th ? 'พิมพ์ใบทดสอบ' : 'Print a test receipt')}</button></div>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
