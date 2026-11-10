import { canvasSize, sizeInfo, type TemplateCount, type TemplateSizeId } from '../shared/template-size.ts';
export type PhotoSlot = { x: number; y: number; width: number; height: number };
export type PixelRect = { x: number; y: number; width: number; height: number };

/** Grid (columns x rows) used for a photo count in each size: strips stack, landscape sizes run in a row, four photos make a 2 x 2 grid. */
export function slotGrid(count: TemplateCount, flow: 'portrait' | 'landscape' | 'strip'): { columns: number; rows: number } {
  if (count === 4 && flow !== 'strip') return { columns: 2, rows: 2 };
  if (flow === 'landscape') return { columns: count, rows: 1 };
  return { columns: 1, rows: count };
}

export function defaultPhotoSlots(count: TemplateCount, title: string, logo: string, footer: string, showDate: boolean, size?: TemplateSizeId): PhotoSlot[] {
  const info = sizeInfo(size);
  const { width, height } = canvasSize(size, count);
  const unit = Math.min(width, height) / 1200;
  const top = (title || logo ? 190 : 90) * unit;
  const footerHeight = (footer || showDate ? 190 : 90) * unit;
  const gap = 24 * unit;
  const side = 82 * unit;
  const areaWidth = width - side * 2;
  const areaHeight = height - top - footerHeight - side;
  const { columns, rows } = slotGrid(count, info.flow);
  const boxWidth = (areaWidth - gap * (columns - 1)) / columns;
  const boxHeight = (areaHeight - gap * (rows - 1)) / rows;
  const boxes = Array.from({ length: count }, (_, index) => ({
    x: side + (index % columns) * (boxWidth + gap), y: top + Math.floor(index / columns) * (boxHeight + gap), width: boxWidth, height: boxHeight
  }));
  return boxes.map(box => ({ x: box.x / width * 100, y: box.y / height * 100, width: box.width / width * 100, height: box.height / height * 100 }));
}

export function movePhotoSlot(slot: PhotoSlot, dx: number, dy: number): PhotoSlot {
  return { ...slot, x: clamp(slot.x + dx, 0, 100 - slot.width), y: clamp(slot.y + dy, 0, 100 - slot.height) };
}

export function resizePhotoSlot(slot: PhotoSlot, dx: number, dy: number): PhotoSlot {
  return { ...slot, width: clamp(slot.width + dx, 8, 100 - slot.x), height: clamp(slot.height + dy, 6, 100 - slot.y) };
}

export function isValidPhotoSlot(value: unknown): value is PhotoSlot {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Record<string, unknown>;
  return typeof slot.x === 'number' && Number.isFinite(slot.x) && slot.x >= 0 && slot.x <= 100
    && typeof slot.y === 'number' && Number.isFinite(slot.y) && slot.y >= 0 && slot.y <= 100
    && typeof slot.width === 'number' && Number.isFinite(slot.width) && slot.width >= 8 && slot.width <= 100 - slot.x
    && typeof slot.height === 'number' && Number.isFinite(slot.height) && slot.height >= 6 && slot.height <= 100 - slot.y;
}

export function normalizedRectToPixels(rect: PhotoSlot, canvasWidth: number, canvasHeight: number): PixelRect {
  if (!isValidPhotoSlot(rect) || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('Invalid normalized frame geometry');
  }
  return { x: rect.x / 100 * canvasWidth, y: rect.y / 100 * canvasHeight, width: rect.width / 100 * canvasWidth, height: rect.height / 100 * canvasHeight };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
