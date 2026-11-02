import type { UpdateRelease, UpdateStatus } from '../../shared/update-contract';

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Options = {
  apiBaseUrl: string;
  currentVersion: string;
  channel?: 'stable' | 'beta';
  getDeviceId: () => string;
  fetcher?: Fetcher;
  now?: () => number;
  timeoutMs?: number;
};
const SEMVER = /^\d+\.\d+\.\d+$/;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Asks the website whether a newer installer exists. It only reports; it never downloads or runs anything.
 * Every field of the server response is validated because the renderer displays it.
 */
export class UpdateChecker {
  private readonly options: Options;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private downloadUrl: string | null = null;
  private last: UpdateStatus;

  constructor(options: Options) {
    this.options = options;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
    this.last = this.unknown();
  }

  private unknown(): UpdateStatus {
    return { state: 'unknown', currentVersion: this.options.currentVersion, checkedAt: null, mandatory: false, latest: null };
  }

  private origin(): URL | null {
    try {
      const url = new URL(this.options.apiBaseUrl);
      return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url : null;
    } catch { return null; }
  }

  getLast() { return this.last; }
  /** Main-only: the URL of the last verified update, for the system browser. */
  getDownloadUrl() { return this.last.state === 'available' ? this.downloadUrl : null; }

  async check(): Promise<UpdateStatus> {
    const base = this.origin();
    if (!base || !SEMVER.test(this.options.currentVersion)) return this.last = this.unknown();
    const query = new URLSearchParams({ version: this.options.currentVersion, channel: this.options.channel ?? 'stable', deviceId: this.options.getDeviceId() });
    try {
      const response = await this.fetcher(`${base.origin}/v1/desktop/updates?${query}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000) });
      if (!response.ok) throw new Error(`update_${response.status}`);
      return this.last = this.parse(await response.json(), base);
    } catch {
      // Offline or server trouble must never disturb a running booth; keep the last good answer.
      return this.last;
    }
  }

  private parse(body: unknown, base: URL): UpdateStatus {
    if (!isObject(body) || typeof body.updateAvailable !== 'boolean') throw new Error('invalid_update_response');
    const checkedAt = new Date(this.now()).toISOString();
    if (!body.updateAvailable) { this.downloadUrl = null; return { state: 'current', currentVersion: this.options.currentVersion, checkedAt, mandatory: false, latest: null }; }
    const latest = body.latest;
    if (!isObject(latest) || typeof latest.version !== 'string' || !SEMVER.test(latest.version) || typeof latest.downloadUrl !== 'string') throw new Error('invalid_update_response');
    const url = new URL(latest.downloadUrl);
    if (url.origin !== base.origin || url.pathname !== '/api/studio/download') throw new Error('untrusted_update_url');
    const notes = Array.isArray(latest.notes) ? latest.notes.filter((note): note is string => typeof note === 'string').slice(0, 20).map(note => note.slice(0, 300)) : [];
    const release: UpdateRelease = {
      version: latest.version, notes,
      publishedAt: typeof latest.publishedAt === 'string' ? latest.publishedAt : null,
      sha256: typeof latest.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(latest.sha256) ? latest.sha256 : '',
      fileSize: typeof latest.fileSize === 'number' && Number.isFinite(latest.fileSize) ? latest.fileSize : 0,
    };
    this.downloadUrl = url.toString();
    return { state: 'available', currentVersion: this.options.currentVersion, checkedAt, mandatory: body.mandatory === true, latest: release };
  }
}
