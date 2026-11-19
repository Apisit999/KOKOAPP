import type { RetryBackoff } from './retry-backoff.ts';

export type RecoverableSession = { id: string; photoIds: string[]; compositionPhotoId?: string };

/**
 * One pass over the sessions that still wait for the cloud. Failures never throw: they are scheduled for a later pass.
 * `isPermanent` stops the pass (the server will refuse every other session for the same reason, e.g. quota);
 * `isNoCloud` means the plan has no cloud at all, so that session is not asked again for an hour.
 */
export async function recoverStudioCloudSessions(deps: {
  sessions: RecoverableSession[];
  pendingIds: (sessions: RecoverableSession[]) => string[];
  upload: (sessionId: string) => Promise<void>;
  backoff: RetryBackoff;
  now: () => number;
  isPermanent: (error: unknown) => boolean;
  isNoCloud: (error: unknown) => boolean;
  onResult?: (sessionId: string, error: unknown | null) => void;
}): Promise<{ recovered: string[]; failed: string[]; skipped: string[] }> {
  const recovered: string[] = [];
  const failed: string[] = [];
  const pending = deps.pendingIds(deps.sessions);
  const waiting = pending.filter(id => deps.backoff.canTry(id, deps.now()));
  const skipped = pending.filter(id => !waiting.includes(id));
  for (const id of waiting) {
    try { await deps.upload(id); deps.backoff.succeeded(id); recovered.push(id); deps.onResult?.(id, null); }
    catch (error) {
      deps.backoff.failed(id, deps.now(), deps.isNoCloud(error) ? 3_600_000 : undefined);
      failed.push(id); deps.onResult?.(id, error);
      if (deps.isPermanent(error)) break;
    }
  }
  return { recovered, failed, skipped };
}
