import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CaptureSessionRecord } from '../../shared/contract';

export type KokoMemoryJobStatus = 'pending' | 'uploading' | 'uploaded' | 'needs-attention';
export type KokoMemoryUploadJob = { id: string; sessionId: string; photoId: string; connectionId: string; bookingId: string; shareId: string; status: KokoMemoryJobStatus; attempts: number; nextAttemptAt: number; lastError: string | null; createdAt: string; updatedAt: string };
type JobIndex = { schemaVersion: 1; jobs: KokoMemoryUploadJob[] };
const EMPTY: JobIndex = { schemaVersion: 1, jobs: [] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JOBS = 20_000;

function validJob(value: unknown): value is KokoMemoryUploadJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return typeof job.id === 'string' && /^[a-f0-9]{64}$/.test(job.id)
    && typeof job.sessionId === 'string' && UUID.test(job.sessionId)
    && typeof job.photoId === 'string' && UUID.test(job.photoId)
    && typeof job.connectionId === 'string' && /^[a-f0-9]{64}$/.test(job.connectionId)
    && typeof job.bookingId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(job.bookingId)
    && typeof job.shareId === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(job.shareId)
    && ['pending', 'uploading', 'uploaded', 'needs-attention'].includes(job.status as string)
    && Number.isSafeInteger(job.attempts) && (job.attempts as number) >= 0
    && Number.isSafeInteger(job.nextAttemptAt) && (job.nextAttemptAt as number) >= 0
    && (job.lastError === null || (typeof job.lastError === 'string' && job.lastError.length <= 500))
    && typeof job.createdAt === 'string' && Number.isFinite(Date.parse(job.createdAt))
    && typeof job.updatedAt === 'string' && Number.isFinite(Date.parse(job.updatedAt));
}

/** Durable KOKOMEMORY upload queue. Each job snapshots its booking and album identity. */
export class KokoMemorySyncStore {
  private readonly filePath: string;
  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'kokomemory-upload-queue.json');
    const index = this.read();
    const recovered = index.jobs.map(job => job.status === 'uploading' ? { ...job, status: 'pending' as const, nextAttemptAt: 0, lastError: 'Upload was interrupted; retrying from the local original.', updatedAt: new Date().toISOString() } : job);
    if (recovered.some((job, indexValue) => job !== index.jobs[indexValue])) this.write({ schemaVersion: 1, jobs: recovered });
  }

  enqueueSession(session: CaptureSessionRecord, photoIds: string[], target: { connectionId: string; bookingId: string; shareId: string }) {
    if (!UUID.test(session.id) || session.status !== 'confirmed') throw new Error('Only confirmed capture sessions can be sent to KOKOMEMORY.');
    if (!Array.isArray(photoIds) || !photoIds.length || photoIds.length > 4 || photoIds.some(id => !UUID.test(id))) throw new Error('This session has no supported JPEG photos to send.');
    if (!/^[a-f0-9]{64}$/.test(target.connectionId) || !/^[A-Za-z0-9_-]{1,128}$/.test(target.bookingId) || !/^[A-Za-z0-9_-]{20,128}$/.test(target.shareId)) throw new Error('Invalid KOKOMEMORY destination.');
    const index = this.read();
    const jobs = index.jobs.slice();
    const now = new Date().toISOString();
    for (const photoId of [...new Set(photoIds)]) {
      const id = createHash('sha256').update(`${target.connectionId}\0${session.id}\0${photoId}`).digest('hex');
      const previousIndex = jobs.findIndex(job => job.id === id);
      const previous = previousIndex >= 0 ? jobs[previousIndex] : null;
      if (previous?.status === 'uploaded' || previous?.status === 'uploading') continue;
      const next: KokoMemoryUploadJob = previous
        ? { ...previous, status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null, updatedAt: now }
        : { id, sessionId: session.id, photoId, ...target, status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: now, updatedAt: now };
      if (previousIndex >= 0) jobs[previousIndex] = next; else jobs.push(next);
    }
    if (jobs.length > MAX_JOBS) throw new Error('KOKOMEMORY upload history is full; clear completed uploads before adding more.');
    this.write({ schemaVersion: 1, jobs });
    return this.statusForSession(session.id, target.connectionId);
  }

  dueJobs(now = Date.now()) { return this.read().jobs.filter(job => job.status === 'pending' && job.nextAttemptAt <= now).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  get(id: string) { return this.read().jobs.find(job => job.id === id) ?? null; }

  markUploading(id: string) { return this.update(id, job => ({ ...job, status: 'uploading', attempts: job.attempts + 1, updatedAt: new Date().toISOString() })); }
  markUploaded(id: string) { return this.update(id, job => ({ ...job, status: 'uploaded', nextAttemptAt: 0, lastError: null, updatedAt: new Date().toISOString() })); }
  markFailed(id: string, error: string, retryable: boolean) {
    return this.update(id, job => {
      const delay = Math.min(60 * 60 * 1000, 15_000 * (2 ** Math.max(0, job.attempts - 1)));
      return { ...job, status: retryable ? 'pending' : 'needs-attention', nextAttemptAt: retryable ? Date.now() + delay : 0, lastError: error.slice(0, 500), updatedAt: new Date().toISOString() };
    });
  }

  statusForSession(sessionId: string, connectionId?: string | null) {
    const jobs = this.read().jobs.filter(job => job.sessionId === sessionId && (!connectionId || job.connectionId === connectionId));
    if (!jobs.length) return { state: 'idle' as const, total: 0, uploadedCount: 0, lastError: null };
    const uploadedCount = jobs.filter(job => job.status === 'uploaded').length;
    const attention = jobs.find(job => job.status === 'needs-attention');
    const active = jobs.some(job => job.status === 'uploading');
    const pending = jobs.some(job => job.status === 'pending');
    return { state: attention ? 'needs-attention' as const : active ? 'uploading' as const : pending ? 'pending' as const : 'uploaded' as const, total: jobs.length, uploadedCount, lastError: attention?.lastError ?? jobs.find(job => job.lastError)?.lastError ?? null };
  }

  private update(id: string, transform: (job: KokoMemoryUploadJob) => KokoMemoryUploadJob) {
    const index = this.read();
    const existing = index.jobs.find(job => job.id === id);
    if (!existing) throw new Error('KOKOMEMORY upload job was not found.');
    const updated = transform(existing);
    this.write({ schemaVersion: 1, jobs: index.jobs.map(job => job.id === id ? updated : job) });
    return updated;
  }

  private read(): JobIndex {
    if (!existsSync(this.filePath)) return EMPTY;
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.filePath, 'utf8')); } catch { throw new Error('KOKOMEMORY upload queue is damaged; existing data was preserved.'); }
    if (!value || typeof value !== 'object') throw new Error('KOKOMEMORY upload queue is invalid; existing data was preserved.');
    const index = value as Record<string, unknown>;
    if (index.schemaVersion !== 1 || !Array.isArray(index.jobs) || index.jobs.length > MAX_JOBS || !index.jobs.every(validJob) || new Set(index.jobs.map(job => (job as KokoMemoryUploadJob).id)).size !== index.jobs.length) throw new Error('KOKOMEMORY upload queue is invalid; existing data was preserved.');
    return index as unknown as JobIndex;
  }

  private write(index: JobIndex) {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, JSON.stringify(index), 'utf8'); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, this.filePath);
  }
}
