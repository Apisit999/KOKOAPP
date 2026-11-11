// Colour looks a template can apply to its photos when the picture is composed. Stored as an id; unknown ids mean "no filter".

export type PhotoFilterId = 'bw' | 'sepia' | 'vivid' | 'soft' | 'warm' | 'cool';

export const PHOTO_FILTERS: readonly { id: PhotoFilterId; css: string; th: string; en: string }[] = [
  { id: 'bw', css: 'grayscale(1) contrast(1.1)', th: 'ขาวดำ', en: 'Black & white' },
  { id: 'sepia', css: 'sepia(0.85) contrast(1.05)', th: 'วินเทจ', en: 'Vintage' },
  { id: 'vivid', css: 'saturate(1.45) contrast(1.08)', th: 'สีสด', en: 'Vivid' },
  { id: 'soft', css: 'brightness(1.06) contrast(0.92) saturate(1.1)', th: 'นุ่มนวล', en: 'Soft' },
  { id: 'warm', css: 'sepia(0.25) saturate(1.2) hue-rotate(-8deg)', th: 'โทนอุ่น', en: 'Warm' },
  { id: 'cool', css: 'saturate(1.05) hue-rotate(12deg) brightness(1.02)', th: 'โทนเย็น', en: 'Cool' }
];

export const isPhotoFilter = (value: unknown): value is PhotoFilterId => PHOTO_FILTERS.some(item => item.id === value);

/** The canvas/CSS filter string for a filter id, or 'none'. */
export function filterCss(id: unknown): string {
  return PHOTO_FILTERS.find(item => item.id === id)?.css ?? 'none';
}
