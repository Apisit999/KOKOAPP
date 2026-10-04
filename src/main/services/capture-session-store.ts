import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CaptureSessionRecord, CaptureTemplateSnapshot } from '../../shared/contract';

type SessionIndex = { schemaVersion: 1; sessions: CaptureSessionRecord[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
function validPhotoSlot(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(key => typeof slot[key] === 'number' && Number.isFinite(slot[key]))
    && (slot.x as number) >= 0 && (slot.y as number) >= 0
    && (slot.width as number) >= 8 && (slot.height as number) >= 6
    && (slot.x as number) + (slot.width as number) <= 100
    && (slot.y as number) + (slot.height as number) <= 100;
}
function validTextLayer(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const layer = value as Record<string, unknown>;
  return typeof layer.id === 'string' && layer.id.length > 0 && layer.id.length <= 80
    && typeof layer.text === 'string' && layer.text.length <= 100
    && ['x', 'y', 'width', 'fontSize'].every(key => typeof layer[key] === 'number' && Number.isFinite(layer[key]))
    && (layer.x as number) >= 0 && (layer.y as number) >= 0
    && (layer.width as number) >= 10 && (layer.x as number) + (layer.width as number) <= 100
    && (layer.fontSize as number) >= 1 && (layer.fontSize as number) <= 12
    && typeof layer.color === 'string' && COLOR.test(layer.color)
    && ['left', 'center', 'right'].includes(layer.align as string);
}
function validImageLayer(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const layer = value as Record<string, unknown>;
  return typeof layer.id === 'string' && layer.id.length > 0 && layer.id.length <= 80
    && typeof layer.src === 'string' && layer.src.length <= 4 / 3 * 100 * 1024 + 64
    && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(layer.src)
    && ['x', 'y', 'width', 'height'].every(key => typeof layer[key] === 'number' && Number.isFinite(layer[key]))
    && (layer.x as number) >= 0 && (layer.y as number) >= 0
    && (layer.width as number) >= 8 && (layer.height as number) >= 6
    && (layer.x as number) + (layer.width as number) <= 100
    && (layer.y as number) + (layer.height as number) <= 100;
}

export function validateCaptureTemplate(value: unknown): CaptureTemplateSnapshot | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') throw new Error('Invalid capture template');
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 80
    || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60
    || ![1, 2, 4].includes(item.count as number)
    || typeof item.title !== 'string' || item.title.length > 60
    || typeof item.footer !== 'string' || item.footer.length > 80
    || typeof item.background !== 'string' || !COLOR.test(item.background)
    || typeof item.frame !== 'string' || !COLOR.test(item.frame)
    || typeof item.showDate !== 'boolean'
    || (item.slots !== undefined && (!Array.isArray(item.slots) || item.slots.length !== item.count || !item.slots.every(validPhotoSlot)))
    || (item.textLayers !== undefined && (!Array.isArray(item.textLayers) || item.textLayers.length > 6 || !item.textLayers.every(validTextLayer)))
    || (item.videoTextLayers !== undefined && (!Array.isArray(item.videoTextLayers) || item.videoTextLayers.length > 6 || !item.videoTextLayers.every(validTextLayer)))
    || (item.videoFrame !== undefined && !validPhotoSlot(item.videoFrame))
    || (item.imageLayers !== undefined && (!Array.isArray(item.imageLayers) || item.imageLayers.length > 4 || !item.imageLayers.every(validImageLayer)))
    || (item.videoImageLayers !== undefined && (!Array.isArray(item.videoImageLayers) || item.videoImageLayers.length > 4 || !item.videoImageLayers.every(validImageLayer)))
    || (item.overlay !== undefined && (typeof item.overlay !== 'string' || item.overlay.length > 700_000
      || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.overlay)))) throw new Error('Invalid capture template');
  return { id: item.id, name: item.name.trim(), count: item.count as 1 | 2 | 4, title: item.title, footer: item.footer,
    background: item.background, frame: item.frame, showDate: item.showDate, ...(typeof item.overlay === 'string' ? { overlay: item.overlay } : {}),
    ...(Array.isArray(item.slots) ? { slots: item.slots as Array<{ x: number; y: number; width: number; height: number }> } : {}),
    ...(Array.isArray(item.textLayers) ? { textLayers: item.textLayers as CaptureTemplateSnapshot['textLayers'] } : {}),
    ...(Array.isArray(item.videoTextLayers) ? { videoTextLayers: item.videoTextLayers as CaptureTemplateSnapshot['videoTextLayers'] } : {}),
    ...(item.videoFrame && typeof item.videoFrame === 'object' ? { videoFrame: item.videoFrame as CaptureTemplateSnapshot['videoFrame'] } : {}),
    ...(Array.isArray(item.imageLayers) ? { imageLayers: item.imageLayers as CaptureTemplateSnapshot['imageLayers'] } : {}),
    ...(Array.isArray(item.videoImageLayers) ? { videoImageLayers: item.videoImageLayers as CaptureTemplateSnapshot['videoImageLayers'] } : {}) };
}

