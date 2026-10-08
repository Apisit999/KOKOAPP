import type { CaptureImageLayer, CaptureTextLayer } from '../shared/contract';
import { isValidPhotoSlot, type PhotoSlot } from './template-layout.ts';
import { MAX_STICKER_LAYERS, validImageLayer, validTextLayer } from './template-layers.ts';

export type PortableTemplate = {
  id: string; name: string; count: 1 | 2 | 4; title: string; footer: string;
  background: string; frame: string; showDate: boolean; logo: string; overlay: string;
  videoOverlay: string; slots?: PhotoSlot[]; videoFrame?: PhotoSlot; videoAspect?: number;
  textLayers?: CaptureTextLayer[]; videoTextLayers?: CaptureTextLayer[];
  imageLayers?: CaptureImageLayer[]; videoImageLayers?: CaptureImageLayer[];
};
export const TEMPLATE_ARCHIVE_MAX_BYTES = 4_000_000;
const COLORS = /^#[0-9a-f]{6}$/i;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function exportTemplateArchive(templates: PortableTemplate[]): string {
  const archive = { format: 'koko-template-archive', version: 1, templates };
  const json = JSON.stringify(archive, null, 2);
  if (json.length > TEMPLATE_ARCHIVE_MAX_BYTES) throw new Error('Template archive exceeds 4 MB.');
  return json;
}

export function parseTemplateArchive(json: string): PortableTemplate[] {
  if (json.length > TEMPLATE_ARCHIVE_MAX_BYTES) throw new Error('Template archive exceeds 4 MB.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('This is not valid JSON.'); }
  if (!value || typeof value !== 'object') throw new Error('Unsupported template archive.');
  const archive = value as Record<string, unknown>;
  if (archive.format !== 'koko-template-archive' || archive.version !== 1 || !Array.isArray(archive.templates)) throw new Error('Unsupported template archive format or version.');
  if (archive.templates.length > 100) throw new Error('An archive can contain up to 100 templates.');
  const templates = archive.templates.map(validateTemplate);
  if (new Set(templates.map(item => item.id)).size !== templates.length) throw new Error('Template IDs must be unique in an archive.');
  return templates;
}

function validateTemplate(value: unknown): PortableTemplate {
  if (!value || typeof value !== 'object') throw new Error('Archive contains an invalid template.');
  const item = value as Record<string, unknown>;
  const text = (key: string, max: number) => typeof item[key] === 'string' && (item[key] as string).length <= max;
  if (!text('id', 80) || !item.id || !text('name', 120) || !item.name || ![1, 2, 4].includes(item.count as number)
    || !text('title', 200) || !text('footer', 200) || !COLORS.test(String(item.background)) || !COLORS.test(String(item.frame))
    || typeof item.showDate !== 'boolean' || !['logo', 'overlay', 'videoOverlay'].every(key => text(key, 2_000_000))) {
    throw new Error('Archive contains a template with invalid fields.');
  }
  for (const key of ['logo', 'overlay', 'videoOverlay']) {
    const src = item[key] as string;
    if (src && !DATA_IMAGE.test(src)) throw new Error('Template images must be embedded PNG, JPEG, or WebP data.');
  }
  const slots = (key: string, max: number) => {
    const list = item[key];
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length > max || !list.every(isValidPhotoSlot)) throw new Error('Archive contains invalid photo layout data.');
    return list as PhotoSlot[];
  };
  const layers = <T>(key: string, max: number, valid: (entry: unknown) => entry is T) => {
    const list = item[key];
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length > max || !list.every(valid)) throw new Error('Archive contains invalid text or sticker layers.');
    return list as T[];
  };
  if (item.videoFrame !== undefined && !isValidPhotoSlot(item.videoFrame)) throw new Error('Archive contains invalid video layout data.');
  if (item.videoAspect !== undefined && (typeof item.videoAspect !== 'number' || !Number.isFinite(item.videoAspect) || item.videoAspect < 0.2 || item.videoAspect > 5)) throw new Error('Archive contains invalid video aspect data.');
  const photoSlots = slots('slots', 4);
  if (photoSlots && photoSlots.length !== item.count) throw new Error('Photo slot count must match the template photo count.');
  return { id: item.id as string, name: item.name as string, count: item.count as 1 | 2 | 4, title: item.title as string, footer: item.footer as string,
    background: item.background as string, frame: item.frame as string, showDate: item.showDate, logo: item.logo as string, overlay: item.overlay as string, videoOverlay: item.videoOverlay as string,
    slots: photoSlots, videoFrame: item.videoFrame as PhotoSlot | undefined, videoAspect: item.videoAspect as number | undefined,
    textLayers: layers('textLayers', 6, validTextLayer), videoTextLayers: layers('videoTextLayers', 6, validTextLayer),
    imageLayers: layers('imageLayers', MAX_STICKER_LAYERS, validImageLayer), videoImageLayers: layers('videoImageLayers', MAX_STICKER_LAYERS, validImageLayer) };
}

export function mergeTemplateArchive(saved: PortableTemplate[], imported: PortableTemplate[]): PortableTemplate[] {
  const byId = new Map(saved.map(template => [template.id, template]));
  for (const template of imported) byId.set(template.id, template);
  return [...byId.values()];
}
