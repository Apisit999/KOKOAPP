import type { CaptureSessionRecord } from '../../shared/contract.ts';

export type RoundDeleteResult = { photos: number; videos: number; failed: string[]; done: boolean };

/**
 * Deletes one capture round at the owner's request (a guest asks, or the round was a mistake).
 * Order matters:
 *  1. The guest link is cancelled first. If that fails, nothing is deleted, so a deleted round can never keep a working link.
 *  2. Photos and videos go to the system Trash (recoverable from there); a file that fails is reported and the rest continue.
 *  3. The round is marked as deleted only when every file is gone, so a half-finished delete can simply be run again.
 */
export async function deleteCaptureRound(deps: {
  session: Pick<CaptureSessionRecord, 'id' | 'status' | 'photoIds' | 'compositionPhotoId' | 'videoIds'>;
  revokeLinks: () => Promise<void>;
  trashPhoto: (photoId: string) => Promise<boolean>;
  trashVideo: (videoId: string) => Promise<boolean>;
  markDeleted: () => void;
}): Promise<RoundDeleteResult> {
  const { session } = deps;
  if (session.status === 'capturing') throw new Error('This round is still being shot. Finish or cancel it first.');
  try { await deps.revokeLinks(); }
  catch (error) { throw new Error(`The guest link could not be cancelled, so nothing was deleted. Check the internet and try again. (${error instanceof Error ? error.message : 'unknown error'})`); }
  const photoIds = [...new Set([...session.photoIds, ...(session.compositionPhotoId ? [session.compositionPhotoId] : [])])];
  const videoIds = [...new Set(session.videoIds ?? [])];
  const failed: string[] = [];
  let photos = 0, videos = 0;
  for (const id of photoIds) {
    try { if (await deps.trashPhoto(id)) photos++; } catch { failed.push(id); }
  }
  for (const id of videoIds) {
    try { if (await deps.trashVideo(id)) videos++; } catch { failed.push(id); }
  }
  if (failed.length === 0) deps.markDeleted();
  return { photos, videos, failed, done: failed.length === 0 };
}
