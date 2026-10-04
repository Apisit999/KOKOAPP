import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureImageLayer, CaptureTextLayer, PhotoRecord } from '../shared/contract';
import { defaultPhotoSlots, isValidPhotoSlot, movePhotoSlot, normalizedRectToPixels, resizePhotoSlot, type PhotoSlot } from './template-layout';
import { drawImageLayers, drawTextLayers, loadImageLayers, MAX_STICKER_BYTES, MAX_STICKER_LAYERS, validImageLayer, validTextLayer } from './template-layers';

type Template = {
  id: string;
  name: string;
  count: 1 | 2 | 4;
  title: string;
  footer: string;
  background: string;
  frame: string;
  showDate: boolean;
  logo: string;
  overlay: string;
  videoOverlay: string;
  slots?: PhotoSlot[];
  videoFrame?: PhotoSlot;
  videoAspect?: number;
  textLayers?: CaptureTextLayer[];
  videoTextLayers?: CaptureTextLayer[];
  imageLayers?: CaptureImageLayer[];
  videoImageLayers?: CaptureImageLayer[];
};
export type GuestTemplate = Template;

const TEMPLATE_KEY = 'koko.saved-templates.v1';
const ACTIVE_TEMPLATE_KEY = 'koko.guest-template.v1';
const COLORS = [
  { name: 'Midnight', value: '#171714' },
  { name: 'Ivory', value: '#f4f0e6' },
  { name: 'Blush', value: '#e9c9c3' },
  { name: 'Sage', value: '#c7d0bd' }
];
const makeTemplate = (): Template => ({
  id: '', name: '', count: 2, title: 'A day to remember', footer: 'KOKO STUDIO',
  background: COLORS[0].value, frame: '#d6b36a', showDate: true, logo: '', overlay: '', videoOverlay: '', textLayers: [], videoTextLayers: [], imageLayers: [], videoImageLayers: []
});

function loadTemplates(): Template[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Template => Boolean(item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.name === 'string'
      && [1, 2, 4].includes(item.count) && typeof item.title === 'string'
      && typeof item.footer === 'string' && typeof item.background === 'string'
      && typeof item.frame === 'string' && typeof item.showDate === 'boolean'
      && typeof item.logo === 'string'))
      .map(item => ({ ...item, overlay: typeof item.overlay === 'string' ? item.overlay : '', videoOverlay: typeof item.videoOverlay === 'string' ? item.videoOverlay : '', slots: Array.isArray(item.slots) && item.slots.length === item.count && item.slots.every(isValidPhotoSlot) ? item.slots : undefined, videoFrame: isValidPhotoSlot(item.videoFrame) ? item.videoFrame : { x: 0, y: 0, width: 100, height: 100 }, videoAspect: typeof item.videoAspect === 'number' && item.videoAspect >= 0.2 && item.videoAspect <= 5 ? item.videoAspect : undefined, textLayers: Array.isArray(item.textLayers) && item.textLayers.length <= 6 && item.textLayers.every(validTextLayer) ? item.textLayers : [], videoTextLayers: Array.isArray(item.videoTextLayers) && item.videoTextLayers.length <= 6 && item.videoTextLayers.every(validTextLayer) ? item.videoTextLayers : [], imageLayers: Array.isArray(item.imageLayers) && item.imageLayers.length <= MAX_STICKER_LAYERS && item.imageLayers.every(validImageLayer) ? item.imageLayers : [], videoImageLayers: Array.isArray(item.videoImageLayers) && item.videoImageLayers.length <= MAX_STICKER_LAYERS && item.videoImageLayers.every(validImageLayer) ? item.videoImageLayers : [] }));
  } catch { return []; }
}

export function loadGuestTemplate(): GuestTemplate | null {
  try {
    const id = localStorage.getItem(ACTIVE_TEMPLATE_KEY);
    const template = loadTemplates().find(item => item.id === id);
    if (!template) return null;
    return template;
  } catch { return null; }
}

