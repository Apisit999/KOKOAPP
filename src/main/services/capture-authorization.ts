import { randomUUID } from 'node:crypto';

type PendingCapture = { expiresAt: number; inUse: boolean; remaining: number; eventId: string | null; sessionId: string };

/** Main-process, in-memory grants for one capture session; never persisted or exposed to a page. */
export class CaptureAuthorizationRegistry {
  private readonly pending = new Map<string, PendingCapture>();

  begin(photoCount: unknown, eventIdOrNow: string | null | number = null, timestamp = Date.now(), sessionId: string = randomUUID()) {
    const now = typeof eventIdOrNow === 'number' ? eventIdOrNow : timestamp;
    const eventId = typeof eventIdOrNow === 'string' ? eventIdOrNow : null;
    if (!Number.isSafeInteger(photoCount) || ![1, 2, 4].includes(photoCount as number)) {
      throw new Error('Invalid session photo count');
    }
    if (eventId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) throw new Error('Invalid event ID');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid capture session ID');
    for (const [id, grant] of this.pending) if (!grant.inUse && grant.expiresAt <= now) this.pending.delete(id);
    if (this.pending.size >= 32) throw new Error('Too many pending captures. Complete or retry an existing capture first.');
    const id = randomUUID();
    this.pending.set(id, { expiresAt: now + 5 * 60_000, inUse: false, remaining: photoCount as number, eventId, sessionId });
    return id;
  }

  getSessionId(id: string) { return this.pending.get(id)?.sessionId ?? null; }

  claim(id: unknown, now = Date.now()) {
    if (typeof id !== 'string') throw new Error('Capture authorization required');
    const grant = this.pending.get(id);
    if (!grant || grant.expiresAt <= now || grant.inUse || grant.remaining < 1) throw new Error('Capture authorization is invalid or expired');
    grant.inUse = true;
    return { eventId: grant.eventId, sessionId: grant.sessionId };
  }

  complete(id: string) {
    const grant = this.pending.get(id);
    if (!grant || !grant.inUse) throw new Error('Capture authorization is no longer active');
    grant.remaining--;
    if (grant.remaining === 0) this.pending.delete(id);
  }

  release(id: string) {
    const grant = this.pending.get(id);
    if (grant) grant.inUse = false;
  }

  cancel(id: unknown) {
    if (typeof id !== 'string') throw new Error('Invalid capture authorization');
    const grant = this.pending.get(id);
    if (!grant) return true;
    if (grant.inUse) return false;
    this.pending.delete(id);
    return true;
  }
}
