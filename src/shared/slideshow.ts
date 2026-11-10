// Live slideshow for the guest display: which finished pictures to show and when to move on. Pure logic, no UI and no files.

export type SlideshowSettings = { enabled: boolean; secondsPerSlide: 4 | 6 | 10; limit: 20 | 50 | 100 };
export const DEFAULT_SLIDESHOW: SlideshowSettings = { enabled: false, secondsPerSlide: 6, limit: 50 };
/** After this long without anyone using the booth the display starts the slideshow. */
export const IDLE_BEFORE_SLIDESHOW_MS = 20_000;

type SessionLike = {
  id: string; eventId: string | null; status: string; photoIds: string[]; compositionPhotoId?: string; createdAt: string; updatedAt?: string;
};

/** Reads stored settings; anything unexpected falls back to the default for that field. */
export function normalizeSlideshowSettings(value: unknown): SlideshowSettings {
  const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    enabled: item.enabled === true,
    secondsPerSlide: item.secondsPerSlide === 4 || item.secondsPerSlide === 10 ? item.secondsPerSlide : 6,
    limit: item.limit === 20 || item.limit === 100 ? item.limit : 50
  };
}

/**
 * Photo ids to show for one event, newest round first. Only confirmed rounds count, so a retaken or cancelled round
 * never reaches the screen. A round shows its composed picture when it has one, otherwise its photos.
 */
export function pickSlideshowPhotoIds(sessions: SessionLike[], eventId: string | null, limit: number): string[] {
  const rounds = sessions
    .filter(session => session.status === 'confirmed' && session.eventId === eventId)
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const session of rounds) {
    const ids = session.compositionPhotoId ? [session.compositionPhotoId] : session.photoIds;
    for (const id of ids) {
      if (picked.length >= limit) return picked;
      if (!seen.has(id)) { seen.add(id); picked.push(id); }
    }
  }
  return picked;
}

export type SlideshowState = { index: number; shownAt: number; lastActivityAt: number; ids: string[] };

/** True when nobody has used the booth for long enough that the slideshow should take over the display. */
export function slideshowShouldRun(settings: SlideshowSettings, boothBusy: boolean, now: number, lastActivityAt: number, hasPhotos: boolean): boolean {
  return settings.enabled && hasPhotos && !boothBusy && now - lastActivityAt >= IDLE_BEFORE_SLIDESHOW_MS;
}

/**
 * Moves the slideshow on. `fresh` are ids that appeared since the last call (a just-finished round): they jump the queue so the
 * guest sees their own picture next. Returns the new state; `changed` says whether the picture on screen should change.
 */
export function advanceSlideshow(state: SlideshowState, ids: string[], settings: SlideshowSettings, now: number): { state: SlideshowState; changed: boolean } {
  const fresh = ids.filter(id => !state.ids.includes(id));
  if (!ids.length) return { state: { ...state, ids: [], index: 0 }, changed: state.ids.length > 0 };
  if (fresh.length) {
    const reordered = [...fresh, ...ids.filter(id => !fresh.includes(id))];
    return { state: { ...state, ids: reordered, index: 0, shownAt: now }, changed: true };
  }
  const known = ids.filter(id => state.ids.includes(id));
  const current = state.ids[state.index];
  const order = known.length === ids.length ? state.ids.filter(id => ids.includes(id)) : ids;
  if (now - state.shownAt < settings.secondsPerSlide * 1000) {
    const keep = current && order.includes(current) ? order.indexOf(current) : 0;
    return { state: { ...state, ids: order, index: keep }, changed: false };
  }
  const position = current && order.includes(current) ? order.indexOf(current) : -1;
  return { state: { ...state, ids: order, index: (position + 1) % order.length, shownAt: now }, changed: true };
}
