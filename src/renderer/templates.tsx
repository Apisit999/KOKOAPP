import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureImageLayer, CaptureTextLayer, PhotoRecord, PrintJobRecord, PrintOptionsSnapshot, PrintPrinter } from '../shared/contract';
import { defaultPhotoSlots, isValidPhotoSlot, movePhotoSlot, normalizedRectToPixels, resizePhotoSlot, type PhotoSlot } from './template-layout';
import { drawImageLayers, drawTextLayers, loadImageLayers, MAX_STICKER_BYTES, MAX_STICKER_LAYERS, validImageLayer, validTextLayer } from './template-layers';
import { exportTemplateArchive, mergeTemplateArchive, parseTemplateArchiveWithFonts, type ArchiveFont } from './template-archive';
import { detectOpenings, posterize, SUPPORTED_OPENING_COUNTS } from './frame-import';
import { allowedCounts, bestSizeFor, canvasSize, countAfterSizeChange, countAllowed, isTemplateSize, sizeInfo, TEMPLATE_SIZES, type TemplateCount, type TemplateSizeId } from '../shared/template-size';
import { addFontFromBytes, base64ToBytes, bytesToBase64, ensureFonts, fontStack, importFontFiles, refreshFonts, removeFont, useFonts } from './fonts';
import { TEMPLATE_PRESETS, applyTemplatePreset } from './template-presets';

type Template = {
  id: string;
  name: string;
  fontId?: string;
  count: TemplateCount;
  size?: TemplateSizeId;
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
  mediaMode?: 'photo' | 'video';
  videoSeconds?: number;
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
      && countAllowed(isTemplateSize(item.size) ? item.size : undefined, item.count) && typeof item.title === 'string'
      && typeof item.footer === 'string' && typeof item.background === 'string'
      && typeof item.frame === 'string' && typeof item.showDate === 'boolean'
      && typeof item.logo === 'string'))
      .map(item => ({ ...item, overlay: typeof item.overlay === 'string' ? item.overlay : '', videoOverlay: typeof item.videoOverlay === 'string' ? item.videoOverlay : '', mediaMode: item.mediaMode === 'video' ? 'video' as const : undefined, videoSeconds: item.mediaMode === 'video' && [5, 15, 20].includes(item.videoSeconds as number) ? item.videoSeconds as number : undefined, size: isTemplateSize(item.size) ? item.size : undefined, fontId: typeof item.fontId === 'string' && /^[0-9a-f]{32}$/.test(item.fontId) ? item.fontId : undefined, slots: Array.isArray(item.slots) && item.slots.length === item.count && item.slots.every(isValidPhotoSlot) ? item.slots : undefined, videoFrame: isValidPhotoSlot(item.videoFrame) ? item.videoFrame : { x: 0, y: 0, width: 100, height: 100 }, videoAspect: typeof item.videoAspect === 'number' && item.videoAspect >= 0.2 && item.videoAspect <= 5 ? item.videoAspect : undefined, textLayers: Array.isArray(item.textLayers) && item.textLayers.length <= 6 && item.textLayers.every(validTextLayer) ? item.textLayers : [], videoTextLayers: Array.isArray(item.videoTextLayers) && item.videoTextLayers.length <= 6 && item.videoTextLayers.every(validTextLayer) ? item.videoTextLayers : [], imageLayers: Array.isArray(item.imageLayers) && item.imageLayers.length <= MAX_STICKER_LAYERS && item.imageLayers.every(validImageLayer) ? item.imageLayers : [], videoImageLayers: Array.isArray(item.videoImageLayers) && item.videoImageLayers.length <= MAX_STICKER_LAYERS && item.videoImageLayers.every(validImageLayer) ? item.videoImageLayers : [] }));
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
  await ensureFonts([template.fontId, ...(template.textLayers ?? []).map(layer => layer.fontId)]);
  const { width, height } = canvasSize(template.size, template.count);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.fillStyle = template.background;
  context.fillRect(0, 0, width, height);
  const light = ['#f4f0e6', '#e9c9c3', '#c7d0bd'].includes(template.background);
  const ink = light ? '#30291f' : '#f4f0e6';
  const slots = template.slots?.length === template.count ? template.slots : defaultPhotoSlots(template.count, template.title, template.logo, template.footer, template.showDate, template.size);

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
  context.font = `500 52px ${fontStack(template.fontId, 'Georgia, serif')}`;
  if (template.title) context.fillText(template.title.slice(0, 60), width / 2, template.logo ? 155 : 112, width - 120);
  context.font = `600 24px ${fontStack(template.fontId, 'sans-serif')}`;
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
  drawTextLayers(context, template.textLayers, width, height, fontStack);
}

