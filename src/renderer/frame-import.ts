// Helpers for importing a frame design made elsewhere (Canva, Photoshop, ...): a PNG whose photo windows are transparent.
// Finding the windows automatically saves the operator from placing each photo box by hand.

export type Opening = { x: number; y: number; width: number; height: number };
type PixelImage = { width: number; height: number; data: ArrayLike<number> };

const TRANSPARENT_BELOW = 40;       // alpha value (0-255) under which a pixel counts as "see-through"
const MIN_AREA_SHARE = 0.01;        // a window must cover at least 1% of the image
const MIN_FILL = 0.5;               // and fill at least half of its bounding box (rounded corners and ovals pass)
const MAX_EXTENT = 0.95;            // a "window" as large as the image means the file is not a frame at all
const EDGE_MARGIN = 0.3;            // percent; photos may bleed slightly under the frame, which hides anti-aliased edges

/** Returns the rectangular photo windows (percent of the image, reading order) found in the transparent areas of a PNG. */
export function detectOpenings(image: PixelImage): Opening[] {
  const { width, height, data } = image;
  if (width < 8 || height < 8 || data.length < width * height * 4) return [];
  const total = width * height;
  const clear = new Uint8Array(total);
  for (let i = 0; i < total; i++) clear[i] = data[i * 4 + 3] < TRANSPARENT_BELOW ? 1 : 0;
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const found: Array<{ minX: number; maxX: number; minY: number; maxY: number; area: number }> = [];
  for (let start = 0; start < total; start++) {
    if (!clear[start] || seen[start]) continue;
    let top = 0; stack[top++] = start; seen[start] = 1;
    let minX = width, maxX = 0, minY = height, maxY = 0, area = 0;
    while (top > 0) {
      const index = stack[--top];
      const x = index % width; const y = (index - x) / width;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && clear[index - 1] && !seen[index - 1]) { seen[index - 1] = 1; stack[top++] = index - 1; }
      if (x < width - 1 && clear[index + 1] && !seen[index + 1]) { seen[index + 1] = 1; stack[top++] = index + 1; }
      if (y > 0 && clear[index - width] && !seen[index - width]) { seen[index - width] = 1; stack[top++] = index - width; }
      if (y < height - 1 && clear[index + width] && !seen[index + width]) { seen[index + width] = 1; stack[top++] = index + width; }
    }
    found.push({ minX, maxX, minY, maxY, area });
  }
  const windows = found.filter(item => {
    const boxW = item.maxX - item.minX + 1; const boxH = item.maxY - item.minY + 1;
    return item.area >= total * MIN_AREA_SHARE && item.area / (boxW * boxH) >= MIN_FILL
      && !(boxW >= width * MAX_EXTENT && boxH >= height * MAX_EXTENT)
      && boxW >= width * 0.06 && boxH >= height * 0.05;
  });
  const round = (value: number) => Math.round(value * 10) / 10;
  const rects = windows.map(item => {
    const x = Math.max(0, item.minX / width * 100 - EDGE_MARGIN);
    const y = Math.max(0, item.minY / height * 100 - EDGE_MARGIN);
    const right = Math.min(100, (item.maxX + 1) / width * 100 + EDGE_MARGIN);
    const bottom = Math.min(100, (item.maxY + 1) / height * 100 + EDGE_MARGIN);
    return { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) };
  });
  return inReadingOrder(rects);
}

/** Top-to-bottom rows, left-to-right inside a row (windows whose tops are within 5% of the height share a row). */
export function inReadingOrder(rects: Opening[]): Opening[] {
  const byTop = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Opening[][] = [];
  for (const rect of byTop) {
    const row = rows.find(candidate => Math.abs(candidate[0].y - rect.y) <= 5);
    if (row) row.push(rect); else rows.push([rect]);
  }
  return rows.flatMap(row => row.sort((a, b) => a.x - b.x));
}

/** Layout counts the app supports. */
export const SUPPORTED_OPENING_COUNTS = [1, 2, 3, 4] as const;
export const canvasHeightFor = (count: 1 | 2 | 4) => count === 1 ? 1500 : count === 2 ? 1800 : 1600;

/** How much a design must be stretched to fill the 1200-wide canvas of the layout, as a fraction (0.05 = 5%). */
export function stretchNeeded(designWidth: number, designHeight: number, count: 1 | 2 | 4): number {
  const target = 1200 / canvasHeightFor(count);
  return Math.abs(designWidth / designHeight / target - 1);
}

/** Reduces the number of colour levels (keeping transparency) so a detailed design compresses into the size limit. */
export function posterize(image: { data: Uint8ClampedArray }, levels: number): void {
  const step = 255 / (levels - 1);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(Math.round(data[i] / step) * step);
    data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
    data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
  }
}
