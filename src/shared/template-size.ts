// Print/canvas sizes a template can use. A template without a size is a "classic" template (the original three layouts), so every
// template saved before sizes existed keeps exactly the same canvas.

export type TemplateSizeId = 'classic' | 'strip' | 'postcard' | 'landscape' | 'square' | 'story' | 'photo5x7';
export type TemplateCount = 1 | 2 | 3 | 4;

export type TemplateSizeInfo = {
  id: TemplateSizeId;
  /** Canvas pixels for a given photo count (only `classic` changes height with the count). */
  width: number;
  height: (count: TemplateCount) => number;
  counts: readonly TemplateCount[];
  /** Count to start from when a template switches to this size (otherwise the current count is kept if offered). */
  startCount?: TemplateCount;
  /** How photos are arranged: stacked in rows, in a row, or in a 2 x 2 grid for four. */
  flow: 'portrait' | 'landscape' | 'strip';
  ratio: string;
  th: string; en: string;
  hintTh: string; hintEn: string;
};

export const TEMPLATE_SIZES: readonly TemplateSizeInfo[] = [
  { id: 'strip', width: 1200, height: () => 3600, counts: [3, 4, 2], startCount: 3, flow: 'strip', ratio: '1:3',
    th: 'แถบรูปแนวตั้ง 2×6 นิ้ว', en: 'Vertical photo strip 2×6 in', hintTh: 'แบบที่นิยมที่สุด เรียงรูปบนลงล่าง พิมพ์ 2 แถบต่อแผ่น 4×6 แล้วตัดครึ่ง', hintEn: 'The classic booth strip, photos stacked top to bottom. Prints twice on a 4×6 sheet to cut in half.' },
  { id: 'postcard', width: 1200, height: () => 1800, counts: [1, 2, 3, 4], flow: 'portrait', ratio: '2:3',
    th: 'โปสการ์ดแนวตั้ง 4×6 นิ้ว', en: 'Portrait postcard 4×6 in', hintTh: 'ขนาดภาพพิมพ์มาตรฐาน', hintEn: 'The standard photo print size.' },
  { id: 'landscape', width: 1800, height: () => 1200, counts: [1, 2, 3, 4], flow: 'landscape', ratio: '3:2',
    th: 'โปสการ์ดแนวนอน 6×4 นิ้ว', en: 'Landscape postcard 6×4 in', hintTh: 'เหมาะกับภาพหมู่ 3 รูปจัดเป็นภาพใหญ่ 1 ภาพกับภาพเล็ก 2 ภาพ', hintEn: 'Good for group shots; three photos make one large and two small.' },
  { id: 'square', width: 1200, height: () => 1200, counts: [1, 2, 4], flow: 'portrait', ratio: '1:1',
    th: 'จัตุรัส', en: 'Square', hintTh: 'เหมาะกับโซเชียลมีเดีย', hintEn: 'Suits social media.' },
  { id: 'story', width: 1080, height: () => 1920, counts: [1, 2, 3], flow: 'portrait', ratio: '9:16',
    th: 'สตอรี่ 9:16', en: 'Story 9:16', hintTh: 'เต็มจอมือถือแนวตั้ง', hintEn: 'Fills a vertical phone screen.' },
  { id: 'photo5x7', width: 1200, height: () => 1680, counts: [1, 2, 4], flow: 'portrait', ratio: '5:7',
    th: 'ภาพ 5×7 นิ้ว', en: 'Photo 5×7 in', hintTh: 'ขนาดภาพถ่ายใหญ่ขึ้น', hintEn: 'A larger photo print.' },
  { id: 'classic', width: 1200, height: count => count === 1 ? 1500 : count === 2 ? 1800 : 1600, counts: [1, 2, 4], flow: 'portrait', ratio: '4:5 · 2:3 · 3:4',
    th: 'แบบเดิม', en: 'Original', hintTh: 'ขนาดของเทมเพลตรุ่นก่อนหน้า (1 รูป 1200×1500, 2 รูป 1200×1800, 4 รูป 1200×1600)', hintEn: 'The size earlier templates used (1 photo 1200×1500, 2 photos 1200×1800, 4 photos 1200×1600).' }
];

export const TEMPLATE_SIZE_IDS: readonly TemplateSizeId[] = TEMPLATE_SIZES.map(item => item.id);
export const isTemplateSize = (value: unknown): value is TemplateSizeId => typeof value === 'string' && (TEMPLATE_SIZE_IDS as readonly string[]).includes(value);
export const isTemplateCount = (value: unknown): value is TemplateCount => value === 1 || value === 2 || value === 3 || value === 4;

export function sizeInfo(size: TemplateSizeId | undefined | null): TemplateSizeInfo {
  return TEMPLATE_SIZES.find(item => item.id === size) ?? TEMPLATE_SIZES[TEMPLATE_SIZES.length - 1];
}

export function canvasSize(size: TemplateSizeId | undefined | null, count: TemplateCount): { width: number; height: number } {
  const info = sizeInfo(size);
  return { width: info.width, height: info.height(count) };
}

/** Photo counts a size offers. A count the size does not offer is not a valid template. */
export function allowedCounts(size: TemplateSizeId | undefined | null): readonly TemplateCount[] {
  return [...sizeInfo(size).counts].sort((a, b) => a - b);
}

export function countAllowed(size: TemplateSizeId | undefined | null, count: unknown): count is TemplateCount {
  return isTemplateCount(count) && sizeInfo(size).counts.includes(count);
}

/** The count to use after switching to another size: the size's preferred start (strips start at 3), else keep the current one if offered, else the size's first choice. */
export function countAfterSizeChange(size: TemplateSizeId | undefined | null, current: TemplateCount): TemplateCount {
  const info = sizeInfo(size);
  if (info.startCount) return info.startCount;
  return countAllowed(size, current) ? current : info.counts[0];
}

/** For a design made elsewhere: the size whose shape is closest to the design, if any is within 20%. */
export function bestSizeFor(designWidth: number, designHeight: number, count: TemplateCount): TemplateSizeId | null {
  if (!(designWidth > 0 && designHeight > 0)) return null;
  const aspect = designWidth / designHeight;
  let best: { id: TemplateSizeId; gap: number } | null = null;
  for (const info of TEMPLATE_SIZES) {
    if (info.id === 'classic' || !info.counts.includes(count)) continue;
    const gap = Math.abs(aspect / (info.width / info.height(count)) - 1);
    if (gap <= 0.2 && (!best || gap < best.gap)) best = { id: info.id, gap };
  }
  return best ? best.id : null;
}