export function TemplatesPage({ photos, th, onMessage, printEnabled = false, onUseTemplate }: { photos: PhotoRecord[]; th: boolean; onMessage: (message: string) => void; printEnabled?: boolean; onUseTemplate?: (template: GuestTemplate | null) => void }) {
  const [template, setTemplate] = useState<Template>(makeTemplate);
  const [saved, setSaved] = useState<Template[]>(loadTemplates);
  const [activeTemplateId, setActiveTemplateId] = useState(() => { try { return localStorage.getItem(ACTIVE_TEMPLATE_KEY) ?? ''; } catch { return ''; } });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [printers, setPrinters] = useState<PrintPrinter[]>([]);
  const [printJobs, setPrintJobs] = useState<PrintJobRecord[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [paper, setPaper] = useState<PrintOptionsSnapshot['paper']>('A4');
  const [landscape, setLandscape] = useState(false);
  const [stripTwoUp, setStripTwoUp] = useState(true);
  const [sheetPreview, setSheetPreview] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotEditorRef = useRef<HTMLDivElement>(null);
  const videoFrameEditorRef = useRef<HTMLDivElement>(null);
  const videoImageEditorRef = useRef<HTMLDivElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const slotDragRef = useRef<{ index: number; kind: 'photo' | 'video' | 'photo-image' | 'video-image'; mode: 'move' | 'resize'; startX: number; startY: number; startSlot: PhotoSlot } | null>(null);
  const photoSlots = useMemo(() => template.slots?.length === template.count ? template.slots : defaultPhotoSlots(template.count, template.title, template.logo, template.footer, template.showDate, template.size), [template]);
  const { width: canvasWidth, height: canvasHeight } = canvasSize(template.size, template.count);
  const videoFrameRect = template.videoFrame ?? { x: 0, y: 0, width: 100, height: 100 };
  const available = useMemo(() => photos.filter(photo => selected.includes(photo.id)), [photos, selected]);
  const complete = available.length === template.count;

  useEffect(() => {
    if (!printEnabled) return;
    const refresh = () => { void Promise.all([window.koko.listPrintPrinters(), window.koko.listPrintJobs()]).then(([devices, jobs]) => { setPrinters(devices); setPrintJobs(jobs.slice(0, 8)); }).catch(error => onMessage(error instanceof Error ? error.message : 'Could not read print status.')); };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [printEnabled]);

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
      const currentSlots = current.slots?.length === current.count ? current.slots : defaultPhotoSlots(current.count, current.title, current.logo, current.footer, current.showDate, current.size);
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
  async function exportTemplates() {
    try {
      const usedIds = new Set<string>();
      for (const item of saved) for (const id of [item.fontId, ...(item.textLayers ?? []).map(layer => layer.fontId), ...(item.videoTextLayers ?? []).map(layer => layer.fontId)]) if (id) usedIds.add(id);
      const archiveFonts: ArchiveFont[] = [];
      for (const id of usedIds) {
        try { const { record, bytes } = await window.koko.readFont(id); archiveFonts.push({ id, name: record.name, data: bytesToBase64(bytes) }); } catch { /* A template keeps working without its font; the font is simply not packed. */ }
      }
      const blob = new Blob([exportTemplateArchive(saved, archiveFonts)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'koko-templates.json'; anchor.click();
      URL.revokeObjectURL(url);
      onMessage(th ? `ส่งออกเทมเพลตแล้ว${archiveFonts.length ? ` (รวมฟอนต์ ${archiveFonts.length} ไฟล์)` : ''}` : `Templates exported${archiveFonts.length ? ` with ${archiveFonts.length} font${archiveFonts.length === 1 ? '' : 's'}` : ''}.`);
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Could not export templates.'); }
  }
  async function importTemplates(file?: File) {
    if (!file) return;
    if (file.size > 16_000_000) { onMessage(th ? 'ไฟล์เทมเพลตมีขนาดเกิน 16 MB' : 'Template archive exceeds 16 MB.'); return; }
    try {
      const { templates: imported, fonts: packedFonts } = parseTemplateArchiveWithFonts(await file.text());
      let fontsAdded = 0;
      for (const packed of packedFonts) {
        const record = await addFontFromBytes(`${packed.name}.ttf`, base64ToBytes(packed.data));
        if (record && record.id === packed.id) fontsAdded++;
      }
      const next = mergeTemplateArchive(saved, imported);
      if (next.length > 100) { onMessage(th ? 'มีเทมเพลตเกิน 100 รายการ กรุณาลบรายการที่ไม่ใช้ก่อน' : 'You can save up to 100 templates. Remove unused templates first.'); return; }
      if (persist(next)) {
        const active = next.find(item => item.id === activeTemplateId);
        if (active) onUseTemplate?.(active);
        const fontNote = fontsAdded ? (th ? ` และฟอนต์ ${fontsAdded} ไฟล์` : ` and ${fontsAdded} font${fontsAdded === 1 ? '' : 's'}`) : '';
        onMessage(th ? `นำเข้าเทมเพลต ${imported.length} รายการ${fontNote}แล้ว` : `Imported ${imported.length} template${imported.length === 1 ? '' : 's'}${fontNote}.`);
      }
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Could not import templates.'); }
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
  async function uploadDesign(file?: File) {
    if (!file) return;
    if (file.type !== 'image/png' || file.size > 8_000_000) {
      onMessage(th ? 'เลือกไฟล์ PNG ที่เจาะช่องใส่รูปให้โปร่งใส ขนาดไม่เกิน 8 MB' : 'Choose a PNG design with transparent photo windows, up to 8 MB.'); return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
        const probe = document.createElement('canvas');
        probe.width = Math.max(8, Math.round(bitmap.width * scale)); probe.height = Math.max(8, Math.round(bitmap.height * scale));
        const probeContext = probe.getContext('2d', { willReadFrequently: true });
        if (!probeContext) throw new Error('canvas unavailable');
        probeContext.drawImage(bitmap, 0, 0, probe.width, probe.height);
        const openings = detectOpenings(probeContext.getImageData(0, 0, probe.width, probe.height));
        if (!openings.length) {
          onMessage(th ? 'ไม่พบช่องใส่รูปในไฟล์นี้ ให้เจาะช่องรูปเป็นพื้นหลังโปร่งใสในโปรแกรมออกแบบ (Canva: ส่งออกเป็น PNG พื้นหลังโปร่งใส) แล้วลองใหม่' : 'No transparent photo windows were found. Cut the photo areas out as transparent in your design tool (in Canva, export as PNG with a transparent background) and try again.'); return;
        }
        if (!(SUPPORTED_OPENING_COUNTS as readonly number[]).includes(openings.length)) {
          onMessage(th ? `พบช่องใส่รูป ${openings.length} ช่อง แต่เทมเพลตรองรับ 1, 2, 3 หรือ 4 ช่อง` : `Found ${openings.length} photo windows, but templates support 1 to 4.`); return;
        }
        const count = openings.length as TemplateCount;
        const designSize = bestSizeFor(bitmap.width, bitmap.height, count);
        if (!designSize) {
          const fitting = TEMPLATE_SIZES.filter(item => item.id !== 'classic' && item.counts.includes(count)).map(item => `${item.ratio} (${th ? item.th : item.en})`).join(', ');
          onMessage(th ? `สัดส่วนไฟล์ ${bitmap.width} × ${bitmap.height} ไม่ตรงกับขนาดใดที่รองรับสำหรับ ${count} ช่อง ใช้สัดส่วนเหล่านี้: ${fitting}` : `A ${bitmap.width} × ${bitmap.height} design does not match a size that offers ${count} photo${count === 1 ? '' : 's'}. Use one of: ${fitting}.`); return;
        }
        const target = canvasSize(designSize, count);
        const canvas = document.createElement('canvas');
        canvas.width = target.width; canvas.height = target.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('canvas unavailable');
        context.drawImage(bitmap, 0, 0, target.width, target.height);
        let blob: Blob | null = null; let reduced = false;
        for (const levels of [0, 64, 32, 16]) {
          if (levels) { const pixels = context.getImageData(0, 0, target.width, target.height); posterize(pixels, levels); context.putImageData(pixels, 0, 0); reduced = true; }
          blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
          if (blob && blob.size <= 500 * 1024) break;
        }
        if (!blob || blob.size > 500 * 1024) {
          onMessage(th ? 'ไฟล์ดีไซน์ละเอียดเกินไปจนบีบให้ต่ำกว่า 500 KB ไม่ได้ ลองลดรายละเอียดหรือจำนวนสีของภาพ' : 'This design is too detailed to fit in 500 KB. Simplify the artwork or reduce its colours.'); return;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read')); reader.onerror = () => reject(new Error('read')); reader.readAsDataURL(blob as Blob); });
        setTemplate(current => ({ ...current, count, size: designSize, overlay: dataUrl, slots: openings }));
        setSelected([]);
        onMessage(th ? `นำเข้าดีไซน์แล้ว ขนาด ${sizeInfo(designSize).th} พบช่องใส่รูป ${count} ช่อง${reduced ? ' (ลดจำนวนสีเพื่อให้ไฟล์เล็กลง)' : ''} ตรวจตำแหน่งช่องรูปด้านล่างได้` : `Design imported as ${sizeInfo(designSize).en}: ${count} photo window${count === 1 ? '' : 's'} found${reduced ? ' (colours reduced to fit the size limit)' : ''}. You can fine-tune the openings below.`);
      } finally { bitmap.close(); }
    } catch { onMessage(th ? 'ไฟล์ PNG นี้เปิดไม่ได้' : 'This PNG could not be opened.'); }
  }
  async function uploadFrame(file?: File) {
    if (!file) return;
    if (file.type !== 'image/png' || file.size > 500 * 1024) {
      onMessage(th ? 'เลือกกรอบ PNG พื้นหลังโปร่งใส ขนาดไม่เกิน 500 KB' : 'Choose a transparent PNG frame no larger than 500 KB.'); return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const expected = canvasSize(template.size, template.count);
      const validSize = bitmap.width === expected.width && bitmap.height === expected.height;
      bitmap.close();
      if (!validSize) {
        onMessage(th ? `ขนาดกรอบต้องเป็น ${expected.width} × ${expected.height} พิกเซล ให้ตรงกับขนาดปัจจุบัน` : `Frame must be ${expected.width} × ${expected.height} pixels for the selected size.`);
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
  async function buildPrintable() {
    const output = document.createElement('canvas');
    await drawComposition(output, available, template, th);
    // A 2x6 strip is printed twice side by side on one sheet (a 4x6 sheet cut in half gives two strips).
    if (template.size !== 'strip' || !stripTwoUp) return output;
    const printable = document.createElement('canvas');
    printable.width = output.width * 2; printable.height = output.height;
    const sheet = printable.getContext('2d');
    if (!sheet) throw new Error('Could not create the print sheet.');
    sheet.drawImage(output, 0, 0); sheet.drawImage(output, output.width, 0);
    return printable;
  }
  async function previewSheet() {
    if (!complete || busy) return;
    setBusy(true);
    try { setSheetPreview((await buildPrintable()).toDataURL('image/png')); }
    catch (error) { onMessage(error instanceof Error ? error.message : 'Could not create the preview.'); }
    finally { setBusy(false); }
  }
  async function printImage() {
    if (!complete || busy) return;
    setBusy(true);
    try {
      const printable = await buildPrintable();
      const blob = await new Promise<Blob>((resolve, reject) => printable.toBlob(value => value ? resolve(value) : reject(new Error('Could not create print image.')), 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const job = await window.koko.submitPrintImage(bytes, { printerName, paper, landscape, copies });
      setPrintJobs(current => [job, ...current].slice(0, 8));
      onMessage(th ? `เพิ่มงานพิมพ์แล้ว (${job.id.slice(0, 8)})` : `Print job queued (${job.id.slice(0, 8)}).`);
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Could not open the print dialog.'); }
    finally { setBusy(false); }
  }

  return <>
    <p className="eyebrow">KOKO / TEMPLATES</p>
    <h1>{printEnabled ? (th ? 'จัดภาพและพิมพ์' : 'Compose and print') : (th ? 'ออกแบบเทมเพลตภาพ' : 'Photo templates')}</h1>
    <p className="lead">{th ? 'เลือกภาพจากคลัง จัดวาง และส่งออกเป็นภาพ PNG ได้ทันที' : 'Choose photos from your library, arrange them, and export a finished PNG.'}{printEnabled ? (th ? ' หรือเปิดกล่องพิมพ์ของระบบ' : ' or open your system print dialog.') : ''}</p>
    <div className="template-layout">
      <section className="template-controls">
        {printEnabled && <><fieldset className="print-options"><legend>{th ? 'ตัวเลือกพิมพ์' : 'Print options'}</legend>{template.size === 'strip' && <label className="print-two-up"><input type="checkbox" checked={stripTwoUp} onChange={event => setStripTwoUp(event.target.checked)} /> {th ? 'พิมพ์ 2 แถบต่อแผ่น (เลือกกระดาษ 4×6 แล้วตัดครึ่ง)' : 'Print 2 strips per sheet (use 4×6 paper, cut in half)'}</label>}<label>{th ? 'เครื่องพิมพ์' : 'Printer'}<select value={printerName} onChange={event => setPrinterName(event.target.value)}><option value="">{th ? 'เลือกในกล่องพิมพ์ของระบบ' : 'Choose in system print dialog'}</option><option value="__koko_simulated_printer__">{th ? 'จำลองการพิมพ์ (ไม่ใช้เครื่องจริง)' : 'Simulate print (no printer needed)'}</option>{printers.map(printer => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}</select></label><label>{th ? 'กระดาษ' : 'Paper'}<select value={paper} onChange={event => setPaper(event.target.value as PrintOptionsSnapshot['paper'])}><option value="A4">A4</option><option value="A5">A5</option><option value="Letter">Letter</option><option value="4x6">4 × 6 in</option></select></label><label className="switch"><span>{th ? 'แนวนอน' : 'Landscape'}</span><input type="checkbox" checked={landscape} onChange={event => setLandscape(event.target.checked)} /></label><label>{th ? 'จำนวนสำเนา' : 'Copies'}<input type="number" min={1} max={10} value={copies} onChange={event => setCopies(Math.min(10, Math.max(1, Number(event.target.value) || 1)))} /></label><button className="camera-secondary" type="button" disabled={!complete || busy} onClick={() => void previewSheet()}>{th ? 'ดูตัวอย่างแผ่นพิมพ์' : 'Preview print sheet'}</button>{sheetPreview && <div className="print-sheet-preview" role="dialog" aria-label={th ? 'ตัวอย่างแผ่นพิมพ์' : 'Print sheet preview'}><div className="print-sheet-frame"><img src={sheetPreview} alt="" />{template.size === 'strip' && stripTwoUp && <span className="print-cut-line" aria-hidden="true" />}</div><small>{template.size === 'strip' && stripTwoUp ? (th ? 'เส้นประคือจุดตัดครึ่งแผ่น' : 'Dashed line = where to cut the sheet') : (th ? 'ภาพที่จะพิมพ์' : 'What will be printed')}</small><button type="button" className="text-link" onClick={() => setSheetPreview(null)}>{th ? 'ปิดตัวอย่าง' : 'Close preview'}</button></div>}<button className="camera-secondary" type="button" onClick={() => void window.koko.listPrintPrinters().then(setPrinters).catch(error => onMessage(error instanceof Error ? error.message : 'Printer scan failed.'))}>{th ? 'ค้นหาเครื่องพิมพ์' : 'Refresh printers'}</button></fieldset><section className="print-job-list"><strong>{th ? 'คิวและประวัติพิมพ์' : 'Print queue and history'}</strong>{printJobs.length ? printJobs.map(job => <div key={job.id} className="print-job-row"><span>{job.options.printerName || (th ? 'กล่องพิมพ์ระบบ' : 'System dialog')} · {job.options.paper} · {job.options.copies}× · {job.status}{job.error ? ` · ${job.error}` : ''}</span>{job.status === 'failed' && <button type="button" className="text-link" onClick={() => void window.koko.retryPrintJob(job.id).then(updated => updated && setPrintJobs(current => current.map(item => item.id === updated.id ? updated : item)))}>{th ? 'ลองใหม่' : 'Retry'}</button>}{job.status === 'pending' && <button type="button" className="text-link" onClick={() => void window.koko.cancelPrintJob(job.id).then(updated => updated && setPrintJobs(current => current.map(item => item.id === updated.id ? updated : item)))}>{th ? 'ยกเลิก' : 'Cancel'}</button>}</div>) : <p className="muted">{th ? 'ยังไม่มีงานพิมพ์' : 'No print jobs yet.'}</p>}<small>{th ? 'สถานะส่งแล้วหมายถึง Windows รับงานเข้าคิว ไม่ได้ยืนยันผลพิมพ์จริง' : 'Submitted means Windows accepted the job; it does not confirm paper output.'}</small></section></>}
        <fieldset className="template-presets"><legend>{th ? 'เริ่มจากแบบสำเร็จรูป' : 'Start from a preset'}</legend><div className="template-preset-grid">{TEMPLATE_PRESETS.map(preset => <button type="button" key={preset.id} onClick={() => setTemplate(current => applyTemplatePreset(current, preset, th ? 'th' : 'en'))}><strong>{preset.name[th ? 'th' : 'en']}</strong><small>{preset.count} {th ? 'ภาพ' : preset.count === 1 ? 'photo' : 'photos'}</small></button>)}</div><small className="muted">{th ? 'ปรับข้อความ สี โลโก้ และกรอบต่อได้ทุกส่วน' : 'You can still edit the text, colours, logo and frame afterwards.'}</small></fieldset>
        <label className="template-field">{th ? 'ชื่อเทมเพลต' : 'Template name'}<input value={template.name} maxLength={60} onChange={event => update('name', event.target.value)} placeholder={th ? 'เช่น งานวันเกิด' : 'e.g. Birthday'} /></label>
        <div className="template-field"><span>{th ? 'ชนิดสื่อในโหมดแขก' : 'Guest captures'}</span><div className="template-options" role="group" aria-label={th ? 'ชนิดสื่อในโหมดแขก' : 'Guest captures'}>{(['photo', 'video'] as const).map(mode => <button type="button" key={mode} className={(template.mediaMode ?? 'photo') === mode ? 'selected' : ''} aria-pressed={(template.mediaMode ?? 'photo') === mode} onClick={() => setTemplate(current => ({ ...current, mediaMode: mode === 'video' ? 'video' : undefined }))}>{mode === 'photo' ? (th ? 'ภาพถ่าย' : 'Photos') : (th ? 'วิดีโอ' : 'Video clip')}</button>)}</div></div>
        {template.mediaMode === 'video' && <div className="template-field"><span>{th ? 'ความยาวคลิปของแขก' : 'Guest clip length'}</span><div className="template-options" role="group" aria-label={th ? 'ความยาวคลิปของแขก' : 'Guest clip length'}>{[5, 10, 15, 20].map(value => <button type="button" key={value} className={(template.videoSeconds ?? 10) === value ? 'selected' : ''} aria-pressed={(template.videoSeconds ?? 10) === value} onClick={() => setTemplate(current => ({ ...current, videoSeconds: value === 10 ? undefined : value }))}>{value}s</button>)}</div></div>}<div className="template-field"><span>{th ? 'ขนาดและรูปแบบ' : 'Size and shape'}</span><div className="template-size-grid" role="group" aria-label={th ? 'ขนาดและรูปแบบ' : 'Size and shape'}>{TEMPLATE_SIZES.map(info => <button type="button" key={info.id} className={(template.size ?? 'classic') === info.id ? 'selected' : ''} aria-pressed={(template.size ?? 'classic') === info.id} title={th ? info.hintTh : info.hintEn} onClick={() => { if ((template.size ?? 'classic') !== info.id) { setTemplate(current => ({ ...current, size: info.id === 'classic' ? undefined : info.id, count: countAfterSizeChange(info.id, current.count), overlay: '', slots: undefined })); setSelected([]); } }}><strong>{th ? info.th : info.en}</strong><small>{info.ratio}</small></button>)}</div><small className="muted">{th ? sizeInfo(template.size).hintTh : sizeInfo(template.size).hintEn} · {canvasSize(template.size, template.count).width} × {canvasSize(template.size, template.count).height} px</small></div>
        <div className="template-field"><span>{th ? 'จำนวนรูป' : 'Photos'}</span><div className="template-options">{allowedCounts(template.size).map(count => <button type="button" key={count} className={template.count === count ? 'selected' : ''} aria-pressed={template.count === count} onClick={() => { if (template.count !== count) setTemplate(current => ({ ...current, count, overlay: '', slots: undefined })); setSelected([]); }}>{count} {th ? 'ภาพ' : count === 1 ? 'photo' : 'photos'}</button>)}</div></div>
        <FontSelect label={th ? 'ฟอนต์หัวภาพและท้ายภาพ' : 'Title and footer font'} value={template.fontId} th={th} onMessage={onMessage} onChange={fontId => update('fontId', fontId)} />
        <label className="template-field">{th ? 'ข้อความหัวภาพ' : 'Title'}<input value={template.title} maxLength={60} onChange={event => update('title', event.target.value)} /></label>
        <label className="template-field">{th ? 'ข้อความท้ายภาพ' : 'Footer text'}<input value={template.footer} maxLength={80} onChange={event => update('footer', event.target.value)} /></label>
        <label className="template-field">{th ? 'สีพื้นหลัง' : 'Background'}<select value={template.background} onChange={event => update('background', event.target.value)}>{COLORS.map(color => <option value={color.value} key={color.value}>{color.name}</option>)}</select></label>
        <label className="template-field">{th ? 'สีกรอบ' : 'Frame color'}<input type="color" value={template.frame} onChange={event => update('frame', event.target.value)} /></label>
        <label className="template-check"><input type="checkbox" checked={template.showDate} onChange={event => update('showDate', event.target.checked)} />{th ? 'ใส่วันที่' : 'Include date'}</label>
        <details className="template-advanced"><summary>{th ? 'โลโก้ กรอบ และข้อความบนภาพถ่าย' : 'Logo, frame and photo layers'}</summary>
        <label className="template-field">{th ? 'โลโก้ (ไม่เกิน 2 MB)' : 'Logo (up to 2 MB)'}<input type="file" accept="image/*" onChange={event => void uploadLogo(event.target.files?.[0])} /></label>
        {template.logo && <button type="button" className="text-link" onClick={() => update('logo', '')}>{th ? 'นำโลโก้ออก' : 'Remove logo'}</button>}
        <label className="template-field">{th ? 'นำเข้าดีไซน์ของคุณ (PNG ที่เจาะช่องใส่รูปโปร่งใส)' : 'Import your own design (PNG with transparent photo windows)'}<input type="file" accept="image/png" onChange={event => { const input = event.currentTarget; const chosen = input.files?.[0]; input.value = ''; void uploadDesign(chosen); }} /></label>
        <small className="muted">{th ? 'แอปหาช่องใส่รูปให้เอง รองรับ 1, 2 หรือ 4 ช่อง ใช้ไฟล์จาก Canva หรือ Photoshop ได้ สัดส่วนควรเป็น 4:5 (1 ช่อง), 2:3 (2 ช่อง) หรือ 3:4 (4 ช่อง)' : 'The app finds the photo windows for you (1, 2 or 4). Works with exports from Canva or Photoshop. Use a 4:5 shape for 1 photo, 2:3 for 2, or 3:4 for 4.'}</small>
        <label className="template-field">{th ? 'กรอบ PNG โปร่งใส (ไม่เกิน 500 KB)' : 'Transparent PNG frame (up to 500 KB)'}<input type="file" accept="image/png" onChange={event => void uploadFrame(event.target.files?.[0])} /></label>
        <small className="muted">{th ? `ทำไฟล์ขนาด ${canvasSize(template.size, template.count).width} × ${canvasSize(template.size, template.count).height} พิกเซลสำหรับขนาดนี้ โดยเว้นช่องรูปเป็นพื้นหลังโปร่งใส` : `Use ${canvasSize(template.size, template.count).width} × ${canvasSize(template.size, template.count).height} pixels for this size, with transparent openings for the photos.`}</small>
        {template.overlay && <button type="button" className="text-link" onClick={() => update('overlay', '')}>{th ? 'นำกรอบออก' : 'Remove frame'}</button>}
        <TextLayersEditor onMessage={onMessage} title={th ? 'ข้อความบนภาพถ่าย' : 'Photo text layers'} layers={template.textLayers ?? []} th={th} onChange={layers => update('textLayers', layers)} />
        <ImageLayersEditor title={th ? 'สติกเกอร์ภาพถ่าย' : 'Photo stickers'} layers={template.imageLayers ?? []} th={th} onUpload={file => uploadSticker(file, 'photo-image')} onChange={layers => update('imageLayers', layers)} />
        </details>
        <details className="template-advanced"><summary>{th ? 'วิดีโอ' : 'Video'}</summary>
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
        <TextLayersEditor onMessage={onMessage} title={th ? 'ข้อความบนวิดีโอ' : 'Video text layers'} layers={template.videoTextLayers ?? []} th={th} onChange={layers => update('videoTextLayers', layers)} />
        <ImageLayersEditor title={th ? 'สติกเกอร์วิดีโอ' : 'Video stickers'} layers={template.videoImageLayers ?? []} th={th} onUpload={file => uploadSticker(file, 'video-image')} onChange={layers => update('videoImageLayers', layers)} />
        </details>
        <div className="template-actions">{printEnabled && <button className="camera-secondary" onClick={() => void printImage()} disabled={!complete || busy}>{th ? 'พิมพ์…' : 'Print…'}</button>}<button className="camera-secondary" onClick={saveTemplate}>{th ? 'บันทึกเทมเพลต' : 'Save template'}</button><button className="primary" onClick={() => void exportImage()} disabled={!complete || busy}>{busy ? (th ? 'กำลังส่งออก…' : 'Exporting…') : (th ? 'ส่งออก PNG' : 'Export PNG')}</button></div>
      </section>
      <section className="template-workspace">
        <div className="template-preview template-print-area"><canvas ref={canvasRef} aria-label={th ? 'ตัวอย่างภาพประกอบ' : 'Composed image preview'} />{!complete && <div className="template-preview-empty">{th ? `เลือกภาพ ${template.count} ภาพเพื่อดูตัวอย่าง` : `Select ${template.count} photo${template.count > 1 ? 's' : ''} to preview`}</div>}</div>
        <section className="photo-slot-designer">
          <div className="template-photo-heading"><strong>{th ? 'จัดตำแหน่งช่องภาพ' : 'Position photo openings'}</strong><button type="button" className="text-link" onClick={resetPhotoSlots}>{th ? 'คืนค่าเลย์เอาต์' : 'Reset layout'}</button></div>
          <p className="muted">{th ? 'ลากกรอบเพื่อย้าย ลากมุมล่างขวาเพื่อปรับขนาด หรือใช้แถบเลื่อนปรับละเอียด' : 'Drag a box to move it, drag its lower right corner to resize, or use the sliders for precise placement.'}</p>
          <div ref={slotEditorRef} className="photo-slot-editor" style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}`, background: template.background }} onPointerMove={moveSlotDrag} onPointerUp={finishSlotDrag} onPointerCancel={finishSlotDrag}>
            {photoSlots.map((slot, index) => <div key={index} className="photo-slot-box" role="group" aria-label={`${th ? 'ช่องภาพ' : 'Photo opening'} ${index + 1}`} style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.width}%`, height: `${slot.height}%`, borderColor: template.frame }} onPointerDown={event => startSlotDrag(event, index, 'move')}>
              <span>{index + 1}</span><button type="button" aria-label={`${th ? 'ปรับขนาดช่องภาพ' : 'Resize photo opening'} ${index + 1}`} onPointerDown={event => startSlotDrag(event, index, 'resize')} onClick={event => event.stopPropagation()} />
            </div>)}
            {template.overlay && <img className="photo-slot-overlay" src={template.overlay} alt="" draggable={false} />}
            {(template.imageLayers ?? []).map((layer, index) => <div key={layer.id} className="sticker-placement" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%` }} onPointerDown={event => startSlotDrag(event, index, 'move', 'photo-image')}><img src={layer.src} alt="" draggable={false} /><button type="button" aria-label={`${th ? 'ปรับขนาดสติกเกอร์' : 'Resize sticker'} ${index + 1}`} onPointerDown={event => startSlotDrag(event, index, 'resize', 'photo-image')} onClick={event => event.stopPropagation()} /></div>)}
            {(template.textLayers ?? []).map(layer => <span key={layer.id} className="template-text-preview-layer" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, color: layer.color, fontFamily: fontStack(layer.fontId), fontSize: `${layer.fontSize * canvasHeight / canvasWidth}cqw`, textAlign: layer.align }}>{layer.text}</span>)}
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
    <FontLibrary th={th} onMessage={onMessage} />
    <section className="saved-template-list"><h2>{th ? 'เทมเพลตที่บันทึกไว้' : 'Saved templates'}</h2><div className="template-archive-actions"><button type="button" className="camera-secondary" onClick={exportTemplates} disabled={!saved.length}>{th ? 'ส่งออกเทมเพลต' : 'Export templates'}</button><button type="button" className="camera-secondary" onClick={() => archiveInputRef.current?.click()}>{th ? 'นำเข้าเทมเพลต' : 'Import templates'}</button><input ref={archiveInputRef} type="file" accept="application/json,.json" hidden onChange={event => { void importTemplates(event.target.files?.[0]); event.currentTarget.value = ''; }} /></div>{saved.length ? saved.map(item => <div className="saved-template-row" key={item.id}><button onClick={() => loadTemplate(item.id)}>{item.name} <small>{item.count} {th ? 'ภาพ' : 'photos'}</small></button><button className="text-link" onClick={() => useForGuest(item)}>{activeTemplateId === item.id ? (th ? 'ใช้แล้ว' : 'In use') : (th ? 'ใช้กับแขก' : 'Use for guests')}</button><button className="saved-template-delete" onClick={() => removeTemplate(item.id)} aria-label={`${th ? 'ลบเทมเพลต' : 'Delete template'} ${item.name}`}>×</button></div>) : <p>{th ? 'ยังไม่มีเทมเพลตที่บันทึกไว้' : 'No saved templates yet.'}</p>}</section>
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

function TextLayersEditor({ title, layers, th, onChange, onMessage }: { title: string; layers: CaptureTextLayer[]; th: boolean; onChange: (layers: CaptureTextLayer[]) => void; onMessage: (message: string) => void }) {
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
      <label>{th ? 'ข้อความ' : 'Text'}<textarea rows={2} maxLength={100} value={layer.text} style={{ fontFamily: fontStack(layer.fontId) }} onChange={event => updateLayer(index, { text: event.target.value })} /></label>
      <FontSelect label={th ? 'ฟอนต์' : 'Font'} value={layer.fontId} th={th} onMessage={onMessage} onChange={fontId => updateLayer(index, { fontId })} />
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

async function addFontsWithMessage(th: boolean, onMessage: (message: string) => void) {
  try {
    const { added, failed } = await importFontFiles();
    if (added.length) onMessage(th ? `เพิ่มฟอนต์ ${added.length} ไฟล์แล้ว` : `Added ${added.length} font${added.length === 1 ? '' : 's'}.`);
    if (failed.length) onMessage((th ? 'นำเข้าฟอนต์ไม่สำเร็จ: ' : 'Could not add: ') + failed.join(' · '));
  } catch (error) { onMessage(error instanceof Error ? error.message : 'Could not add fonts.'); }
}

function FontSelect({ label, value, th, onChange, onMessage }: { label: string; value: string | undefined; th: boolean; onChange: (fontId: string | undefined) => void; onMessage: (message: string) => void }) {
  const fonts = useFonts();
  const missing = Boolean(value) && !fonts.some(font => font.id === value);
  return <label className="template-field">{label}<select value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}>
    <option value="">{th ? 'ฟอนต์มาตรฐาน' : 'Default font'}</option>
    {fonts.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
    {missing && <option value={value}>{th ? '(ไม่พบฟอนต์ ใช้ฟอนต์มาตรฐานแทน)' : '(font missing, using the default)'}</option>}
  </select><button type="button" className="text-link" onClick={() => void addFontsWithMessage(th, onMessage)}>{th ? '+ เพิ่มไฟล์ฟอนต์' : '+ Add a font file'}</button></label>;
}

function FontLibrary({ th, onMessage }: { th: boolean; onMessage: (message: string) => void }) {
  const fonts = useFonts();
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState('');
  useEffect(() => { void refreshFonts(); }, []);
  async function addFonts() {
    setBusy(true);
    try { await addFontsWithMessage(th, onMessage); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (confirmId !== id) { setConfirmId(id); return; }
    setConfirmId('');
    try { await removeFont(id); onMessage(th ? 'ลบฟอนต์แล้ว เทมเพลตที่ใช้ฟอนต์นี้จะกลับไปใช้ฟอนต์มาตรฐาน' : 'Font removed. Templates that used it fall back to the default font.'); }
    catch (error) { onMessage(error instanceof Error ? error.message : 'Could not remove the font.'); }
  }
  return <section className="font-library">
    <h2>{th ? 'ฟอนต์ของคุณ' : 'Your fonts'}</h2>
    <p>{th ? 'เพิ่มไฟล์ฟอนต์ (.ttf .otf .woff .woff2) เพื่อใช้กับข้อความในเทมเพลต ใช้เฉพาะฟอนต์ที่คุณมีสิทธิ์ใช้งาน' : 'Add font files (.ttf .otf .woff .woff2) to use for template text. Only add fonts you are licensed to use.'}</p>
    <button type="button" className="camera-secondary" onClick={() => void addFonts()} disabled={busy}>{th ? 'เพิ่มไฟล์ฟอนต์' : 'Add font files'}</button>
    {fonts.length === 0 ? <small>{th ? 'ยังไม่มีฟอนต์ที่เพิ่มเอง' : 'No custom fonts yet.'}</small> : <ul className="font-library-list">{fonts.map(font => <li key={font.id}>
      <span className="font-sample" style={{ fontFamily: fontStack(font.id) }}>{font.name} · Aa กขค 123</span>
      <button type="button" className="text-link" onClick={() => void remove(font.id)}>{confirmId === font.id ? (th ? 'กดอีกครั้งเพื่อลบ' : 'Click again to remove') : (th ? 'ลบ' : 'Remove')}</button>
    </li>)}</ul>}
  </section>;
}
