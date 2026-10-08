import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type PrintJobStatus = 'pending' | 'printing' | 'submitted' | 'failed' | 'cancelled';
export type PrintOptionsSnapshot = { printerName: string; paper: 'A4' | 'A5' | 'Letter' | '4x6'; landscape: boolean; copies: number };
export type PrintJob = { id: string; fileName: string; status: PrintJobStatus; options: PrintOptionsSnapshot; error: string | null; createdAt: string; updatedAt: string };
type Index = { schemaVersion: 1; jobs: PrintJob[] };
const EMPTY: Index = { schemaVersion: 1, jobs: [] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

function validJob(value: unknown): value is PrintJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  const options = job.options as Record<string, unknown> | null;
  return typeof job.id === 'string' && UUID.test(job.id) && job.fileName === `${job.id}.png`
    && ['pending', 'printing', 'submitted', 'failed', 'cancelled'].includes(job.status as string)
    && Boolean(options && typeof options.printerName === 'string' && options.printerName.length <= 256
      && ['A4', 'A5', 'Letter', '4x6'].includes(options.paper as string) && typeof options.landscape === 'boolean'
      && Number.isSafeInteger(options.copies) && (options.copies as number) >= 1 && (options.copies as number) <= 10)
    && (job.error === null || (typeof job.error === 'string' && job.error.length <= 500))
    && typeof job.createdAt === 'string' && Number.isFinite(Date.parse(job.createdAt))
    && typeof job.updatedAt === 'string' && Number.isFinite(Date.parse(job.updatedAt));
}

/** Durable spool metadata and PNG payloads for application-managed print jobs. */
export class PrintQueueStore {
  private readonly directory: string;
  private readonly indexPath: string;
  constructor(userDataPath: string) {
    this.directory = path.join(userDataPath, 'print-spool');
    this.indexPath = path.join(this.directory, 'jobs.json');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const index = this.read();
    const recovered = index.jobs.map(job => job.status === 'printing' ? { ...job, status: 'pending' as const, error: 'Printing was interrupted; review the print dialog or retry.', updatedAt: new Date().toISOString() } : job);
    if (recovered.some((job, indexValue) => job !== index.jobs[indexValue])) this.write({ schemaVersion: 1, jobs: recovered });
  }
  enqueue(png: Uint8Array, options: PrintOptionsSnapshot) {
    if (!(png instanceof Uint8Array) || png.byteLength < 8 || png.byteLength > MAX_IMAGE_BYTES || !PNG_SIGNATURE.equals(Buffer.from(png.subarray(0, 8)))) throw new Error('Invalid print image; choose a smaller PNG composition.');
    if (!options || typeof options.printerName !== 'string' || options.printerName.length > 256 || !['A4', 'A5', 'Letter', '4x6'].includes(options.paper) || typeof options.landscape !== 'boolean' || !Number.isSafeInteger(options.copies) || options.copies < 1 || options.copies > 10) throw new Error('Invalid print settings.');
    const index = this.read();
    if (index.jobs.length >= 1000) throw new Error('Print history is full; remove old print records before adding another job.');
    const id = randomUUID();
    const now = new Date().toISOString();
    const job: PrintJob = { id, fileName: `${id}.png`, status: 'pending', options: { ...options }, error: null, createdAt: now, updatedAt: now };
    this.atomicWrite(path.join(this.directory, job.fileName), Buffer.from(png));
    this.write({ schemaVersion: 1, jobs: [...index.jobs, job] });
    return job;
  }
  list() { return this.read().jobs.slice().reverse(); }
  get(id: string) { return this.read().jobs.find(job => job.id === id) ?? null; }
  imagePath(job: PrintJob) {
    const filePath = path.join(this.directory, job.fileName);
    const linkStats = lstatSync(filePath);
    const stats = statSync(filePath);
    const actualPath = realpathSync(filePath);
    if (!linkStats.isFile() || linkStats.isSymbolicLink() || path.dirname(actualPath) !== realpathSync(this.directory) || !stats.isFile() || stats.size < 8 || stats.size > MAX_IMAGE_BYTES) throw new Error('Print image is missing or invalid.');
    const handle = readFileSync(filePath);
    if (!PNG_SIGNATURE.equals(handle.subarray(0, 8))) throw new Error('Print image is not a PNG.');
    return filePath;
  }
  update(id: string, status: PrintJobStatus, error: string | null = null) {
    const index = this.read();
    const current = index.jobs.find(job => job.id === id);
    if (!current) throw new Error('Print job was not found.');
    const updated: PrintJob = { ...current, status, error: error?.slice(0, 500) ?? null, updatedAt: new Date().toISOString() };
    this.write({ schemaVersion: 1, jobs: index.jobs.map(job => job.id === id ? updated : job) });
    return updated;
  }
  private read(): Index {
    if (!existsSync(this.indexPath)) return EMPTY;
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.indexPath, 'utf8')); } catch { throw new Error('Print queue is damaged; existing data was preserved.'); }
    if (!value || typeof value !== 'object') throw new Error('Print queue is invalid; existing data was preserved.');
    const index = value as Record<string, unknown>;
    if (index.schemaVersion !== 1 || !Array.isArray(index.jobs) || index.jobs.length > 1000 || !index.jobs.every(validJob) || new Set(index.jobs.map(job => (job as PrintJob).id)).size !== index.jobs.length) throw new Error('Print queue is invalid; existing data was preserved.');
    return index as unknown as Index;
  }
  private atomicWrite(filePath: string, data: string | Buffer) {
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, data); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, filePath);
  }
  private write(index: Index) { this.atomicWrite(this.indexPath, JSON.stringify(index)); }
}