export async function drawComposition(canvas: HTMLCanvasElement, photos: PhotoRecord[], template: Template, language: boolean) {
  const width = 1200;
  const height = template.count === 1 ? 1500 : template.count === 2 ? 1800 : 1600;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.fillStyle = template.background;
  context.fillRect(0, 0, width, height);
  const light = ['#f4f0e6', '#e9c9c3', '#c7d0bd'].includes(template.background);
  const ink = light ? '#30291f' : '#f4f0e6';
  const slots = template.slots?.length === template.count ? template.slots : defaultPhotoSlots(template.count, template.title, template.logo, template.footer, template.showDate);

  const bitmaps: ImageBitmap[] = [];
  try {
    for (const photo of photos.slice(0, template.count)) {
      const result = await window.koko.readPhoto(photo.id);
      bitmaps.push(await createImageBitmap(new Blob([Uint8Array.from(result.jpegBytes)], { type: 'image/jpeg' })));
    }
    slots.forEach((slot, index) => {
      const pixelRect = normalizedRectToPixels(slot, width, height);
      const box = { x: pixelRect.x, y: pixelRect.y, w: pixelRect.width, h: pixelRect.height };
      context.fillStyle = template.frame;
      context.fillRect(box.x - 5, box.y - 5, box.w + 10, box.h + 10);
      context.fillStyle = light ? '#ddd5c6' : '#25231e';
      context.fillRect(box.x, box.y, box.w, box.h);
      const bitmap = bitmaps[index];
      if (!bitmap) return;
      const scale = Math.max(box.w / bitmap.width, box.h / bitmap.height);
      const cropW = box.w / scale;
      const cropH = box.h / scale;
      context.save();
      context.beginPath(); context.rect(box.x, box.y, box.w, box.h); context.clip();
      context.drawImage(bitmap, (bitmap.width - cropW) / 2, (bitmap.height - cropH) / 2, cropW, cropH, box.x, box.y, box.w, box.h);
      context.restore();
    });
  } finally { bitmaps.forEach(bitmap => bitmap.close()); }

  context.fillStyle = ink;
  context.textAlign = 'center';
  if (template.logo) {
    try {
      const logo = await createImageBitmap(await (await fetch(template.logo)).blob());
      const logoHeight = 72;
      context.drawImage(logo, (width - 180) / 2, 28, 180, logoHeight);
      logo.close();
    } catch { /* A removed or invalid logo does not prevent composing the photos. */ }
  }
  context.font = '500 52px Georgia, serif';
  if (template.title) context.fillText(template.title.slice(0, 60), width / 2, template.logo ? 155 : 112, width - 120);
  context.font = '600 24px sans-serif';
  if (template.footer) context.fillText(template.footer.slice(0, 80), width / 2, height - 105, width - 120);
  if (template.showDate) {
    context.font = '20px sans-serif';
    context.fillText(new Intl.DateTimeFormat(language ? 'th-TH' : 'en-US', { dateStyle: 'long' }).format(new Date()), width / 2, height - 65, width - 120);
  }
  if (template.overlay) {
    const overlay = await createImageBitmap(await (await fetch(template.overlay)).blob());
    try { context.drawImage(overlay, 0, 0, width, height); }
    finally { overlay.close(); }
  }
  const imageLayers = await loadImageLayers(template.imageLayers);
  try { drawImageLayers(context, imageLayers, width, height); }
  finally { imageLayers.forEach(layer => layer.bitmap.close()); }
  drawTextLayers(context, template.textLayers, width, height);
}

