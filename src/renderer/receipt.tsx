import { useEffect, useState } from 'react';
import type { ReceiptCaptionImage, ReceiptPrinterConfig, ReceiptSettings } from '../shared/contract';
import { rasterFromRgba } from '../shared/receipt-raster';
import { SERIAL_BAUD_RATES } from '../shared/receipt-settings';

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
  const width = PAPER_DOTS[paper];
  const lines: Array<{ text: string; size: number; weight: number }> = [];
  if (eventName?.trim()) lines.push({ text: eventName.trim().slice(0, 80), size: paper === 58 ? 30 : 36, weight: 600 });
  lines.push({ text: th ? 'สแกนเพื่อรับรูปของคุณ' : 'Scan for your photos', size: paper === 58 ? 28 : 32, weight: 400 });
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

/** Prints the guest receipt for one round; with no session it prints a test receipt. */
export async function printGuestReceipt(sessionId: string | null, eventName: string | null, th: boolean) {
  const settings = await window.koko.getReceiptSettings();
  if (!settings.printer) throw new Error(th ? 'ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ' : 'No receipt printer is set up.');
  const caption = await drawReceiptCaption(settings.paper, eventName, th);
  await window.koko.printReceipt(sessionId, caption);
}

type Kind = 'none' | ReceiptPrinterConfig['kind'];

export function ReceiptSettingsBlock({ th, eventName }: { th: boolean; eventName: string | null }) {
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  const [lists, setLists] = useState<{ windows: string[]; serial: string[] }>({ windows: [], serial: [] });
  const [host, setHost] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.koko.getReceiptSettings().then(value => { setSettings(value); if (value.printer?.kind === 'network') setHost(value.printer.host); }).catch(() => setMessage(th ? 'อ่านการตั้งค่าเครื่องพิมพ์ใบเสร็จไม่ได้' : 'Could not read the receipt printer settings.'));
    void window.koko.listReceiptPrinters().then(setLists).catch(() => undefined);
  }, [th]);
  async function save(next: ReceiptSettings) {
    try { setSettings(await window.koko.saveReceiptSettings(next)); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : (th ? 'บันทึกไม่สำเร็จ' : 'Could not save.')); }
  }
  async function test() {
    setBusy(true); setMessage('');
    try { await printGuestReceipt(null, eventName, th); setMessage(th ? 'ส่งใบเสร็จทดสอบแล้ว' : 'Test receipt sent.'); }
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
      <label className="audio-toggle"><input type="checkbox" checked={settings.autoPrint} onChange={event => void save({ ...settings, autoPrint: event.target.checked })} /><small>{th ? 'พิมพ์ใบเสร็จอัตโนมัติเมื่อถ่ายเสร็จแต่ละรอบ' : 'Print a receipt automatically after each round'}</small></label>
      <div><button type="button" onClick={() => void test()} disabled={busy}>{busy ? (th ? 'กำลังพิมพ์…' : 'Printing…') : (th ? 'พิมพ์ใบทดสอบ' : 'Print a test receipt')}</button></div>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
