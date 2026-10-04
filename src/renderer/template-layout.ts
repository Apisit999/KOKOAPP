export type PhotoSlot = { x: number; y: number; width: number; height: number };
export type PixelRect = { x: number; y: number; width: number; height: number };

export function defaultPhotoSlots(count: 1 | 2 | 4, title: string, logo: string, footer: string, showDate: boolean): PhotoSlot[] {
  const width = 1200;
  const height = count === 1 ? 1500 : count === 2 ? 1800 : 1600;
  const top = title || logo ? 190 : 90;
  const footerHeight = footer || showDate ? 190 : 90;
  const gap = 24;
  const side = 82;
  const areaHeight = height - top - footerHeight - side;
  const boxes = count === 1
    ? [{ x: side, y: top, width: width - side * 2, height: areaHeight }]
    : count === 2
      ? [0, 1].map(index => ({ x: side, y: top + index * (areaHeight + gap) / 2, width: width - side * 2, height: (areaHeight - gap) / 2 }))
      : [0, 1, 2, 3].map(index => ({ x: side + (index % 2) * (width - side * 2 + gap) / 2, y: top + Math.floor(index / 2) * (areaHeight + gap) / 2, width: (width - side * 2 - gap) / 2, height: (areaHeight - gap) / 2 }));
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
