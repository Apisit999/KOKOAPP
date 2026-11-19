/**
 * How soon a failing item may be tried again: 2, 4, 8 ... minutes up to a cap, so a session that keeps failing
 * does not hit the server every minute, while one that failed once (a short network drop) is retried quickly.
 */
export class RetryBackoff {
  private readonly items = new Map<string, { fails: number; until: number }>();
  private readonly baseMs: number;
  private readonly capMs: number;
  constructor(baseMs = 60_000, capMs = 15 * 60_000) { this.baseMs = baseMs; this.capMs = capMs; }

  canTry(id: string, now: number) { return (this.items.get(id)?.until ?? 0) <= now; }

  /** `waitMs` overrides the schedule for errors that retrying will not fix soon (a plan without cloud). */
  failed(id: string, now: number, waitMs?: number) {
    const fails = (this.items.get(id)?.fails ?? 0) + 1;
    const wait = waitMs ?? Math.min(this.capMs, this.baseMs * 2 ** fails);
    this.items.set(id, { fails, until: now + wait });
    return wait;
  }

  succeeded(id: string) { this.items.delete(id); }
}
