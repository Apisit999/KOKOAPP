// Ready-made starting points for the photo template editor. They are plain data (colours, text and a
// photo count) so they ship no artwork; a renter can still add a logo, a PNG frame and stickers afterwards.

export const PRESET_BACKGROUNDS = ['#171714', '#f4f0e6', '#e9c9c3', '#c7d0bd'] as const;

export type TemplatePreset = {
  id: string;
  name: { th: string; en: string };
  count: 1 | 2 | 4;
  title: { th: string; en: string };
  footer: { th: string; en: string };
  background: (typeof PRESET_BACKGROUNDS)[number];
  frame: string;
  showDate: boolean;
};

export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  { id: 'wedding', name: { th: 'งานแต่งงาน', en: 'Wedding' }, count: 2, title: { th: 'วันแต่งงานของเรา', en: 'Our Wedding Day' }, footer: { th: 'ขอบคุณที่มาร่วมแสดงความยินดี', en: 'Thank you for celebrating with us' }, background: '#f4f0e6', frame: '#b8975a', showDate: true },
  { id: 'birthday', name: { th: 'วันเกิด', en: 'Birthday' }, count: 4, title: { th: 'สุขสันต์วันเกิด!', en: 'Happy Birthday!' }, footer: { th: 'ขอให้มีความสุขมาก ๆ', en: 'Made with love' }, background: '#e9c9c3', frame: '#c0566b', showDate: true },
  { id: 'corporate', name: { th: 'งานบริษัท', en: 'Corporate' }, count: 1, title: { th: 'งานบริษัท', en: 'Company Event' }, footer: { th: 'ขอบคุณที่ร่วมงานกับเรา', en: 'Thank you for joining us' }, background: '#171714', frame: '#6f8fb8', showDate: true },
  { id: 'party', name: { th: 'ปาร์ตี้', en: 'Party night' }, count: 4, title: { th: 'ปาร์ตี้ไนท์', en: 'Party Night' }, footer: { th: 'เวลาดี ๆ กับเพื่อนดี ๆ', en: 'Good times, great friends' }, background: '#171714', frame: '#e0b84c', showDate: false },
  { id: 'baby', name: { th: 'งานรับขวัญ', en: 'Baby shower' }, count: 2, title: { th: 'ต้อนรับสมาชิกใหม่', en: 'Welcome, Little One' }, footer: { th: 'ขอบคุณที่มาร่วมแบ่งปันความสุข', en: 'Thank you for sharing the joy' }, background: '#c7d0bd', frame: '#7c9a6e', showDate: true },
  { id: 'graduation', name: { th: 'รับปริญญา', en: 'Graduation' }, count: 1, title: { th: 'ยินดีด้วยบัณฑิตใหม่', en: 'Congratulations, Graduate!' }, footer: { th: 'ก้าวต่อไปของความสำเร็จ', en: 'The next chapter begins' }, background: '#f4f0e6', frame: '#1f3a5f', showDate: true }
];

type PresetTarget = {
  name: string;
  count: 1 | 2 | 4;
  title: string;
  footer: string;
  background: string;
  frame: string;
  showDate: boolean;
  overlay: string;
  slots?: unknown;
};

/**
 * Applies a preset to a template draft. Name, logo, text/sticker layers and the video frame are kept;
 * the PNG frame and custom photo openings are dropped only when the photo count changes, because they
 * were drawn for the old layout (the same rule the Layout buttons already follow).
 */
export function applyTemplatePreset<T extends PresetTarget>(current: T, preset: TemplatePreset, language: 'th' | 'en'): T {
  const layoutChanged = current.count !== preset.count;
  return {
    ...current,
    name: current.name.trim() ? current.name : preset.name[language],
    count: preset.count,
    title: preset.title[language],
    footer: preset.footer[language],
    background: preset.background,
    frame: preset.frame,
    showDate: preset.showDate,
    overlay: layoutChanged ? '' : current.overlay,
    slots: layoutChanged ? undefined : current.slots
  };
}
