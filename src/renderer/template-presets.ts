// Ready-made starting points for the photo template editor. They are plain data (colours, text and a
// photo count) so they ship no artwork; a renter can still add a logo, a PNG frame and stickers afterwards.

import type { TemplateCount, TemplateSizeId } from '../shared/template-size.ts';

export const PRESET_BACKGROUNDS = ['#171714', '#f4f0e6', '#e9c9c3', '#c7d0bd'] as const;

export type TemplatePreset = {
  id: string;
  name: { th: string; en: string };
  count: TemplateCount;
  /** Omitted for the original sizes. */
  size?: TemplateSizeId;
  title: { th: string; en: string };
  footer: { th: string; en: string };
  background: (typeof PRESET_BACKGROUNDS)[number];
  frame: string;
  showDate: boolean;
};

export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  { id: 'strip-3', name: { th: 'แถบรูป 3 ภาพ', en: 'Photo strip · 3 photos' }, count: 3, size: 'strip', title: { th: 'โฟโต้บูธ', en: 'Photo Booth' }, footer: { th: 'ขอบคุณที่มาถ่ายรูปด้วยกัน', en: 'Thanks for stopping by' }, background: '#171714', frame: '#d6b36a', showDate: true },
  { id: 'strip-4', name: { th: 'แถบรูป 4 ภาพ', en: 'Photo strip · 4 photos' }, count: 4, size: 'strip', title: { th: 'ความทรงจำสนุก ๆ', en: 'Memories in a Moment' }, footer: { th: 'ถ่ายด้วยกันนะ', en: 'Smile, click, repeat' }, background: '#f4f0e6', frame: '#b8975a', showDate: true },
  { id: 'strip-wedding', name: { th: 'แถบรูปงานแต่งงาน', en: 'Wedding strip' }, count: 3, size: 'strip', title: { th: 'วันแต่งงานของเรา', en: 'Our Wedding Day' }, footer: { th: 'ขอบคุณที่มาร่วมแสดงความยินดี', en: 'Thank you for celebrating with us' }, background: '#f4f0e6', frame: '#b8975a', showDate: true },
  { id: 'strip-birthday', name: { th: 'แถบรูปวันเกิด', en: 'Birthday strip' }, count: 4, size: 'strip', title: { th: 'สุขสันต์วันเกิด!', en: 'Happy Birthday!' }, footer: { th: 'ขอให้มีความสุขมาก ๆ', en: 'Made with love' }, background: '#e9c9c3', frame: '#c0566b', showDate: true },
  { id: 'landscape-group', name: { th: 'โปสการ์ดแนวนอน', en: 'Landscape postcard' }, count: 1, size: 'landscape', title: { th: 'ภาพหมู่', en: 'Group Photo' }, footer: { th: 'ขอบคุณที่มาร่วมงาน', en: 'Thank you for coming' }, background: '#171714', frame: '#d6b36a', showDate: true },
  { id: 'landscape-row', name: { th: 'แนวนอน 3 ภาพ', en: 'Landscape · 3 in a row' }, count: 3, size: 'landscape', title: { th: 'ช่วงเวลาดี ๆ', en: 'Good Times' }, footer: { th: 'เวลาดี ๆ กับเพื่อนดี ๆ', en: 'Good times, good friends' }, background: '#c7d0bd', frame: '#5d7a58', showDate: true },
  { id: 'square-social', name: { th: 'จัตุรัสโซเชียล', en: 'Square for social' }, count: 4, size: 'square', title: { th: 'วันสนุกของเรา', en: 'Our Fun Day' }, footer: { th: '#แท็กงานของคุณ', en: '#YourEventTag' }, background: '#171714', frame: '#d6b36a', showDate: false },
  { id: 'story-3', name: { th: 'สตอรี่ 3 ภาพ', en: 'Story · 3 photos' }, count: 3, size: 'story', title: { th: 'วันนี้สนุกมาก', en: 'What a Day' }, footer: { th: 'แชร์ลงสตอรี่ได้เลย', en: 'Share it to your story' }, background: '#e9c9c3', frame: '#c0566b', showDate: true },
  { id: 'wedding', name: { th: 'งานแต่งงาน', en: 'Wedding' }, count: 2, title: { th: 'วันแต่งงานของเรา', en: 'Our Wedding Day' }, footer: { th: 'ขอบคุณที่มาร่วมแสดงความยินดี', en: 'Thank you for celebrating with us' }, background: '#f4f0e6', frame: '#b8975a', showDate: true },
  { id: 'birthday', name: { th: 'วันเกิด', en: 'Birthday' }, count: 4, title: { th: 'สุขสันต์วันเกิด!', en: 'Happy Birthday!' }, footer: { th: 'ขอให้มีความสุขมาก ๆ', en: 'Made with love' }, background: '#e9c9c3', frame: '#c0566b', showDate: true },
  { id: 'corporate', name: { th: 'งานบริษัท', en: 'Corporate' }, count: 1, title: { th: 'งานบริษัท', en: 'Company Event' }, footer: { th: 'ขอบคุณที่ร่วมงานกับเรา', en: 'Thank you for joining us' }, background: '#171714', frame: '#6f8fb8', showDate: true },
  { id: 'party', name: { th: 'ปาร์ตี้', en: 'Party night' }, count: 4, title: { th: 'ปาร์ตี้ไนท์', en: 'Party Night' }, footer: { th: 'เวลาดี ๆ กับเพื่อนดี ๆ', en: 'Good times, great friends' }, background: '#171714', frame: '#e0b84c', showDate: false },
  { id: 'baby', name: { th: 'งานรับขวัญ', en: 'Baby shower' }, count: 2, title: { th: 'ต้อนรับสมาชิกใหม่', en: 'Welcome, Little One' }, footer: { th: 'ขอบคุณที่มาร่วมแบ่งปันความสุข', en: 'Thank you for sharing the joy' }, background: '#c7d0bd', frame: '#7c9a6e', showDate: true },
  { id: 'graduation', name: { th: 'รับปริญญา', en: 'Graduation' }, count: 1, title: { th: 'ยินดีด้วยบัณฑิตใหม่', en: 'Congratulations, Graduate!' }, footer: { th: 'ก้าวต่อไปของความสำเร็จ', en: 'The next chapter begins' }, background: '#f4f0e6', frame: '#1f3a5f', showDate: true }
];

type PresetTarget = {
  name: string;
  count: TemplateCount;
  size?: TemplateSizeId;
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
  const layoutChanged = current.count !== preset.count || current.size !== preset.size;
  return {
    ...current,
    name: current.name.trim() ? current.name : preset.name[language],
    count: preset.count,
    size: preset.size,
    title: preset.title[language],
    footer: preset.footer[language],
    background: preset.background,
    frame: preset.frame,
    showDate: preset.showDate,
    overlay: layoutChanged ? '' : current.overlay,
    slots: layoutChanged ? undefined : current.slots
  };
}