export function TemplatesPage({ photos, th, onMessage, printEnabled = false, onUseTemplate }: { photos: PhotoRecord[]; th: boolean; onMessage: (message: string) => void; printEnabled?: boolean; onUseTemplate?: (template: GuestTemplate | null) => void }) {
  const [template, setTemplate] = useState<Template>(makeTemplate);
  const [saved, setSaved] = useState<Template[]>(loadTemplates);
  const [activeTemplateId, setActiveTemplateId] = useState(() => { try { return localStorage.getItem(ACTIVE_TEMPLATE_KEY) ?? ''; } catch { return ''; } });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotEditorRef = useRef<HTMLDivElement>(null);
  const videoFrameEditorRef = useRef<HTMLDivElement>(null);
  const videoImageEditorRef = useRef<HTMLDivElement>(null);
  const slotDragRef = useRef<{ index: number; kind: 'photo' | 'video' | 'photo-image' | 'video-image'; mode: 'move' | 'resize'; startX: number; startY: number; startSlot: PhotoSlot } | null>(null);
  const photoSlots = useMemo(() => template.slots?.length === template.count ? template.slots : defaultPhotoSlots(template.count, template.title, template.logo, template.footer, template.showDate), [template]);
  const canvasHeight = template.count === 1 ? 1500 : template.count === 2 ? 1800 : 1600;
  const videoFrameRect = template.videoFrame ?? { x: 0, y: 0, width: 100, height: 100 };
  const available = useMemo(() => photos.filter(photo => selected.includes(photo.id)), [photos, selected]);
  const complete = available.length === template.count;

  useEffect(() => {
    let current = true;
    if (!complete || !canvasRef.current) { setPreviewError(''); return; }
    const preview = document.createElement('canvas');
    void drawComposition(preview, available, template, th).then(() => {
      if (!current || !canvasRef.current) return;
      const target = canvasRef.current;
      target.width = preview.width;
      target.height = preview.height;
      const context = target.getContext('2d');
      if (context) context.drawImage(preview, 0, 0);
      setPreviewError('');
    }).catch(error => {
      if (current) setPreviewError(error instanceof Error ? error.message : 'Could not render this template');
    });
    return () => { current = false; };
  }, [available, complete, template, th]);

  function update<K extends keyof Template>(key: K, value: Template[K]) {
    setTemplate(current => ({ ...current, [key]: value }));
  }
  function updateSlot(index: number, slot: PhotoSlot) {
    setTemplate(current => {
      const currentSlots = current.slots?.length === current.count ? current.slots : defaultPhotoSlots(current.count, current.title, current.logo, current.footer, current.showDate);
      const nextSlots = currentSlots.slice(); nextSlots[index] = slot;
      return { ...current, slots: nextSlots };
    });
  }
  function startSlotDrag(event: React.PointerEvent<HTMLElement>, index: number, mode: 'move' | 'resize', kind: 'photo' | 'video' | 'photo-image' | 'video-image' = 'photo') {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const imageLayer = kind === 'photo-image' ? template.imageLayers?.[index] : kind === 'video-image' ? template.videoImageLayers?.[index] : undefined;
    const startSlot = imageLayer ?? (kind === 'photo' ? photoSlots[index] : template.videoFrame ?? { x: 0, y: 0, width: 100, height: 100 });
    slotDragRef.current = { index, kind, mode, startX: event.clientX, startY: event.clientY, startSlot };
  }
  function moveSlotDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = slotDragRef.current;
    const editor = drag?.kind === 'video' ? videoFrameEditorRef.current : drag?.kind === 'video-image' ? videoImageEditorRef.current : slotEditorRef.current;
    const bounds = editor?.getBoundingClientRect();
    if (!drag || !bounds || !bounds.width || !bounds.height) return;
    const dx = (event.clientX - drag.startX) / bounds.width * 100;
    const dy = (event.clientY - drag.startY) / bounds.height * 100;
    const next = drag.mode === 'move' ? movePhotoSlot(drag.startSlot, dx, dy) : resizePhotoSlot(drag.startSlot, dx, dy);
    if (drag.kind === 'photo') updateSlot(drag.index, next);
    else if (drag.kind === 'video') update('videoFrame', next);
    else updateImageLayer(drag.kind, drag.index, next);
  }
  function finishSlotDrag() { slotDragRef.current = null; }
  function updateImageLayer(kind: 'photo-image' | 'video-image', index: number, rect: PhotoSlot) {
    const key = kind === 'photo-image' ? 'imageLayers' : 'videoImageLayers';
    setTemplate(current => {
      const layers = (current[key] ?? []).slice();
      if (!layers[index]) return current;
      layers[index] = { ...layers[index], ...rect };
      return { ...current, [key]: layers };
    });
  }
  function uploadSticker(file: File | undefined, kind: 'photo-image' | 'video-image') {
    if (!file) return;
    const key = kind === 'photo-image' ? 'imageLayers' : 'videoImageLayers';
    if (file.type !== 'image/png' || file.size > MAX_STICKER_BYTES) { onMessage(th ? 'สติกเกอร์ต้องเป็น PNG ขนาดไม่เกิน 100 KB' : 'Choose a PNG sticker no larger than 100 KB.'); return; }
    if ((template[key]?.length ?? 0) >= MAX_STICKER_LAYERS) { onMessage(th ? 'เพิ่มสติกเกอร์ได้สูงสุด 4 ชิ้นต่อรูปแบบ' : 'Each format supports up to 4 stickers.'); return; }
    void createImageBitmap(file).then(bitmap => {
      const valid = bitmap.width >= 32 && bitmap.height >= 32 && bitmap.width <= 4096 && bitmap.height <= 4096;
      bitmap.close();
      if (!valid) { onMessage(th ? 'ขนาดสติกเกอร์ต้องอยู่ระหว่าง 32 ถึง 4096 พิกเซล' : 'Sticker dimensions must be between 32 and 4096 pixels.'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') return;
        setTemplate(current => {
          const layers = (current[key] ?? []).slice();
          if (layers.length >= MAX_STICKER_LAYERS) return current;
          layers.push({ id: crypto.randomUUID(), src: reader.result as string, x: 35, y: 35, width: 30, height: 30 });
          return { ...current, [key]: layers };
        });
      };
      reader.onerror = () => onMessage(th ? 'อ่านไฟล์สติกเกอร์ไม่ได้' : 'Could not read the sticker file.');
      reader.readAsDataURL(file);
    }).catch(() => onMessage(th ? 'เปิดไฟล์ PNG ไม่ได้' : 'Could not open this PNG file.'));
  }
  function resetPhotoSlots() { update('slots', undefined); }
  function togglePhoto(id: string) {
    setSelected(current => current.includes(id)
      ? current.filter(item => item !== id)
      : current.length < template.count ? [...current, id] : current);
  }
  function persist(next: Template[]) {
    const serialized = JSON.stringify(next);
    if (serialized.length > 4_000_000) {
      onMessage(th ? 'เทมเพลตรวมใหญ่เกินไป กรุณาลดขนาดไฟล์กรอบหรือลบเทมเพลตที่ไม่ใช้' : 'Templates use too much local storage. Reduce frame image sizes or remove unused templates.');
      return false;
    }
    try { localStorage.setItem(TEMPLATE_KEY, serialized); setSaved(next); return true; }
    catch { onMessage(th ? 'บันทึกเทมเพลตไม่สำเร็จ พื้นที่จัดเก็บในเครื่องอาจเต็ม' : 'Could not save template. Local app storage may be full.'); return false; }
  }
  function saveTemplate() {
    const name = template.name.trim();
    if (!name) { onMessage(th ? 'กรุณาตั้งชื่อเทมเพลต' : 'Enter a name for this template.'); return; }
    const entry = { ...template, id: template.id || crypto.randomUUID(), name };
    const next = [...saved.filter(item => item.id !== entry.id), entry];
    if (persist(next)) { setTemplate(entry); onMessage(th ? 'บันทึกเทมเพลตแล้ว' : 'Template saved.'); }
  }
  function loadTemplate(id: string) {
    const entry = saved.find(item => item.id === id);
    if (!entry) return;
    setTemplate(entry); setSelected([]);
  }
  function removeTemplate(id: string) {
    persist(saved.filter(item => item.id !== id));
    if (activeTemplateId === id) { try { localStorage.removeItem(ACTIVE_TEMPLATE_KEY); } catch { /* Saved templates remain usable if app storage is unavailable. */ } setActiveTemplateId(''); onUseTemplate?.(null); }
    if (template.id === id) setTemplate(makeTemplate());
  }
  function useForGuest(item: Template) {
    try {
      localStorage.setItem(ACTIVE_TEMPLATE_KEY, item.id);
      setActiveTemplateId(item.id);
      onUseTemplate?.(item);
      onMessage(th ? `ตั้ง “${item.name}” สำหรับรอบถ่ายแล้ว` : `“${item.name}” is set for guest sessions.`);
    } catch { onMessage(th ? 'บันทึกเทมเพลตสำหรับรอบถ่ายไม่สำเร็จ' : 'Could not set the guest template.'); }
  }
  async function uploadLogo(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      onMessage(th ? 'เลือกไฟล์รูปภาพที่มีขนาดไม่เกิน 2 MB' : 'Choose an image file no larger than 2 MB.'); return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') update('logo', reader.result); };
    reader.onerror = () => onMessage(th ? 'อ่านไฟล์โลโก้ไม่ได้' : 'Could not read the logo file.');
    reader.readAsDataURL(file);
  }
  async function uploadFrame(file?: File) {
    if (!file) return;
    if (file.type !== 'image/png' || file.size > 500 * 1024) {
      onMessage(th ? 'เลือกกรอบ PNG พื้นหลังโปร่งใส ขนาดไม่เกิน 500 KB' : 'Choose a transparent PNG frame no larger than 500 KB.'); return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const expectedHeight = template.count === 1 ? 1500 : template.count === 2 ? 1800 : 1600;
      const validSize = bitmap.width === 1200 && bitmap.height === expectedHeight;
      bitmap.close();
      if (!validSize) {
        onMessage(th ? `ขนาดกรอบต้องเป็น 1200 × ${expectedHeight} พิกเซล ให้ตรงกับเลย์เอาต์ปัจจุบัน` : `Frame must be 1200 × ${expectedHeight} pixels for the selected layout.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => { if (typeof reader.result === 'string') update('overlay', reader.result); };
      reader.onerror = () => onMessage(th ? 'อ่านไฟล์กรอบไม่ได้' : 'Could not read the frame image.');
      reader.readAsDataURL(file);
    } catch { onMessage(th ? 'ไฟล์กรอบ PNG นี้เปิดไม่ได้' : 'This PNG frame could not be opened.'); }
  }
  async function uploadVideoFrame(file?: File) {
    if (!file) return;
    if (file.type !== 'image/png' || file.size > 500 * 1024) {
      onMessage(th ? 'เลือกกรอบวิดีโอ PNG พื้นหลังโปร่งใส ขนาดไม่เกิน 500 KB' : 'Choose a transparent PNG video frame no larger than 500 KB.'); return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const ratio = bitmap.width / bitmap.height;
      const validSize = bitmap.width >= 320 && bitmap.height >= 320 && bitmap.width <= 8192 && bitmap.height <= 8192 && ratio >= 0.2 && ratio <= 5;
      bitmap.close();
      if (!validSize) { onMessage(th ? 'กรอบวิดีโอต้องมีด้านสั้นอย่างน้อย 320 พิกเซล และสัดส่วนแนวนอนหรือแนวตั้งที่รองรับ' : 'Video frame must be at least 320 pixels on its shorter side and use a supported landscape or portrait ratio.'); return; }
      const reader = new FileReader();
      const aspect = bitmap.width / bitmap.height;
      reader.onload = () => { if (typeof reader.result === 'string') setTemplate(current => ({ ...current, videoOverlay: reader.result as string, videoFrame: { x: 0, y: 0, width: 100, height: 100 }, videoAspect: aspect })); };
      reader.onerror = () => onMessage(th ? 'อ่านไฟล์กรอบวิดีโอไม่ได้' : 'Could not read the video frame file.');
      reader.readAsDataURL(file);
    } catch { onMessage(th ? 'เปิดไฟล์กรอบวิดีโอนี้ไม่ได้' : 'This video frame PNG could not be opened.'); }
  }
  async function exportImage() {
    if (!complete || busy) return;
    setBusy(true);
    try {
      const output = document.createElement('canvas');
      await drawComposition(output, available, template, th);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('Could not create image file')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(template.name || 'koko-photo-strip').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 80)}.png`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      onMessage(th ? 'ส่งออกภาพประกอบแล้ว' : 'Composed image exported.');
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Could not export this image.'); }
    finally { setBusy(false); }
  }
  async function printImage() {
    if (!complete || busy) return;
    setBusy(true);
    try {
      const output = document.createElement('canvas');
      await drawComposition(output, available, template, th);
      const target = canvasRef.current;
      const context = target?.getContext('2d');
      if (!target || !context) throw new Error('Print preview is unavailable');
      target.width = output.width; target.height = output.height;
      context.drawImage(output, 0, 0);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      window.print();
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Could not open the print dialog.'); }
    finally { setBusy(false); }
  }

  return <>
    <p className="eyebrow">KOKO / TEMPLATES</p>
    <h1>{printEnabled ? (th ? 'จัดภาพและพิมพ์' : 'Compose and print') : (th ? 'ออกแบบเทมเพลตภาพ' : 'Photo templates')}</h1>
    <p className="lead">{th ? 'เลือกภาพจากคลัง จัดวาง และส่งออกเป็นภาพ PNG ได้ทันที' : 'Choose photos from your library, arrange them, and export a finished PNG.'}{printEnabled ? (th ? ' หรือเปิดกล่องพิมพ์ของระบบ' : ' or open your system print dialog.') : ''}</p>
    <div className="template-layout">
      <section className="template-controls">
        <label className="template-field">{th ? 'ชื่อเทมเพลต' : 'Template name'}<input value={template.name} maxLength={60} onChange={event => update('name', event.target.value)} placeholder={th ? 'เช่น งานวันเกิด' : 'e.g. Birthday'} /></label>
        <div className="template-field"><span>{th ? 'เลย์เอาต์' : 'Layout'}</span><div className="template-options">{([1, 2, 4] as const).map(count => <button type="button" key={count} className={template.count === count ? 'selected' : ''} aria-pressed={template.count === count} onClick={() => { if (template.count !== count) setTemplate(current => ({ ...current, count, overlay: '', slots: undefined })); setSelected([]); }}>{count} {th ? 'ภาพ' : count === 1 ? 'photo' : 'photos'}</button>)}</div></div>
        <label className="template-field">{th ? 'ข้อความหัวภาพ' : 'Title'}<input value={template.title} maxLength={60} onChange={event => update('title', event.target.value)} /></label>
        <label className="template-field">{th ? 'ข้อความท้ายภาพ' : 'Footer text'}<input value={template.footer} maxLength={80} onChange={event => update('footer', event.target.value)} /></label>
        <label className="template-field">{th ? 'สีพื้นหลัง' : 'Background'}<select value={template.background} onChange={event => update('background', event.target.value)}>{COLORS.map(color => <option value={color.value} key={color.value}>{color.name}</option>)}</select></label>
        <label className="template-field">{th ? 'สีกรอบ' : 'Frame color'}<input type="color" value={template.frame} onChange={event => update('frame', event.target.value)} /></label>
        <label className="template-check"><input type="checkbox" checked={template.showDate} onChange={event => update('showDate', event.target.checked)} />{th ? 'ใส่วันที่' : 'Include date'}</label>
        <label className="template-field">{th ? 'โลโก้ (ไม่เกิน 2 MB)' : 'Logo (up to 2 MB)'}<input type="file" accept="image/*" onChange={event => void uploadLogo(event.target.files?.[0])} /></label>
        {template.logo && <button type="button" className="text-link" onClick={() => update('logo', '')}>{th ? 'นำโลโก้ออก' : 'Remove logo'}</button>}
        <label className="template-field">{th ? 'กรอบ PNG โปร่งใส (ไม่เกิน 500 KB)' : 'Transparent PNG frame (up to 500 KB)'}<input type="file" accept="image/png" onChange={event => void uploadFrame(event.target.files?.[0])} /></label>
        <small className="muted">{th ? 'ทำไฟล์ขนาด 1200 × 1500 (1 ภาพ), 1200 × 1800 (2 ภาพ) หรือ 1200 × 1600 (4 ภาพ) โดยเว้นช่องรูปเป็นพื้นหลังโปร่งใส' : 'Use 1200 × 1500 (1 photo), 1200 × 1800 (2 photos), or 1200 × 1600 (4 photos), with transparent openings for the photos.'}</small>
        {template.overlay && <button type="button" className="text-link" onClick={() => update('overlay', '')}>{th ? 'นำกรอบออก' : 'Remove frame'}</button>}
        <TextLayersEditor title={th ? 'ข้อความบนภาพถ่าย' : 'Photo text layers'} layers={template.textLayers ?? []} th={th} onChange={layers => update('textLayers', layers)} />
        <ImageLayersEditor title={th ? 'สติกเกอร์ภาพถ่าย' : 'Photo stickers'} layers={template.imageLayers ?? []} th={th} onUpload={file => uploadSticker(file, 'photo-image')} onChange={layers => update('imageLayers', layers)} />
        <label className="template-field">{th ? 'กรอบวิดีโอ PNG โปร่งใส (แนวนอน/แนวตั้ง, ไม่เกิน 500 KB)' : 'Video frame PNG (transparent, landscape or portrait, up to 500 KB)'}<input type="file" accept="image/png" onChange={event => void uploadVideoFrame(event.target.files?.[0])} /></label>
        <small className="muted">{th ? 'รองรับกรอบแนวนอน แนวตั้ง และสี่เหลี่ยม โปรแกรมจะปรับความละเอียดวิดีโอให้ตรงกับสัดส่วนกรอบ' : 'Landscape, portrait, and square frames are supported. Video output is resized to match the frame ratio.'}</small>
        {template.videoOverlay && <>
          <div className="photo-slot-designer">
            <div className="template-photo-heading"><strong>{th ? 'จัดตำแหน่งกรอบวิดีโอ' : 'Position video frame'}</strong><button type="button" className="text-link" onClick={() => update('videoFrame', { x: 0, y: 0, width: 100, height: 100 })}>{th ? 'คืนค่า' : 'Reset'}</button></div>
            <p className="muted">{th ? 'ลากกรอบเพื่อย้าย หรือจับมุมเพื่อย่อและขยาย กรอบนี้จะอยู่เหนือวิดีโอในตัวอย่างและคลิปที่บันทึก' : 'Drag to move or pull the corner to resize. The same placement is used in the camera preview and saved clip.'}</p>
            <div ref={videoFrameEditorRef} className="video-frame-editor photo-slot-editor" style={{ aspectRatio: `${Math.min(2, Math.max(0.5, template.videoAspect ?? 9 / 16))}`, background: 'linear-gradient(135deg,#20262b,#121820 45%,#343128)' }} onPointerMove={moveSlotDrag} onPointerUp={finishSlotDrag} onPointerCancel={finishSlotDrag}>
              <img className="video-frame-edit-image" src={template.videoOverlay} alt="" draggable={false} style={{ left: `${videoFrameRect.x}%`, top: `${videoFrameRect.y}%`, width: `${videoFrameRect.width}%`, height: `${videoFrameRect.height}%` }} onPointerDown={event => startSlotDrag(event, 0, 'move', 'video')} />
              <button type="button" className="video-frame-resize" aria-label={th ? 'ปรับขนาดกรอบวิดีโอ' : 'Resize video frame'} style={{ left: `${videoFrameRect.x + videoFrameRect.width}%`, top: `${videoFrameRect.y + videoFrameRect.height}%` }} onPointerDown={event => startSlotDrag(event, 0, 'resize', 'video')} onClick={event => event.stopPropagation()} />
            </div>
            <fieldset className="photo-slot-controls"><legend>{th ? 'ตำแหน่งและขนาดกรอบวิดีโอ' : 'Video frame position and size'}</legend>
              <label>X <input type="range" min="0" max={100 - videoFrameRect.width} step="0.5" value={videoFrameRect.x} onChange={event => update('videoFrame', { ...videoFrameRect, x: Number(event.target.value) })} /><output>{videoFrameRect.x.toFixed(1)}%</output></label>
              <label>Y <input type="range" min="0" max={100 - videoFrameRect.height} step="0.5" value={videoFrameRect.y} onChange={event => update('videoFrame', { ...videoFrameRect, y: Number(event.target.value) })} /><output>{videoFrameRect.y.toFixed(1)}%</output></label>
              <label>{th ? 'กว้าง' : 'Width'} <input type="range" min="8" max={100 - videoFrameRect.x} step="0.5" value={videoFrameRect.width} onChange={event => update('videoFrame', { ...videoFrameRect, width: Number(event.target.value) })} /><output>{videoFrameRect.width.toFixed(1)}%</output></label>
              <label>{th ? 'สูง' : 'Height'} <input type="range" min="6" max={100 - videoFrameRect.y} step="0.5" value={videoFrameRect.height} onChange={event => update('videoFrame', { ...videoFrameRect, height: Number(event.target.value) })} /><output>{videoFrameRect.height.toFixed(1)}%</output></label>
            </fieldset>
          </div>
          <button type="button" className="text-link" onClick={() => { setTemplate(current => ({ ...current, videoOverlay: '', videoAspect: undefined, videoFrame: { x: 0, y: 0, width: 100, height: 100 } })); }}>{th ? 'นำกรอบวิดีโอออก' : 'Remove video frame'}</button>
        </>}
        <div ref={videoImageEditorRef} className="video-text-preview-stage" style={{ aspectRatio: `${Math.min(2, Math.max(0.5, template.videoAspect ?? 16 / 9))}` }} onPointerMove={moveSlotDrag} onPointerUp={finishSlotDrag} onPointerCancel={finishSlotDrag}>
          {template.videoOverlay && <img className="video-text-preview-frame" src={template.videoOverlay} alt="" style={{ left: `${videoFrameRect.x}%`, top: `${videoFrameRect.y}%`, width: `${videoFrameRect.width}%`, height: `${videoFrameRect.height}%` }} />}
          {(template.videoImageLayers ?? []).map((layer, index) => <div key={layer.id} className="sticker-placement video-sticker-placement" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%` }} onPointerDown={event => startSlotDrag(event, index, 'move', 'video-image')}><img src={layer.src} alt="" draggable={false} /><button type="button" aria-label={`${th ? 'ปรับขนาดสติกเกอร์' : 'Resize sticker'} ${index + 1}`} onPointerDown={event => startSlotDrag(event, index, 'resize', 'video-image')} onClick={event => event.stopPropagation()} /></div>)}
          {(template.videoTextLayers ?? []).map(layer => <span key={layer.id} className="template-text-preview-layer video-template-text" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, color: layer.color, fontSize: `${layer.fontSize}cqh`, textAlign: layer.align }}>{layer.text}</span>)}
        </div>
        <TextLayersEditor title={th ? 'ข้อความบนวิดีโอ' : 'Video text layers'} layers={template.videoTextLayers ?? []} th={th} onChange={layers => update('videoTextLayers', layers)} />
        <ImageLayersEditor title={th ? 'สติกเกอร์วิดีโอ' : 'Video stickers'} layers={template.videoImageLayers ?? []} th={th} onUpload={file => uploadSticker(file, 'video-image')} onChange={layers => update('videoImageLayers', layers)} />
        <div className="template-actions">{printEnabled && <button className="camera-secondary" onClick={() => void printImage()} disabled={!complete || busy}>{th ? 'พิมพ์…' : 'Print…'}</button>}<button className="camera-secondary" onClick={saveTemplate}>{th ? 'บันทึกเทมเพลต' : 'Save template'}</button><button className="primary" onClick={() => void exportImage()} disabled={!complete || busy}>{busy ? (th ? 'กำลังส่งออก…' : 'Exporting…') : (th ? 'ส่งออก PNG' : 'Export PNG')}</button></div>
      </section>
      <section className="template-workspace">
        <div className="template-preview template-print-area"><canvas ref={canvasRef} aria-label={th ? 'ตัวอย่างภาพประกอบ' : 'Composed image preview'} />{!complete && <div className="template-preview-empty">{th ? `เลือกภาพ ${template.count} ภาพเพื่อดูตัวอย่าง` : `Select ${template.count} photo${template.count > 1 ? 's' : ''} to preview`}</div>}</div>
        <section className="photo-slot-designer">
          <div className="template-photo-heading"><strong>{th ? 'จัดตำแหน่งช่องภาพ' : 'Position photo openings'}</strong><button type="button" className="text-link" onClick={resetPhotoSlots}>{th ? 'คืนค่าเลย์เอาต์' : 'Reset layout'}</button></div>
          <p className="muted">{th ? 'ลากกรอบเพื่อย้าย ลากมุมล่างขวาเพื่อปรับขนาด หรือใช้แถบเลื่อนปรับละเอียด' : 'Drag a box to move it, drag its lower right corner to resize, or use the sliders for precise placement.'}</p>
          <div ref={slotEditorRef} className="photo-slot-editor" style={{ aspectRatio: `1200 / ${canvasHeight}`, background: template.background }} onPointerMove={moveSlotDrag} onPointerUp={finishSlotDrag} onPointerCancel={finishSlotDrag}>
            {photoSlots.map((slot, index) => <div key={index} className="photo-slot-box" role="group" aria-label={`${th ? 'ช่องภาพ' : 'Photo opening'} ${index + 1}`} style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.width}%`, height: `${slot.height}%`, borderColor: template.frame }} onPointerDown={event => startSlotDrag(event, index, 'move')}>
              <span>{index + 1}</span><button type="button" aria-label={`${th ? 'ปรับขนาดช่องภาพ' : 'Resize photo opening'} ${index + 1}`} onPointerDown={event => startSlotDrag(event, index, 'resize')} onClick={event => event.stopPropagation()} />
            </div>)}
            {template.overlay && <img className="photo-slot-overlay" src={template.overlay} alt="" draggable={false} />}
            {(template.imageLayers ?? []).map((layer, index) => <div key={layer.id} className="sticker-placement" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%` }} onPointerDown={event => startSlotDrag(event, index, 'move', 'photo-image')}><img src={layer.src} alt="" draggable={false} /><button type="button" aria-label={`${th ? 'ปรับขนาดสติกเกอร์' : 'Resize sticker'} ${index + 1}`} onPointerDown={event => startSlotDrag(event, index, 'resize', 'photo-image')} onClick={event => event.stopPropagation()} /></div>)}
            {(template.textLayers ?? []).map(layer => <span key={layer.id} className="template-text-preview-layer" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, color: layer.color, fontSize: `${layer.fontSize * canvasHeight / 1200}cqw`, textAlign: layer.align }}>{layer.text}</span>)}
          </div>
          <div className="photo-slot-control-list">{photoSlots.map((slot, index) => <fieldset className="photo-slot-controls" key={index}><legend>{th ? `ช่องภาพ ${index + 1}` : `Photo ${index + 1}`}</legend>
            <label>X <input type="range" min="0" max={Math.max(0, 100 - slot.width)} step="0.5" value={slot.x} onChange={event => updateSlot(index, { ...slot, x: Number(event.target.value) })} /><output>{slot.x.toFixed(1)}%</output></label>
            <label>Y <input type="range" min="0" max={Math.max(0, 100 - slot.height)} step="0.5" value={slot.y} onChange={event => updateSlot(index, { ...slot, y: Number(event.target.value) })} /><output>{slot.y.toFixed(1)}%</output></label>
            <label>{th ? 'กว้าง' : 'Width'} <input type="range" min="8" max={Math.max(8, 100 - slot.x)} step="0.5" value={slot.width} onChange={event => updateSlot(index, { ...slot, width: Number(event.target.value) })} /><output>{slot.width.toFixed(1)}%</output></label>
            <label>{th ? 'สูง' : 'Height'} <input type="range" min="6" max={Math.max(6, 100 - slot.y)} step="0.5" value={slot.height} onChange={event => updateSlot(index, { ...slot, height: Number(event.target.value) })} /><output>{slot.height.toFixed(1)}%</output></label>
          </fieldset>)}</div>
        </section>
        {previewError && <p className="template-error" role="alert">{previewError}</p>}
        <div className="template-photo-heading"><strong>{th ? 'เลือกภาพจากคลัง' : 'Choose library photos'}</strong><span>{selected.length}/{template.count}</span></div>
        {!photos.length ? <div className="template-no-photos">{th ? 'ยังไม่มีภาพในคลัง ไปที่ Capture Studio เพื่อบันทึกภาพก่อน' : 'Your library is empty. Save photos to the library before making a template.'}</div> : <div className="template-photo-grid">{photos.map(photo => <button type="button" key={photo.id} className={`template-photo ${selected.includes(photo.id) ? 'selected' : ''}`} onClick={() => togglePhoto(photo.id)} aria-pressed={selected.includes(photo.id)} aria-label={`${th ? 'เลือกภาพ' : 'Select photo'} ${new Date(photo.savedAt).toLocaleDateString()}`}><PhotoImage photo={photo} /><span>{selected.includes(photo.id) ? selected.indexOf(photo.id) + 1 : '+'}</span></button>)}</div>}
      </section>
    </div>
    <section className="saved-template-list"><h2>{th ? 'เทมเพลตที่บันทึกไว้' : 'Saved templates'}</h2>{saved.length ? saved.map(item => <div className="saved-template-row" key={item.id}><button onClick={() => loadTemplate(item.id)}>{item.name} <small>{item.count} {th ? 'ภาพ' : 'photos'}</small></button><button className="text-link" onClick={() => useForGuest(item)}>{activeTemplateId === item.id ? (th ? 'ใช้แล้ว' : 'In use') : (th ? 'ใช้กับแขก' : 'Use for guests')}</button><button className="saved-template-delete" onClick={() => removeTemplate(item.id)} aria-label={`${th ? 'ลบเทมเพลต' : 'Delete template'} ${item.name}`}>×</button></div>) : <p>{th ? 'ยังไม่มีเทมเพลตที่บันทึกไว้' : 'No saved templates yet.'}</p>}</section>
  </>;
}

function PhotoImage({ photo }: { photo: PhotoRecord }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let mounted = true;
    let objectUrl = '';
    window.koko.readPhoto(photo.id).then(result => {
      if (!mounted) return;
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(result.jpegBytes)], { type: 'image/jpeg' }));
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { mounted = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.id]);
  return url ? <img src={url} alt="" /> : <span aria-hidden="true">▧</span>;
}

function ImageLayersEditor({ title, layers, th, onUpload, onChange }: { title: string; layers: CaptureImageLayer[]; th: boolean; onUpload: (file?: File) => void; onChange: (layers: CaptureImageLayer[]) => void }) {
  function updateLayer(index: number, rect: PhotoSlot) { onChange(layers.map((layer, itemIndex) => itemIndex === index ? { ...layer, ...rect } : layer)); }
  return <details className="text-layer-editor">
    <summary>{title} <span>{layers.length}/{MAX_STICKER_LAYERS}</span></summary>
    <label className="sticker-upload-label">{th ? 'เพิ่ม PNG โปร่งใส (สูงสุด 100 KB)' : 'Add transparent PNG (up to 100 KB)'}<input type="file" accept="image/png" disabled={layers.length >= MAX_STICKER_LAYERS} onChange={event => { onUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
    {layers.map((layer, index) => <fieldset className="photo-slot-controls" key={layer.id}><legend>{th ? `สติกเกอร์ ${index + 1}` : `Sticker ${index + 1}`}</legend>
      <label>X <input type="range" min="0" max={100 - layer.width} step="0.5" value={layer.x} onChange={event => updateLayer(index, { ...layer, x: Number(event.target.value) })} /><output>{layer.x}%</output></label>
      <label>Y <input type="range" min="0" max={100 - layer.height} step="0.5" value={layer.y} onChange={event => updateLayer(index, { ...layer, y: Number(event.target.value) })} /><output>{layer.y}%</output></label>
      <label>{th ? 'กว้าง' : 'Width'} <input type="range" min="8" max={100 - layer.x} step="0.5" value={layer.width} onChange={event => updateLayer(index, { ...layer, width: Number(event.target.value) })} /><output>{layer.width}%</output></label>
      <label>{th ? 'สูง' : 'Height'} <input type="range" min="6" max={100 - layer.y} step="0.5" value={layer.height} onChange={event => updateLayer(index, { ...layer, height: Number(event.target.value) })} /><output>{layer.height}%</output></label>
      <button type="button" className="text-link" onClick={() => onChange(layers.filter((_, itemIndex) => itemIndex !== index))}>{th ? 'ลบสติกเกอร์' : 'Remove sticker'}</button>
    </fieldset>)}
  </details>;
}

function TextLayersEditor({ title, layers, th, onChange }: { title: string; layers: CaptureTextLayer[]; th: boolean; onChange: (layers: CaptureTextLayer[]) => void }) {
  function updateLayer(index: number, values: Partial<CaptureTextLayer>) {
    onChange(layers.map((layer, itemIndex) => itemIndex === index ? { ...layer, ...values } : layer));
  }
  function addLayer() {
    if (layers.length >= 6) return;
    onChange([...layers, { id: crypto.randomUUID(), text: th ? 'ข้อความใหม่' : 'New text', x: 8, y: 8, width: 84, fontSize: 5, color: '#ffffff', align: 'center' }]);
  }
  return <details className="text-layer-editor">
    <summary>{title} <span>{layers.length}/6</span></summary>
    {layers.map((layer, index) => <fieldset className="text-layer-fields" key={layer.id}>
      <legend>{th ? `ข้อความ ${index + 1}` : `Text ${index + 1}`}</legend>
      <label>{th ? 'ข้อความ' : 'Text'}<textarea rows={2} maxLength={100} value={layer.text} onChange={event => updateLayer(index, { text: event.target.value })} /></label>
      <div className="text-layer-inline">
        <label>{th ? 'สี' : 'Color'}<input type="color" value={layer.color} onChange={event => updateLayer(index, { color: event.target.value })} /></label>
        <label>{th ? 'จัดแนว' : 'Align'}<select value={layer.align} onChange={event => updateLayer(index, { align: event.target.value as CaptureTextLayer['align'] })}><option value="left">{th ? 'ซ้าย' : 'Left'}</option><option value="center">{th ? 'กลาง' : 'Center'}</option><option value="right">{th ? 'ขวา' : 'Right'}</option></select></label>
      </div>
      <label>{th ? 'ขนาด' : 'Size'} <input type="range" min="1" max="12" step="0.5" value={layer.fontSize} onChange={event => updateLayer(index, { fontSize: Number(event.target.value) })} /><output>{layer.fontSize}%</output></label>
      <label>X <input type="range" min="0" max={100 - layer.width} step="0.5" value={layer.x} onChange={event => updateLayer(index, { x: Number(event.target.value) })} /><output>{layer.x}%</output></label>
      <label>Y <input type="range" min="0" max="100" step="0.5" value={layer.y} onChange={event => updateLayer(index, { y: Number(event.target.value) })} /><output>{layer.y}%</output></label>
      <label>{th ? 'ความกว้าง' : 'Width'} <input type="range" min="10" max={100 - layer.x} step="0.5" value={layer.width} onChange={event => updateLayer(index, { width: Number(event.target.value) })} /><output>{layer.width}%</output></label>
      <button type="button" className="text-link" onClick={() => onChange(layers.filter((_, itemIndex) => itemIndex !== index))}>{th ? 'ลบข้อความ' : 'Remove text'}</button>
    </fieldset>)}
    <button type="button" className="camera-secondary" onClick={addLayer} disabled={layers.length >= 6}>{th ? 'เพิ่มข้อความ' : 'Add text'}</button>
  </details>;
}
