import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PIN_PATTERN = /^\d{4,12}$/;
const HASH_BYTES = 32;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

type PinRecord = { schemaVersion: 1; salt: string; hash: string; failedAttempts: number; lockedUntil: number };

function validRecord(value: unknown): value is PinRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.salt !== 'string' || typeof item.hash !== 'string') return false;
  if (typeof item.failedAttempts !== 'number' || !Number.isInteger(item.failedAttempts) || item.failedAttempts < 0 || item.failedAttempts >= MAX_FAILURES) return false;
  if (typeof item.lockedUntil !== 'number' || !Number.isSafeInteger(item.lockedUntil) || item.lockedUntil < 0) return false;
  try { return Buffer.from(item.salt, 'base64').length === 16 && Buffer.from(item.hash, 'base64').length === HASH_BYTES; }
  catch { return false; }
}

export class GuestExitPinStore {
  private readonly file: string;

  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, 'guest-exit-pin.json');
  }

  isConfigured() { return this.read() !== null; }

  verify(pin: unknown) {
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return false;
    const record = this.read();
    if (!record || record.lockedUntil > Date.now()) return false;
    if (this.matches(record, pin)) {
      this.write({ ...record, failedAttempts: 0, lockedUntil: 0 });
      return true;
    }
    const failedAttempts = record.failedAttempts + 1;
    this.write({ ...record, failedAttempts: failedAttempts >= MAX_FAILURES ? 0 : failedAttempts, lockedUntil: failedAttempts >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0 });
    return false;
  }

  set(currentPin: unknown, nextPin: unknown) {
    const current = this.read();
    if (current) {
      if (typeof currentPin !== 'string' || current.lockedUntil > Date.now() || !this.matches(current, currentPin)) {
        const failedAttempts = current.failedAttempts + 1;
        this.write({ ...current, failedAttempts: failedAttempts >= MAX_FAILURES ? 0 : failedAttempts, lockedUntil: failedAttempts >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : current.lockedUntil });
        return false;
      }
    } else if (currentPin !== null) return false;

    if (nextPin === null) {
      if (current) unlinkSync(this.file);
      return true;
    }
    if (typeof nextPin !== 'string' || !PIN_PATTERN.test(nextPin)) throw new Error('PIN must contain 4 to 12 digits.');
    const salt = randomBytes(16);
    const hash = this.derive(nextPin, salt);
    this.write({ schemaVersion: 1, salt: salt.toString('base64'), hash: hash.toString('base64'), failedAttempts: 0, lockedUntil: 0 });
    return true;
  }

  private matches(record: PinRecord, pin: string) {
    const salt = Buffer.from(record.salt, 'base64');
    const expected = Buffer.from(record.hash, 'base64');
    const actual = this.derive(pin, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private derive(pin: string, salt: Buffer) {
    return scryptSync(pin, salt, HASH_BYTES, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  private read(): PinRecord | null {
    if (!existsSync(this.file)) return null;
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch { throw new Error('Guest exit PIN data is damaged. Contact support to recover kiosk access.'); }
    if (!validRecord(value)) throw new Error('Guest exit PIN data is invalid. Contact support to recover kiosk access.');
    return value;
  }

  private write(value: PinRecord) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
