import { useSyncExternalStore } from 'react';
import type { FontRecord } from '../shared/contract';

// Imported fonts live in the app data folder. Here they are registered with the page (document.fonts) under a name derived from
// their id, so canvas drawing, live previews and the editor can all use them.
const FONT_ID = /^[0-9a-f]{32}$/;
let records: FontRecord[] = [];
const faces = new Map<string, FontFace>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const fontFamilyName = (id: string) => `koko-font-${id}`;

/** CSS font-family list for a stored font id; falls back when the id is empty, unknown or not loaded. */
export function fontStack(fontId: string | undefined, fallback = 'sans-serif'): string {
  return fontId && FONT_ID.test(fontId) && faces.has(fontId) ? `"${fontFamilyName(fontId)}", ${fallback}` : fallback;
}

async function loadFace(record: FontRecord): Promise<boolean> {
  if (faces.has(record.id)) return true;
  try {
    const { bytes } = await window.koko.readFont(record.id);
    const face = new FontFace(fontFamilyName(record.id), bytes.slice().buffer, { weight: '100 900' });
    await face.load();
    document.fonts.add(face);
    faces.set(record.id, face);
    return true;
  } catch { return false; }
}

/** Reads the font list from the app and registers every font that is not registered yet. */
export async function refreshFonts(): Promise<FontRecord[]> {
  let list: FontRecord[] = [];
  try { list = await window.koko.listFonts(); } catch { list = []; }
  await Promise.all(list.map(loadFace));
  records = list;
  emit();
  return list;
}

/** Waits until the given fonts are registered so a canvas draw uses them instead of the fallback. */
export async function ensureFonts(ids: Array<string | undefined>): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id && FONT_ID.test(id) && !faces.has(id))))];
  if (!wanted.length) return;
  const known = records.length ? records : await refreshFonts();
  await Promise.all(wanted.map(id => known.find(record => record.id === id)).filter((record): record is FontRecord => Boolean(record)).map(loadFace));
}

/** Imports font files chosen in a dialog. Files the browser engine cannot use are removed again and reported. */
export async function importFontFiles(): Promise<{ added: FontRecord[]; failed: string[] }> {
  const result = await window.koko.importFonts();
  const usable: FontRecord[] = [];
  const failed = [...result.failed];
  for (const record of result.added) {
    if (await loadFace(record)) usable.push(record);
    else { failed.push(`${record.name}: the font file is damaged or not supported`); await window.koko.deleteFont(record.id).catch(() => undefined); }
  }
  await refreshFonts();
  return { added: usable, failed };
}

/** Adds a font that came from a template archive (bytes are checked in the main process). */
export async function addFontFromBytes(fileName: string, bytes: Uint8Array): Promise<FontRecord | null> {
  let record: FontRecord;
  try { record = await window.koko.addFontBytes(fileName, bytes); } catch { return null; }
  if (!(await loadFace(record))) { await window.koko.deleteFont(record.id).catch(() => undefined); return null; }
  return record;
}

export async function removeFont(id: string): Promise<boolean> {
  const removed = await window.koko.deleteFont(id);
  const face = faces.get(id);
  if (face) { document.fonts.delete(face); faces.delete(id); }
  await refreshFonts();
  return removed;
}

export function useFonts(): FontRecord[] {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => records);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
