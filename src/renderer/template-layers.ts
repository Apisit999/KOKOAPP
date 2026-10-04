import type { CaptureImageLayer, CaptureTextLayer } from '../shared/contract';
import { normalizedRectToPixels } from './template-layout.ts';

const COLOR = /^#[0-9a-f]{6}$/i;
export const MAX_STICKER_BYTES = 100 * 1024;
export const MAX_STICKER_LAYERS = 4;

export function validImageLayer(value: unknown): value is CaptureImageLayer {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 80
    && typeof item.src === 'string' && item.src.length <= 4 / 3 * MAX_STICKER_BYTES + 64
    && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.src)
    && ['x', 'y', 'width', 'height'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
    && (item.x as number) >= 0 && (item.y as number) >= 0
    && (item.width as number) >= 8 && (item.height as number) >= 6
    && (item.x as number) + (item.width as number) <= 100
    && (item.y as number) + (item.height as number) <= 100;
}

export type LoadedImageLayer = CaptureImageLayer & { bitmap: ImageBitmap };

export async function loadImageLayers(layers: CaptureImageLayer[] | undefined): Promise<LoadedImageLayer[]> {
  const loaded: LoadedImageLayer[] = [];
  try {
    for (const layer of layers ?? []) {
      if (!validImageLayer(layer)) continue;
      const bitmap = await createImageBitmap(await (await fetch(layer.src)).blob());
      loaded.push({ ...layer, bitmap });
    }
    return loaded;
  } catch (error) {
    loaded.forEach(layer => layer.bitmap.close());
    throw error;
  }
}

export function drawImageLayers(context: CanvasRenderingContext2D, layers: LoadedImageLayer[], width: number, height: number) {
  for (const layer of layers) {
    const rect = normalizedRectToPixels(layer, width, height);
    context.drawImage(layer.bitmap, rect.x, rect.y, rect.width, rect.height);
  }
}

export function validTextLayer(value: unknown): value is CaptureTextLayer {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 80
    && typeof item.text === 'string' && item.text.length <= 100
    && ['x', 'y', 'width', 'fontSize'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
    && (item.x as number) >= 0 && (item.y as number) >= 0
    && (item.width as number) >= 10 && (item.x as number) + (item.width as number) <= 100
    && (item.fontSize as number) >= 1 && (item.fontSize as number) <= 12
    && typeof item.color === 'string' && COLOR.test(item.color)
    && ['left', 'center', 'right'].includes(item.align as string);
}

export function drawTextLayers(context: CanvasRenderingContext2D, layers: CaptureTextLayer[] | undefined, width: number, height: number) {
  if (!layers?.length) return;
  context.save();
  context.textBaseline = 'top';
  for (const layer of layers) {
    if (!validTextLayer(layer) || !layer.text.trim()) continue;
    const fontSize = Math.max(8, height * layer.fontSize / 100);
    const x = width * layer.x / 100;
    const maxWidth = width * layer.width / 100;
    context.font = `600 ${fontSize}px sans-serif`;
    context.fillStyle = layer.color;
    context.textAlign = layer.align;
    const anchor = layer.align === 'left' ? x : layer.align === 'center' ? x + maxWidth / 2 : x + maxWidth;
    const lines = wrapLines(context, layer.text, maxWidth, 3);
    lines.forEach((line, index) => context.fillText(line, anchor, height * layer.y / 100 + index * fontSize * 1.18, maxWidth));
  }
  context.restore();
}

export function wrapLines(context: Pick<CanvasRenderingContext2D, 'measureText'>, value: string, maxWidth: number, maxLines: number): string[] {
  const result: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        result.push(line);
        line = word;
        if (result.length >= maxLines) return result;
      } else line = candidate;
    }
    if (line) result.push(line);
    if (result.length >= maxLines) break;
  }
  return result.slice(0, maxLines);
}