function validRecord(value: unknown): value is CaptureSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  try {
    return typeof item.id === 'string' && UUID.test(item.id)
      && (item.eventId === null || (typeof item.eventId === 'string' && UUID.test(item.eventId)))
      && (item.template === null || validateCaptureTemplate(item.template) !== null)
      && Array.isArray(item.photoIds) && item.photoIds.length <= 4 && item.photoIds.every(id => typeof id === 'string' && UUID.test(id))
      && new Set(item.photoIds).size === item.photoIds.length
      && (item.compositionPhotoId === undefined || (typeof item.compositionPhotoId === 'string' && UUID.test(item.compositionPhotoId) && !item.photoIds.includes(item.compositionPhotoId)))
      && (item.videoIds === undefined || (Array.isArray(item.videoIds) && item.videoIds.length <= 1 && item.videoIds.every(id => typeof id === 'string' && UUID.test(id)) && new Set(item.videoIds).size === item.videoIds.length))
      && ['capturing', 'review', 'confirmed', 'interrupted', 'cancelled', 'retaken'].includes(item.status as string)
      && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
      && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt));
  } catch { return false; }
}

/** Durable local record of capture rounds. Source images remain in PhotoStore. */
export class CaptureSessionStore {
  private readonly file: string;
  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, 'capture-sessions.json');
    this.recoverInterrupted();
  }

  start(eventId: string | null, template: CaptureTemplateSnapshot | null): CaptureSessionRecord {
    if (eventId !== null && !UUID.test(eventId)) throw new Error('Invalid event ID');
    const now = new Date().toISOString();
    const item: CaptureSessionRecord = { id: randomUUID(), eventId, template, photoIds: [], videoIds: [], status: 'capturing', createdAt: now, updatedAt: now };
    const index = this.read();
    index.sessions.unshift(item);
    this.write({ schemaVersion: 1, sessions: index.sessions.slice(0, 2000) });
    return item;
  }

  addPhoto(sessionId: string, photoId: string) {
    if (!UUID.test(sessionId) || !UUID.test(photoId)) throw new Error('Invalid capture session photo');
    const index = this.read();
    const item = index.sessions.find(session => session.id === sessionId);
    if (!item || item.status !== 'capturing') throw new Error('Capture session is no longer active');
    if (item.photoIds.length >= 4 || item.photoIds.includes(photoId)) throw new Error('Capture session photo limit reached');
    item.photoIds.push(photoId);
    item.updatedAt = new Date().toISOString();
    this.write(index);
  }

  addVideo(sessionId: string, videoId: string) {
    if (!UUID.test(sessionId) || !UUID.test(videoId)) throw new Error('Invalid capture session video');
    const index = this.read();
    const item = index.sessions.find(session => session.id === sessionId);
    if (!item || item.status !== 'capturing') throw new Error('Capture session is no longer active');
    item.videoIds ??= [];
    if (item.videoIds.length >= 1 || item.videoIds.includes(videoId)) throw new Error('Capture session video limit reached');
    item.videoIds.push(videoId);
    item.updatedAt = new Date().toISOString();
    this.write(index);
  }

  attachComposition(sessionId: string, photoId: string) {
    if (!UUID.test(sessionId) || !UUID.test(photoId)) throw new Error('Invalid composed photo');
    const index = this.read();
    const item = index.sessions.find(session => session.id === sessionId);
    if (!item || item.status !== 'review' || !item.template) throw new Error('Capture session is not ready for a composed photo');
    if (item.compositionPhotoId && item.compositionPhotoId !== photoId) throw new Error('Capture session already has a composed photo');
    item.compositionPhotoId = photoId;
    item.updatedAt = new Date().toISOString();
    this.write(index);
    return item;
  }

  finish(sessionId: string, status: 'review' | 'confirmed' | 'cancelled' | 'retaken' | 'interrupted') {
    if (!UUID.test(sessionId)) throw new Error('Invalid capture session');
    const index = this.read();
    const item = index.sessions.find(session => session.id === sessionId);
    if (!item) return null;
    if (item.status === 'confirmed' || item.status === 'cancelled' || item.status === 'retaken') return item;
    if (status === 'review' && item.status !== 'capturing') throw new Error('Capture session cannot enter review');
    if ((status === 'confirmed' || status === 'retaken') && item.status !== 'review') throw new Error('Capture session is not awaiting confirmation');
    item.status = status;
    item.updatedAt = new Date().toISOString();
    this.write(index);
    return item;
  }

  /** End an in-progress capture without discarding photos already committed to local storage. */
  cancel(sessionId: string) {
    if (!UUID.test(sessionId)) throw new Error('Invalid capture session');
    const index = this.read();
    const item = index.sessions.find(session => session.id === sessionId);
    if (!item || item.status !== 'capturing') return item ?? null;
    item.status = item.photoIds.length ? 'review' : 'cancelled';
    item.updatedAt = new Date().toISOString();
    this.write(index);
    return item;
  }

  list(limit = 100): CaptureSessionRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid capture session page');
    return this.read().sessions.slice(0, limit);
  }

  private recoverInterrupted() {
    const index = this.read();
    let recovered = false;
    for (const item of index.sessions) if (item.status === 'capturing') {
      item.status = 'interrupted'; item.updatedAt = new Date().toISOString(); recovered = true;
    }
    if (recovered) this.write(index);
  }

  private read(): SessionIndex {
    if (!existsSync(this.file)) return { schemaVersion: 1, sessions: [] };
    const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('Capture session index is invalid');
    const value = parsed as Record<string, unknown>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.sessions) || !value.sessions.every(validRecord)
      || new Set(value.sessions.map(item => item.id)).size !== value.sessions.length) throw new Error('Capture session index is invalid');
    return value as SessionIndex;
  }

  private write(index: SessionIndex) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(index), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
