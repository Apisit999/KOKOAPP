import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, session, shell, safeStorage } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, renameSync, unlinkSync, lstatSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Settings, AppStatus, GuestDisplayPayload } from '../shared/contract';
import { PhotoStore, validateStorageRoot } from './services/photo-store';
import { VideoStore } from './services/video-store';
import { EventStore } from './services/event-store';
import { jpegDimensions } from './services/jpeg-image';
import { LicenseRuntime } from './services/license-runtime';
import { CaptureAuthorizationRegistry } from './services/capture-authorization';
import { CaptureSessionStore, validateCaptureTemplate } from './services/capture-session-store';
import { LICENSE_API_BASE_URL, LICENSE_PRODUCT_ID, LICENSE_TRUSTED_KEYS, PHOTO_CLOUD_PUBLIC_BASE_URL } from './license-config';
import { PhotoCloudClient } from './services/photo-cloud-client';
import { retryPendingPhotoCloudUploads, shouldAutomaticallyUploadSession } from './services/photo-cloud-recovery';
import { PhotoFolderWatcher } from './services/photo-folder-watcher';
import { KokoMemoryConnectionStore } from './services/koko-memory-connection-store';
import { KokoMemorySyncStore } from './services/koko-memory-sync-store';
import { KokoMemoryApiClient, KokoMemoryApiError } from './services/koko-memory-client';
import { PrintQueueStore, type PrintJob, type PrintOptionsSnapshot } from './services/print-queue';

function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const command = process.argv[1];
  const executableName = path.basename(process.execPath);
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const run = (args: string[]) => spawn(updateExe, args, { detached: true }).on('close', () => app.quit());
  if (command === '--squirrel-install' || command === '--squirrel-updated') {
    run([`--createShortcut=${executableName}`]);
    return true;
  }
  if (command === '--squirrel-uninstall') {
    run([`--removeShortcut=${executableName}`]);
    return true;
  }
  if (command === '--squirrel-obsolete') {
    app.quit();
    return true;
  }
  return false;
}

if (handleSquirrelEvent()) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.KOKOPhotobooth.KOKOPhotobooth');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const defaults: Settings = { language: 'th', highContrast: false, fullscreen: false };
let mainWindow: BrowserWindow | null = null;
let guestDisplayWindow: BrowserWindow | null = null;
let lastError: string | null = null;
if (hasSingleInstanceLock) {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
}
const dataDir = () => app.getPath('userData');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const photoStorageConfigFile = () => path.join(dataDir(), 'photo-storage.json');
const cameraFolderConfigFile = () => path.join(dataDir(), 'camera-folder.json');
const photoStores = new Map<string, PhotoStore>();
const videoStores = new Map<string, VideoStore>();
const captureAuthorizations = new CaptureAuthorizationRegistry();
let cameraFolderWatcher: PhotoFolderWatcher | null = null;
let cameraFolderConfig: { folderPath: string | null; enabled: boolean } = { folderPath: null, enabled: false };
let cameraFolderRestoreError: string | null = null;
let eventStore: EventStore | null = null;
function events() { if (!eventStore) eventStore = new EventStore(dataDir()); return eventStore; }
let captureSessionStore: CaptureSessionStore | null = null;
function captureSessions() { if (!captureSessionStore) captureSessionStore = new CaptureSessionStore(dataDir()); return captureSessionStore; }
let licenseRuntime: LicenseRuntime | null = null;
function licenses() {
  if (!licenseRuntime) licenseRuntime = new LicenseRuntime({
    userDataPath: dataDir(), apiBaseUrl: LICENSE_API_BASE_URL, productId: LICENSE_PRODUCT_ID, trustedKeys: LICENSE_TRUSTED_KEYS
  });
  return licenseRuntime;
}
let photoCloudClient: PhotoCloudClient | null = null;
let kokoMemoryConnections: KokoMemoryConnectionStore | null = null;
let kokoMemoryQueue: KokoMemorySyncStore | null = null;
let kokoMemoryClient: KokoMemoryApiClient | null = null;
let kokoMemoryDrainRunning = false;
let printQueueStore: PrintQueueStore | null = null;
const activePrintWindows = new Map<string, BrowserWindow>();
let printQueueRunning = false;
function memoryConnections() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
  if (!kokoMemoryConnections) kokoMemoryConnections = new KokoMemoryConnectionStore(dataDir(), {
    encrypt: value => safeStorage.encryptString(value).toString('base64'),
    decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64'))
  });
  return kokoMemoryConnections;
}
function memoryQueue() { if (!kokoMemoryQueue) kokoMemoryQueue = new KokoMemorySyncStore(dataDir()); return kokoMemoryQueue; }
function printQueue() { if (!printQueueStore) printQueueStore = new PrintQueueStore(dataDir()); return printQueueStore; }
function submitPrintJob(job: PrintJob) {
  if (job.status !== 'pending' || printQueueRunning || activePrintWindows.has(job.id)) return;
  printQueueRunning = true;
  let hidden: BrowserWindow | null = null;
  try {
    const queue = printQueue();
    const pngPath = queue.imagePath(job);
    const directory = path.dirname(pngPath);
    const htmlPath = path.join(directory, `${job.id}.html`);
    const pageSize = job.options.paper === '4x6' ? (job.options.landscape ? '6in 4in' : '4in 6in') : job.options.paper;
    const markup = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:"><style>@page{size:${pageSize};margin:0}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:flex;align-items:center;justify-content:center}img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}</style></head><body><img src="${job.fileName}" alt="KOKO Studio print"></body></html>`;
    writeFileSync(htmlPath, markup, { encoding: 'utf8', mode: 0o600 });
    const printWindow = new BrowserWindow({ parent: mainWindow ?? undefined, show: false, width: 800, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    hidden = printWindow;
    activePrintWindows.set(job.id, printWindow);
    const current = queue.update(job.id, 'printing');
    void printWindow.loadFile(htmlPath).then(async () => {
      if (printWindow.isDestroyed()) return;
      const ready = await printWindow.webContents.executeJavaScript('document.images[0].decode().then(() => true).catch(() => false)');
      if (!ready) throw new Error('Print preview image could not be loaded.');
      const size = current.options.paper === '4x6' ? (current.options.landscape ? { width: 152400, height: 101600 } : { width: 101600, height: 152400 }) : current.options.paper;
      printWindow.webContents.print({
        silent: Boolean(current.options.printerName), printBackground: true, deviceName: current.options.printerName || undefined,
        landscape: current.options.landscape, copies: current.options.copies, pageSize: size, margins: { marginType: 'none' }
      }, (success, failureReason) => {
        try { queue.update(current.id, success ? 'submitted' : 'failed', success ? null : `Print request failed or was cancelled${failureReason ? `: ${failureReason}` : ''}.`); }
        catch (error) { log('print-job-status-failed', error, { jobId: current.id }); }
        if (hidden && !hidden.isDestroyed()) hidden.close();
        printQueueRunning = false;
        drainPrintQueue();
      });
    }).catch(error => {
      try { queue.update(job.id, 'failed', error instanceof Error ? error.message : 'Could not start print job.'); } catch { /* Preserve the original print failure. */ }
      log('print-job-failed', error, { jobId: job.id });
      if (hidden && !hidden.isDestroyed()) hidden.close();
      printQueueRunning = false;
      drainPrintQueue();
    }).finally(() => { activePrintWindows.delete(job.id); });
    hidden.on('closed', () => { activePrintWindows.delete(job.id); });
  } catch (error) {
    try { printQueue().update(job.id, 'failed', error instanceof Error ? error.message : 'Could not start print job.'); } catch { /* Preserve queue failure. */ }
    log('print-job-failed', error, { jobId: job.id });
    if (hidden && !hidden.isDestroyed()) hidden.close();
    printQueueRunning = false;
    setTimeout(drainPrintQueue, 100);
  }
}
function drainPrintQueue() {
  if (printQueueRunning) return;
  try {
    const next = printQueue().list().reverse().find(job => job.status === 'pending');
    if (next) submitPrintJob(next);
  } catch (error) { log('print-queue-drain-failed', error); }
}
async function drainKokoMemoryQueue(sessionId?: string) {
  if (kokoMemoryDrainRunning || !safeStorage.isEncryptionAvailable()) return;
  const root = configuredPhotoRoot();
  if (!root) return;
  kokoMemoryDrainRunning = true;
  try {
    const queue = memoryQueue();
    if (!kokoMemoryClient) kokoMemoryClient = new KokoMemoryApiClient();
    for (const job of queue.dueJobs()) {
      if (sessionId && job.sessionId !== sessionId) continue;
      const sessionRecord = captureSessions().get(job.sessionId);
      if (!sessionRecord || sessionRecord.status !== 'confirmed' || !sessionRecord.photoIds.includes(job.photoId) && sessionRecord.compositionPhotoId !== job.photoId) {
        queue.markFailed(job.id, 'Capture session is no longer confirmed; upload was stopped.', false);
        continue;
      }
      const connection = memoryConnections().getById(job.connectionId);
      if (!connection || connection.bookingId !== job.bookingId || connection.shareId !== job.shareId) {
        queue.markFailed(job.id, 'The original KOKOMEMORY destination is unavailable; import its uploader configuration again.', false);
        continue;
      }
      queue.markUploading(job.id);
      try {
        const stored = getPhotoStore(root).readPhoto(job.photoId);
        await kokoMemoryClient.uploadPhoto(connection, { sessionId: job.sessionId, photoId: job.photoId, fileName: stored.photo.fileName, mimeType: 'image/jpeg', bytes: stored.bytes });
        queue.markUploaded(job.id);
        log('kokomemory-photo-uploaded', undefined, { sessionId: job.sessionId, bookingId: job.bookingId, photoId: job.photoId });
      } catch (error) {
        const retryable = error instanceof KokoMemoryApiError ? error.retryable : false;
        const safeMessage = error instanceof KokoMemoryApiError ? error.message : 'Could not read or upload the local photo.';
        queue.markFailed(job.id, safeMessage, retryable);
        log('kokomemory-photo-upload-failed', error, { sessionId: job.sessionId, bookingId: job.bookingId, photoId: job.photoId });
      }
    }
  } finally { kokoMemoryDrainRunning = false; }
}
function photoCloud() {
  if (!photoCloudClient) photoCloudClient = new PhotoCloudClient(dataDir(), licenses(), PHOTO_CLOUD_PUBLIC_BASE_URL);
  return photoCloudClient;
}
async function uploadCaptureSessionToCloud(sessionId: string) {
  const session = captureSessions().get(sessionId);
  if (!session || !shouldAutomaticallyUploadSession(session)) return;
  const root = configuredPhotoRoot();
  if (!root) return;
  let shareUrl = photoCloud().getShareUrl(session.id);
  if (!shareUrl) {
    const eventName = session.eventId ? events().get(session.eventId)?.name : null;
    shareUrl = await photoCloud().createForSession(session.id, eventName || `Photo session ${new Date(session.createdAt).toLocaleString('en-GB')}`);
  }
  const photoIds = [...session.photoIds, ...(session.compositionPhotoId ? [session.compositionPhotoId] : [])];
  for (const photoId of photoIds) {
    if (!shouldAutomaticallyUploadSession(captureSessions().get(sessionId))) return;
    const photo = getPhotoStore(root).readPhoto(photoId);
    await photoCloud().uploadForSession(session.id, photoId, photo.bytes);
  }
  for (const videoId of session.videoIds ?? []) {
    if (!shouldAutomaticallyUploadSession(captureSessions().get(sessionId))) return;
    const video = getVideoStore(root).read(videoId);
    await photoCloud().uploadVideoForSession(session.id, videoId, video.bytes);
  }
}
function getPhotoStore(root: string) {
  const key = path.resolve(root);
  let store = photoStores.get(key);
  if (!store) { store = new PhotoStore(key); photoStores.set(key, store); }
  return store;
}
function getVideoStore(root: string) {
  const key = path.resolve(root);
  let store = videoStores.get(key);
  if (!store) { store = new VideoStore(key); videoStores.set(key, store); }
  return store;
}
function configuredPhotoRoot(): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(photoStorageConfigFile(), 'utf8'));
    if (!value || typeof value !== 'object') return null;
    const config = value as Record<string, unknown>;
    if (config.version !== 1 || typeof config.root !== 'string' || !path.isAbsolute(config.root)) return null;
    return path.resolve(config.root);
  } catch { return null; }
}
function recoverPendingPhotoCloudUploads() {
  const root = configuredPhotoRoot();
  if (!root) return;
  try {
    const sessions = captureSessions().listForCloudRecovery();
    if (!sessions.length) return;
    void retryPendingPhotoCloudUploads(
      sessions,
      photoCloud(),
      photoId => getPhotoStore(root).readPhoto(photoId).bytes,
      item => {
        const eventName = item.eventId ? events().get(item.eventId)?.name : null;
        return eventName || `Photo session ${new Date(item.createdAt).toLocaleString('en-GB')}`;
      },
      (sessionId, mediaId, error) => log('photo-cloud-recovery-failed', error, { sessionId, ...(mediaId ? { mediaId } : {}) }),
      videoId => getVideoStore(root).read(videoId).bytes,
      session => shouldAutomaticallyUploadSession(captureSessions().get(session.id))
    ).then(result => {
      if (result.uploadedCount || result.uploadedVideoCount) log('photo-cloud-recovery-succeeded', undefined, result);
    }).catch(error => log('photo-cloud-recovery-failed', error));
  } catch (error) { log('photo-cloud-recovery-failed', error); }
}
function photoStorageStatus() {
  const root = configuredPhotoRoot();
  return getPhotoStore(root ?? dataDir()).getStatus(root !== null);
}
function readCameraFolderConfig() {
  try {
    const value: unknown = JSON.parse(readFileSync(cameraFolderConfigFile(), 'utf8'));
    if (!value || typeof value !== 'object') return { folderPath: null, enabled: false };
    const config = value as Record<string, unknown>;
    if (config.version !== 1 || (config.folderPath !== null && (typeof config.folderPath !== 'string' || !path.isAbsolute(config.folderPath))) || typeof config.enabled !== 'boolean') return { folderPath: null, enabled: false };
    return { folderPath: config.folderPath as string | null, enabled: config.enabled };
  } catch { return { folderPath: null, enabled: false }; }
}
function writeCameraFolderConfig(folderPath: string | null, enabled: boolean) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${cameraFolderConfigFile()}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, folderPath, enabled }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, cameraFolderConfigFile());
  cameraFolderConfig = { folderPath, enabled };
}
function cameraFolderStatus() {
  cameraFolderConfig = readCameraFolderConfig();
  return cameraFolderWatcher?.status() ?? { enabled: false, folderPath: cameraFolderConfig.folderPath, importedCount: 0, lastError: cameraFolderRestoreError };
}
function pathsOverlap(left: string, right: string) {
  const a = path.resolve(left); const b = path.resolve(right);
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const relative = (base: string, target: string) => normalize(path.relative(base, target));
  const within = (base: string, target: string) => { const value = relative(base, target); return value === '' || (value !== '..' && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value)); };
  return within(a, b) || within(b, a);
}
function startCameraFolderWatcher(folderPath: string) {
  const storageRoot = configuredPhotoRoot();
  if (!storageRoot) throw new Error('Choose the local photo storage folder first.');
  const source = realpathSync(folderPath);
  const storage = realpathSync(storageRoot);
  if (pathsOverlap(source, storage)) throw new Error('Camera folder and photo storage must be separate folders.');
  const previousWatcher = cameraFolderWatcher;
  const nextWatcher = new PhotoFolderWatcher(dataDir(), async (bytes, sourceKey) => {
    if (bytes.byteLength < 4 || bytes.byteLength > 100 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('Only complete JPEG photos up to 100 MB can be imported.');
    const dimensions = jpegDimensions(Buffer.from(bytes));
    const decoded = nativeImage.createFromBuffer(Buffer.from(bytes));
    const size = decoded.getSize();
    if (decoded.isEmpty() || size.width !== dimensions.width || size.height !== dimensions.height) throw new Error('Camera file is not a valid JPEG image.');
    const activeEvent = events().active();
    return getPhotoStore(storageRoot).saveJpegFromSource(bytes, dimensions.width, dimensions.height, activeEvent?.id ?? null, sourceKey);
  }, (fileName, photo) => {
    mainWindow?.webContents.send('koko:camera-folder-photo-import', { fileName, photo });
    log('camera-folder-photo-imported', undefined, { byteLength: photo.byteLength, width: photo.width, height: photo.height });
  });
  try {
    const status = nextWatcher.start(source);
    writeCameraFolderConfig(source, true);
    previousWatcher?.stop();
    cameraFolderWatcher = nextWatcher;
    cameraFolderRestoreError = null;
    return status;
  } catch (error) { nextWatcher.stop(); throw error; }
}
function log(event: string, error?: unknown, details: Record<string, string | number | boolean> = {}) {
  try {
    mkdirSync(dataDir(), { recursive: true });
    const category = error instanceof Error ? error.name : undefined;
    const errorMessage = error instanceof Error ? error.message.slice(0, 500) : undefined;
    appendFileSync(path.join(dataDir(), 'app.log'), JSON.stringify({ at: new Date().toISOString(), event, category, errorMessage, ...details }) + '\n');
  } catch { /* Diagnostics must never prevent app use. */ }
}
function readSettings(): Settings {
  try {
    const value: unknown = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    if (validSettings(value)) return value;
  } catch { /* Missing or invalid file uses safe defaults. */ }
  return defaults;
}
function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.language === 'th' || v.language === 'en') && typeof v.highContrast === 'boolean' && typeof v.fullscreen === 'boolean' && Object.keys(v).length === 3;
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted frame');
  const url = event.senderFrame.url;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    if (new URL(url).origin !== new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin) throw new Error('Untrusted origin');
  } else {
    const expectedPath = path.resolve(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    let actualPath: string;
    try { actualPath = path.resolve(fileURLToPath(url)); } catch { throw new Error('Untrusted origin'); }
    if (actualPath !== expectedPath) throw new Error('Untrusted origin');
  }
}
function trustedMediaRequest(webContents: Electron.WebContents | null, requestingUrl: string, isMainFrame: boolean) {
  if (!mainWindow || webContents !== mainWindow.webContents || !isMainFrame) return false;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try { return new URL(requestingUrl).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin; } catch { return false; }
  }
  try {
    const expectedPath = path.resolve(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    return path.resolve(fileURLToPath(requestingUrl)) === expectedPath;
  } catch { return false; }
}
function status(): AppStatus { return { version: app.getVersion(), settings: readSettings(), lastError }; }
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#080808', title: 'KOKO Studio', show: false,
    icon: path.join(__dirname, '../../assets/koko-studio.png'),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#080808', symbolColor: '#c9aa68', height: 40 } } : {}),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setFullScreen(readSettings().fullscreen);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    lastError = `Renderer failed to load (${errorCode})`;
    log('renderer-load-failed', undefined, { errorCode, errorDescription: errorDescription.slice(0, 240), isMainFrame });
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log('preload-error', error, { preloadFile: path.basename(preloadPath) });
  });
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) log('renderer-console', undefined, { level, message: message.slice(0, 240) });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    lastError = 'Renderer stopped: ' + details.reason;
    log('renderer-gone', undefined, { reason: details.reason, exitCode: details.exitCode });
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  const load = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    lastError = null;
    log('window-shown');
  });
  mainWindow.webContents.on('did-finish-load', () => {
    lastError = null;
    log('renderer-load-succeeded');
  });
  void load.catch(error => {
    lastError = 'Renderer failed to load';
    log('renderer-load-rejected', error);
  });
}
function listGuestDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  const currentId = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()).id : primaryId;
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id, label: display.id === primaryId ? `Display ${index + 1} (Primary)` : `Display ${index + 1}`,
    width: display.bounds.width, height: display.bounds.height, primary: display.id === primaryId, current: display.id === currentId
  }));
}
function createGuestDisplayWindow(displayId: number) {
  const display = screen.getAllDisplays().find(item => item.id === displayId);
  if (!display) throw new Error('That display is no longer connected');
  if (guestDisplayWindow && !guestDisplayWindow.isDestroyed()) {
    if (screen.getDisplayMatching(guestDisplayWindow.getBounds()).id !== display.id) {
      guestDisplayWindow.setFullScreen(false);
      guestDisplayWindow.setBounds(display.bounds);
      guestDisplayWindow.setFullScreen(true);
    }
    guestDisplayWindow.focus();
    return;
  }
  guestDisplayWindow = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
    backgroundColor: '#080808', title: 'KOKO Studio · Guest Display', show: false,
    icon: path.join(__dirname, '../../assets/koko-studio.png'),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#080808', symbolColor: '#c9aa68', height: 40 } } : {}),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false }
  });
  const window = guestDisplayWindow;
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });
  window.on('closed', () => { if (guestDisplayWindow === window) guestDisplayWindow = null; });
  window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.show(); window.setFullScreen(true); } });
  const load = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?guestDisplay=1`)
    : window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query: { guestDisplay: '1' } });
  void load.catch(error => { log('guest-display-load-failed', error); window.close(); });
}
function validGuestDisplayPayload(value: unknown): value is GuestDisplayPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (payload.language === 'th' || payload.language === 'en')
    && typeof payload.eventName === 'string' && payload.eventName.length <= 120
    && ['ready', 'connecting', 'disconnected', 'countdown', 'capturing', 'review'].includes(String(payload.status))
    && (payload.mediaMode === 'photo' || payload.mediaMode === 'video')
    && (payload.countdown === null || (Number.isSafeInteger(payload.countdown) && (payload.countdown as number) >= 0 && (payload.countdown as number) <= 30))
    && Number.isSafeInteger(payload.resultCount) && (payload.resultCount as number) >= 0 && (payload.resultCount as number) <= 100
    && typeof payload.previewDataUrl === 'string' && payload.previewDataUrl.length <= 500_000
    && (!payload.previewDataUrl || /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(payload.previewDataUrl))
    && typeof payload.qrDataUrl === 'string' && payload.qrDataUrl.length <= 500_000
    && (!payload.qrDataUrl || /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(payload.qrDataUrl))
    && typeof payload.message === 'string' && payload.message.length <= 240;
}
app.on('ready', () => {
  if (!hasSingleInstanceLock) return;
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const media = details as Electron.MediaAccessPermissionRequest;
    const videoOnly = media.mediaTypes?.includes('video') && !media.mediaTypes.includes('audio');
    callback(permission === 'media' && Boolean(videoOnly) && trustedMediaRequest(webContents, details.requestingUrl, details.isMainFrame));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const videoOnly = details.mediaType === 'video';
    return permission === 'media' && videoOnly && trustedMediaRequest(webContents, details.requestingUrl ?? requestingOrigin, details.isMainFrame);
  });
  ipcMain.handle('koko:status', event => { trusted(event); return status(); });
  ipcMain.handle('koko:print-printers', async event => {
    trusted(event);
    if (!mainWindow) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(printer => ({ name: printer.name, displayName: printer.displayName, description: printer.description }));
  });
  ipcMain.handle('koko:print-jobs', event => { trusted(event); drainPrintQueue(); return printQueue().list(); });
  ipcMain.handle('koko:print-submit', (event, value: unknown, options: unknown) => {
    trusted(event);
    if (!(value instanceof Uint8Array) || value.byteLength > 30 * 1024 * 1024 || !options || typeof options !== 'object') throw new Error('Invalid print request.');
    const image = nativeImage.createFromBuffer(Buffer.from(value));
    const size = image.getSize();
    if (image.isEmpty() || size.width < 1 || size.height < 1 || size.width > 12_000 || size.height > 12_000 || size.width * size.height > 100_000_000) throw new Error('Print image could not be decoded or is too large.');
    const input = options as Record<string, unknown>;
    const printerName = typeof input.printerName === 'string' ? input.printerName : '';
    const snapshot: PrintOptionsSnapshot = {
      printerName, paper: input.paper as PrintOptionsSnapshot['paper'], landscape: input.landscape as boolean, copies: input.copies as number
    };
    if (printerName) {
      if (!mainWindow) throw new Error('Printer list is unavailable.');
      return mainWindow.webContents.getPrintersAsync().then(printers => {
        if (!printers.some(printer => printer.name === printerName)) throw new Error('Selected printer is not currently available.');
        const job = printQueue().enqueue(value, snapshot);
        setTimeout(drainPrintQueue, 150);
        log('print-job-queued', undefined, { jobId: job.id, printerName, copies: snapshot.copies, paper: snapshot.paper });
        return job;
      });
    }
    const job = printQueue().enqueue(value, snapshot);
    setTimeout(drainPrintQueue, 150);
    log('print-job-queued', undefined, { jobId: job.id, printerName: '', copies: snapshot.copies, paper: snapshot.paper });
    return job;
  });
  ipcMain.handle('koko:print-cancel', (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error('Invalid print job ID.');
    const job = printQueue().get(id);
    if (!job || job.status !== 'pending') return job;
    const updated = printQueue().update(id, 'cancelled');
    log('print-job-cancelled', undefined, { jobId: id });
    return updated;
  });
  ipcMain.handle('koko:print-retry', (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error('Invalid print job ID.');
    const job = printQueue().get(id);
    if (!job || job.status !== 'failed') return job;
    const updated = printQueue().update(id, 'pending');
    setTimeout(drainPrintQueue, 150);
    return updated;
  });
  ipcMain.handle('koko:settings', (event, value: unknown) => {
    trusted(event);
    if (!validSettings(value)) throw new Error('Invalid settings');
    try {
      mkdirSync(dataDir(), { recursive: true });
      const temporaryFile = `${settingsFile()}.tmp`;
      writeFileSync(temporaryFile, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporaryFile, settingsFile());
      log('settings-saved');
      return value;
    }
    catch (error) { lastError = 'Could not save settings'; log('settings-error', error); throw new Error(lastError); }
  });
  ipcMain.handle('koko:fullscreen', (event, value: unknown) => {
    trusted(event);
    if (typeof value !== 'boolean') throw new Error('Invalid fullscreen value');
    mainWindow?.setFullScreen(value);
    return mainWindow?.isFullScreen() ?? false;
  });
  ipcMain.handle('koko:display-list', event => { trusted(event); return listGuestDisplays(); });
  ipcMain.handle('koko:display-open', (event, displayId: unknown) => {
    trusted(event);
    if (!Number.isSafeInteger(displayId)) throw new Error('Choose a valid display');
    if (mainWindow && screen.getDisplayMatching(mainWindow.getBounds()).id === displayId) throw new Error('Choose a display other than the operator screen');
    createGuestDisplayWindow(displayId as number);
    return true;
  });
  ipcMain.handle('koko:display-close', event => {
    if (event.sender === mainWindow?.webContents) trusted(event);
    else if (event.sender !== guestDisplayWindow?.webContents || event.senderFrame !== guestDisplayWindow.webContents.mainFrame) throw new Error('Untrusted frame');
    guestDisplayWindow?.close();
    return true;
  });
  ipcMain.handle('koko:display-open-state', event => { trusted(event); return Boolean(guestDisplayWindow && !guestDisplayWindow.isDestroyed()); });
  ipcMain.handle('koko:display-publish', (event, value: unknown) => {
    trusted(event);
    if (!validGuestDisplayPayload(value)) throw new Error('Invalid guest display update');
    if (!guestDisplayWindow || guestDisplayWindow.isDestroyed()) return false;
    guestDisplayWindow.webContents.send('koko:guest-display-update', value);
    return true;
  });
  screen.on('display-removed', (_event, display) => {
    if (!guestDisplayWindow || guestDisplayWindow.isDestroyed()) return;
    const bounds = guestDisplayWindow.getBounds();
    if (bounds.x === display.bounds.x && bounds.y === display.bounds.y) guestDisplayWindow.close();
  });
  ipcMain.handle('koko:photo-storage-status', event => { trusted(event); return photoStorageStatus(); });
  ipcMain.handle('koko:camera-folder-status', event => { trusted(event); return cameraFolderStatus(); });
  ipcMain.handle('koko:camera-folder-start', async event => {
    trusted(event);
    if (!mainWindow) throw new Error('Window is unavailable');
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Choose camera export folder', properties: ['openDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return cameraFolderStatus();
    return startCameraFolderWatcher(choice.filePaths[0]);
  });
  ipcMain.handle('koko:camera-folder-stop', event => {
    trusted(event);
    const previous = cameraFolderWatcher?.status() ?? readCameraFolderConfig();
    const stopped = cameraFolderWatcher?.stop();
    cameraFolderWatcher = null;
    writeCameraFolderConfig(previous.folderPath, false);
    cameraFolderRestoreError = stopped?.lastError ?? null;
    return { enabled: false, folderPath: previous.folderPath, importedCount: stopped?.importedCount ?? 0, lastError: cameraFolderRestoreError };
  });
  ipcMain.handle('koko:photo-recovery-inspect', event => {
    trusted(event);
    const root = configuredPhotoRoot();
    return root ? getPhotoStore(root).inspectRecovery() : [];
  });
  ipcMain.handle('koko:photo-recovery-import', async (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !mainWindow) throw new Error('Invalid recovery photo');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Photo storage is not configured');
    const store = getPhotoStore(root);
    if (!store.inspectRecovery().some(item => item.kind === 'orphan-photo' && item.id === id)) throw new Error('This recovery item is no longer available');
    const photoPath = path.join(root, 'photos', id + '.jpg');
    const info = lstatSync(photoPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 100 * 1024 * 1024) throw new Error('Recovery photo is unsafe or too large');
    const bytes = readFileSync(photoPath);
    const dimensions = jpegDimensions(bytes);
    const image = nativeImage.createFromBuffer(bytes);
    const decoded = image.getSize();
    if (image.isEmpty() || decoded.width !== dimensions.width || decoded.height !== dimensions.height) throw new Error('Recovery photo could not be decoded safely');
    const thai = readSettings().language === 'th';
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: thai ? 'นำภาพกู้คืนเข้าคลัง?' : 'Import recovered photo?',
      message: thai ? 'ภาพนี้เป็น JPEG ที่ตรวจพบแต่ยังไม่อยู่ในดัชนีคลัง' : 'This JPEG was found outside the library index.',
      detail: thai ? `${decoded.width} × ${decoded.height} · ${id}\nภาพจะไม่ถูกผูกกับ Event` : `${decoded.width} × ${decoded.height} · ${id}\nThe photo will remain unassigned to any event.`,
      buttons: thai ? ['ยกเลิก', 'นำเข้าคลัง'] : ['Cancel', 'Import to library'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (confirmation.response !== 1) return false;
    const imported = await store.importOrphan(id, decoded.width, decoded.height);
    log('photo-recovery-imported', undefined, { id, byteLength: imported.byteLength });
    return true;
  });
  ipcMain.handle('koko:photo-recovery-quarantine', async (event, kind: unknown, token: unknown) => {
    trusted(event);
    if ((kind !== 'incomplete-write' && kind !== 'index-temp') || typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token) || !mainWindow) throw new Error('Invalid recovery item');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Photo storage is not configured');
    const store = getPhotoStore(root);
    if (!store.inspectRecovery().some(item => item.kind === kind && item.token === token)) throw new Error('This recovery item is no longer available');
    const thai = readSettings().language === 'th';
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: thai ? 'ย้ายไฟล์ไปพื้นที่กักกัน?' : 'Quarantine temporary file?',
      message: thai ? 'ไฟล์นี้ยังไม่ใช่ภาพที่บันทึกสมบูรณ์' : 'This file is not a completed, verified photo.',
      detail: thai ? 'ไฟล์จะถูกย้ายไป recovery-quarantine ในโฟลเดอร์เก็บภาพ และจะไม่ถูกลบ' : 'The file will be moved to recovery-quarantine inside the selected storage folder. It will not be deleted.',
      buttons: thai ? ['ยกเลิก', 'ย้ายไปกักกัน'] : ['Cancel', 'Quarantine file'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (confirmation.response !== 1) return false;
    const quarantined = await store.quarantineTemporary(kind, token);
    if (quarantined) log('photo-recovery-quarantined', undefined, { kind });
    return quarantined;
  });
  ipcMain.handle('koko:photo-recovery-rebuild', async event => {
    trusted(event);
    if (!mainWindow) throw new Error('Application window is unavailable');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Photo storage is not configured');
    const store = getPhotoStore(root);
    const candidates = store.previewIndexRecovery();
    const validIds = candidates.filter(candidate => {
      const image = nativeImage.createFromBuffer(Buffer.from(candidate.bytes));
      const size = image.getSize();
      return !image.isEmpty() && size.width === candidate.width && size.height === candidate.height;
    }).map(candidate => candidate.id);
    if (!validIds.length) throw new Error('No valid JPEGs were found to rebuild the photo index');
    const thai = readSettings().language === 'th';
    const discardedCount = candidates.length - validIds.length;
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: thai ? 'สร้างดัชนีคลังภาพใหม่?' : 'Rebuild the photo library index?',
      message: thai ? `พบภาพที่ตรวจสอบได้ ${validIds.length} ภาพ` : `${validIds.length} verified photo(s) can be recovered.`,
      detail: thai ? `ดัชนีเดิมจะถูกเก็บใน recovery-quarantine ภาพที่สร้างดัชนีใหม่จะไม่ผูกกับ Event และเวลาเดิมจะอ้างอิงจากไฟล์${discardedCount ? ` ส่วน JPEG ที่อ่านไม่ได้ ${discardedCount} ไฟล์จะคงเดิม` : ''}` : `The damaged index will be preserved in recovery-quarantine. Recovered photos will be unassigned to events, and timestamps will use file modification times.${discardedCount ? ` ${discardedCount} unreadable JPEG(s) will be left untouched.` : ''}`,
      buttons: thai ? ['ยกเลิก', 'เก็บดัชนีใหม่'] : ['Cancel', 'Rebuild index'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (confirmation.response !== 1) return null;
    const count = await store.rebuildIndexFromPhotos(validIds);
    log('photo-index-rebuilt', undefined, { recoveredCount: count, rejectedCount: discardedCount });
    return count;
  });
  ipcMain.handle('koko:events-list', event => {
    trusted(event);
    const store = getPhotoStore(configuredPhotoRoot() ?? dataDir());
    return { activeEventId: events().active()?.id ?? null, events: events().list().map(item => ({ ...item, photoCount: store.countPhotosForEvent(item.id) })) };
  });
  ipcMain.handle('koko:events-create', (event, value: unknown) => { trusted(event); return events().create(value); });
  ipcMain.handle('koko:events-update', (event, id: unknown, value: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error('Invalid event ID');
    return events().update(id, value);
  });
  ipcMain.handle('koko:events-set-active', (event, id: unknown) => { trusted(event); return events().setActive(id); });
  ipcMain.handle('koko:events-delete', (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error('Invalid event ID');
    if (events().active()?.id === id) throw new Error('End this event session before deleting the event');
    const store = getPhotoStore(configuredPhotoRoot() ?? dataDir());
    if (store.countPhotosForEvent(id) > 0) throw new Error('This event still has photos. Keep it or remove the photos first.');
    return events().delete(id);
  });
  ipcMain.handle('koko:open-photo-storage', async event => {
    trusted(event);
    const root = configuredPhotoRoot();
    if (!root || !existsSync(root)) throw new Error('Photo storage folder is not configured');
    const safeRoot = validateStorageRoot(root);
    const error = await shell.openPath(safeRoot);
    if (error) throw new Error('Could not open the photo storage folder');
    return true;
  });
  ipcMain.handle('koko:license-status', async event => { trusted(event); return licenses().getStatus(); });
  ipcMain.handle('koko:license-plans', async event => { trusted(event); return licenses().getPlans(); });
  ipcMain.handle('koko:license-activate', async (event, value: unknown) => {
    trusted(event);
    if (typeof value !== 'string') throw new Error('Invalid license key');
    try {
      const result = await licenses().activate(value);
      log('license-activated', undefined, { state: result.state });
      return result;
    } catch (error) {
      log('license-activation-failed', error);
      throw error instanceof Error ? error : new Error('Could not activate license');
    }
  });
  ipcMain.handle('koko:license-deactivate', async event => { trusted(event); return licenses().deactivate(); });
  ipcMain.handle('koko:begin-capture', async (event, photoCount: unknown, templateValue: unknown, mediaModeValue: unknown) => {
    trusted(event);
    await licenses().assertFeature('capture');
    const template = validateCaptureTemplate(templateValue);
    const mediaMode = mediaModeValue === undefined ? 'photo' : mediaModeValue;
    if (mediaMode !== 'photo' && mediaMode !== 'video') throw new Error('Invalid capture mode');
    if (mediaMode === 'photo' && template && template.count !== photoCount) throw new Error('Capture count does not match the selected template');
    const session = captureSessions().start(events().active()?.id ?? null, template);
    try {
      const authorizationId = captureAuthorizations.begin(photoCount, session.eventId, Date.now(), session.id);
      return { authorizationId, sessionId: session.id, cloudShareUrl: null };
    } catch (error) { captureSessions().finish(session.id, 'cancelled'); throw error; }
  });
  ipcMain.handle('koko:cancel-capture', (event, value: unknown) => {
    trusted(event);
    // Cancellation only stops the renderer session; an already in-flight save is allowed to finish.
    const sessionId = typeof value === 'string' ? captureAuthorizations.getSessionId(value) : null;
    const cancelled = captureAuthorizations.cancel(value);
    if (cancelled && sessionId) captureSessions().cancel(sessionId);
    return cancelled;
  });
  ipcMain.handle('koko:capture-sessions-list', (event, limit: unknown, offset: unknown) => {
    trusted(event);
    if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) throw new Error('Invalid capture session page');
    return captureSessions().list(limit as number, offset as number);
  });
  ipcMain.handle('koko:capture-session-finish', (event, sessionId: unknown, nextStatus: unknown) => {
    trusted(event);
    if (typeof sessionId !== 'string' || !['review', 'confirmed', 'retaken'].includes(nextStatus as string)) throw new Error('Invalid capture session update');
    return captureSessions().finish(sessionId, nextStatus as 'review' | 'confirmed' | 'retaken');
  });
  ipcMain.handle('koko:memory-status', event => { trusted(event); return memoryConnections().getStatus(); });
  ipcMain.handle('koko:memory-import-config', async event => {
    trusted(event);
    if (!mainWindow) throw new Error('Application window is unavailable.');
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Import KOKOMEMORY uploader configuration', properties: ['openFile'], filters: [{ name: 'Uploader configuration', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePaths[0]) return memoryConnections().getStatus();
    const selected = choice.filePaths[0];
    const metadata = lstatSync(selected);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16_000) throw new Error('Select a regular uploader JSON file smaller than 16 KB.');
    const result = memoryConnections().importUploaderConfig(readFileSync(selected, 'utf8'));
    log('kokomemory-config-imported', undefined, { bookingId: result.bookingId ?? '', shareId: result.shareId ?? '' });
    return result;
  });
  ipcMain.handle('koko:memory-gallery-url', (event, value: unknown) => {
    trusted(event);
    if (typeof value !== 'string' || value.length > 2_000) throw new Error('Invalid gallery URL.');
    return memoryConnections().setActiveGalleryUrl(value);
  });
  ipcMain.handle('koko:memory-clear', event => { trusted(event); return memoryConnections().clearActive(); });
  ipcMain.handle('koko:memory-session-status', (event, sessionId: unknown) => {
    trusted(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid capture session ID.');
    const status = memoryConnections().getStatus();
    return memoryQueue().statusForSession(sessionId, status.connectionId);
  });
  ipcMain.handle('koko:memory-sync-session', async (event, sessionId: unknown) => {
    trusted(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid capture session ID.');
    const sessionRecord = captureSessions().get(sessionId);
    if (!sessionRecord || sessionRecord.status !== 'confirmed') throw new Error('Confirm this capture session before uploading it to KOKOMEMORY.');
    const connection = memoryConnections().getActive();
    if (!connection) throw new Error('Import the uploader configuration for the intended booking first.');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Choose a photo storage folder before uploading.');
    const photoIds = sessionRecord.compositionPhotoId ? [sessionRecord.compositionPhotoId] : sessionRecord.photoIds;
    const jobs = memoryQueue();
    jobs.enqueueSession(sessionRecord, photoIds, { connectionId: connection.id, bookingId: connection.bookingId, shareId: connection.shareId });
    await drainKokoMemoryQueue(sessionId);
    return jobs.statusForSession(sessionId, connection.id);
  });
  ipcMain.handle('koko:photo-cloud-sync', async (event, sessionId: unknown) => {
    trusted(event);
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid capture session ID');
    const session = captureSessions().get(sessionId);
    if (!session) throw new Error('Capture session not found');
    let shareUrl = photoCloud().getShareUrl(session.id);
    if (!shareUrl) {
      const eventName = session.eventId ? events().get(session.eventId)?.name : null;
      shareUrl = await photoCloud().createForSession(session.id, eventName || `Photo session ${new Date(session.createdAt).toLocaleString('en-GB')}`);
    }
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Choose a photo storage folder before uploading photos');
    const videoIds = session.videoIds ?? [];
    const photoIds = [...session.photoIds, ...(session.compositionPhotoId ? [session.compositionPhotoId] : [])];
    const mediaCount = photoIds.length + videoIds.length;
    let completed = 0;
    const sendProgress = () => {
      if (!event.sender.isDestroyed()) event.sender.send('koko:photo-cloud-progress', {
        sessionId: session.id, completed, total: mediaCount,
        uploadedCount: photoCloud().getUploadedPhotoIds(session.id).filter(id => photoIds.includes(id)).length
          + photoCloud().getUploadedVideoIds(session.id).filter(id => videoIds.includes(id)).length
      });
    };
    sendProgress();
    for (const photoId of photoIds) {
      try {
        const photo = getPhotoStore(root).readPhoto(photoId);
        await photoCloud().uploadForSession(session.id, photoId, photo.bytes);
      } catch (error) { log('photo-cloud-retry-failed', error, { sessionId: session.id, photoId }); }
      completed++;
      sendProgress();
    }
    for (const videoId of videoIds) {
      try { await photoCloud().uploadVideoForSession(session.id, videoId, getVideoStore(root).read(videoId).bytes); }
      catch (error) { log('video-cloud-retry-failed', error, { sessionId: session.id, videoId }); }
      completed++;
      sendProgress();
    }
    const uploadedPhotos = photoCloud().getUploadedPhotoIds(session.id).filter(id => photoIds.includes(id));
    const uploadedVideos = photoCloud().getUploadedVideoIds(session.id).filter(id => videoIds.includes(id));
    return { shareUrl, uploadedCount: uploadedPhotos.length + uploadedVideos.length, mediaCount: photoIds.length + videoIds.length, photoCount: photoIds.length, videoCount: videoIds.length };
  });
  ipcMain.handle('koko:photo-cloud-link', (event, sessionId: unknown) => {
    trusted(event);
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid capture session ID');
    if (!captureSessions().get(sessionId)) return null;
    return photoCloud().getShareUrl(sessionId);
  });
  ipcMain.handle('koko:photo-cloud-status', (event, sessionId: unknown) => {
    trusted(event);
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid capture session ID');
    if (!captureSessions().get(sessionId)) return { shareUrl: null, revoked: false };
    return photoCloud().getShareStatus(sessionId);
  });
  ipcMain.handle('koko:photo-cloud-revoke', async (event, sessionId: unknown) => {
    trusted(event);
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid capture session ID');
    if (!captureSessions().get(sessionId)) throw new Error('Capture session not found');
    return photoCloud().revokeShareForSession(sessionId);
  });
  ipcMain.handle('koko:choose-photo-storage', async event => {
    trusted(event);
    if (!mainWindow) throw new Error('Window is unavailable');
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Choose photo storage folder', properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return photoStorageStatus();
    const root = validateStorageRoot(choice.filePaths[0]);
    const cameraConfig = readCameraFolderConfig();
    if (cameraConfig.enabled && cameraConfig.folderPath && existsSync(cameraConfig.folderPath)
      && pathsOverlap(realpathSync(cameraConfig.folderPath), realpathSync(root))) {
      throw new Error('Stop camera folder monitoring before selecting an overlapping photo storage folder.');
    }
    getPhotoStore(root).configure();
    mkdirSync(dataDir(), { recursive: true });
    const temporaryFile = photoStorageConfigFile() + '.' + randomUUID() + '.tmp';
    writeFileSync(temporaryFile, JSON.stringify({ version: 1, root }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporaryFile, photoStorageConfigFile());
    log('photo-storage-selected');
    return photoStorageStatus();
  });
  ipcMain.handle('koko:save-photo', async (event, value: unknown, authorizationId: unknown) => {
    trusted(event);
    if (typeof authorizationId !== 'string') throw new Error('Capture authorization required');
    const grant = captureAuthorizations.claim(authorizationId);
    const { eventId, sessionId } = grant;
    try {
    if (eventId && !events().get(eventId)) throw new Error('The selected event no longer exists. Start a new session.');
    if (!(value instanceof Uint8Array) || value.byteLength < 4 || value.byteLength > 40 * 1024 * 1024) throw new Error('Invalid photo size');
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('Only complete JPEG photos can be saved');
    const { width, height } = jpegDimensions(bytes);
    const image = nativeImage.createFromBuffer(bytes);
    const decodedSize = image.getSize();
    if (image.isEmpty() || decodedSize.width !== width || decodedSize.height !== height) throw new Error('Invalid JPEG image');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Choose a photo storage folder first');
    let photo: ReturnType<PhotoStore['saveJpeg']> extends Promise<infer T> ? T : never;
    try { photo = await getPhotoStore(root).saveJpeg(bytes, width, height, eventId); }
    catch (error) {
      log('photo-save-failed', error);
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === 'ENOSPC' || code === 'EDQUOT') throw new Error('Not enough free space to save this photo. Free space or choose another folder.');
      if (code === 'EACCES' || code === 'EROFS') throw new Error('Photo storage is not writable. Check folder permissions or choose another folder.');
      throw error;
    }
    captureSessions().addPhoto(sessionId, photo.id);
    const cloudUploaded = photoCloud().getUploadedPhotoIds(sessionId).includes(photo.id);
    void uploadCaptureSessionToCloud(sessionId).catch(error => log('photo-cloud-upload-failed', error, { photoId: photo.id, sessionId }));
    log('photo-saved', undefined, { byteLength: photo.byteLength, width, height });
    captureAuthorizations.complete(authorizationId);
    return { id: photo.id, width, height, byteLength: photo.byteLength, sha256: photo.sha256, savedAt: photo.savedAt, cloudUploaded, ...(photo.eventId ? { eventId: photo.eventId } : {}) };
    } finally {
      captureAuthorizations.release(authorizationId);
    }
  });
  ipcMain.handle('koko:save-composition', async (event, value: unknown, sessionIdValue: unknown) => {
    trusted(event);
    if (typeof sessionIdValue !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionIdValue)) throw new Error('Invalid capture session ID');
    if (!(value instanceof Uint8Array) || value.byteLength < 4 || value.byteLength > 40 * 1024 * 1024) throw new Error('Invalid composed photo size');
    const session = captureSessions().get(sessionIdValue);
    if (!session || session.status !== 'review' || !session.template || session.photoIds.length !== session.template.count) throw new Error('Capture session is not ready for a composed photo');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Choose a photo storage folder first');
    if (session.compositionPhotoId) return getPhotoStore(root).readPhoto(session.compositionPhotoId).photo;
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('Only complete JPEG compositions can be saved');
    const { width, height } = jpegDimensions(bytes);
    const image = nativeImage.createFromBuffer(bytes);
    const decodedSize = image.getSize();
    if (image.isEmpty() || decodedSize.width !== width || decodedSize.height !== height) throw new Error('Invalid composed JPEG image');
    const photo = await getPhotoStore(root).saveJpeg(bytes, width, height, session.eventId);
    captureSessions().attachComposition(session.id, photo.id);
    return { id: photo.id, width: photo.width, height: photo.height, byteLength: photo.byteLength, sha256: photo.sha256, savedAt: photo.savedAt,
      ...(photo.eventId ? { eventId: photo.eventId } : {}) };
  });
  ipcMain.handle('koko:save-video', async (event, value: unknown, width: unknown, height: unknown, durationMs: unknown, authorizationId: unknown) => {
    trusted(event);
    await licenses().assertFeature('capture');
    if (typeof authorizationId !== 'string') throw new Error('Capture authorization required');
    const grant = captureAuthorizations.claim(authorizationId);
    const { eventId, sessionId } = grant;
    try {
      if (eventId && !events().get(eventId)) throw new Error('The selected event no longer exists. Start a new session.');
      if (!(value instanceof Uint8Array) || value.byteLength < 4 || value.byteLength > 100 * 1024 * 1024
        || value[0] !== 0x1a || value[1] !== 0x45 || value[2] !== 0xdf || value[3] !== 0xa3) throw new Error('Invalid WebM clip');
      const root = configuredPhotoRoot();
      if (!root) throw new Error('Choose a photo storage folder first');
      const video = await getVideoStore(root).saveWebm(value, width as number, height as number, durationMs as number, eventId);
      captureSessions().addVideo(sessionId, video.id);
      const cloudUploaded = photoCloud().getUploadedVideoIds(sessionId).includes(video.id);
      void uploadCaptureSessionToCloud(sessionId).catch(error => log('video-cloud-upload-failed', error, { videoId: video.id, sessionId }));
      log('video-saved', undefined, { byteLength: video.byteLength, width: video.width, height: video.height, durationMs: video.durationMs });
      captureAuthorizations.complete(authorizationId);
      return { id: video.id, width: video.width, height: video.height, byteLength: video.byteLength, durationMs: video.durationMs,
        sha256: video.sha256, savedAt: video.savedAt, cloudUploaded, ...(video.eventId ? { eventId: video.eventId } : {}) };
    } catch (error) {
      log('video-save-failed', error);
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === 'ENOSPC' || code === 'EDQUOT') throw new Error('Not enough free space to save this video. Free space or choose another folder.');
      if (code === 'EACCES' || code === 'EROFS') throw new Error('Video storage is not writable. Check folder permissions or choose another folder.');
      throw error;
    } finally { captureAuthorizations.release(authorizationId); }
  });
  ipcMain.handle('koko:read-video', (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error('Invalid video ID');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Video storage is not configured');
    const result = getVideoStore(root).read(id);
    return { video: result.video, webmBytes: result.bytes };
  });
  ipcMain.handle('koko:export-video', async (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string' || !mainWindow) throw new Error('Invalid video request');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Video storage is not configured');
    const result = getVideoStore(root).read(id);
    const choice = await dialog.showSaveDialog(mainWindow, { title: 'Export video', defaultPath: result.video.fileName,
      buttonLabel: 'Export video', filters: [{ name: 'WebM video', extensions: ['webm'] }] });
    if (choice.canceled || !choice.filePath) return false;
    const temporaryPath = `${choice.filePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, result.bytes, { flag: 'wx', mode: 0o600 });
      renameSync(temporaryPath, choice.filePath);
      log('video-exported', undefined, { byteLength: result.video.byteLength, durationMs: result.video.durationMs });
      return true;
    } catch (error) {
      try { unlinkSync(temporaryPath); } catch { /* Preserve the original export error. */ }
      log('video-export-failed', error);
      throw new Error('Could not export this video');
    }
  });
  ipcMain.handle('koko:list-photos', (event, offset: unknown, limit: unknown, eventId: unknown) => {
    trusted(event);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit)) throw new Error('Invalid photo page');
    if (eventId !== undefined && eventId !== null && (typeof eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId))) throw new Error('Invalid event ID');
    const root = configuredPhotoRoot();
    if (!root) return [];
    return getPhotoStore(root).listPhotos(offset as number, limit as number, eventId as string | null | undefined);
  });
  ipcMain.handle('koko:read-photo', (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error('Invalid photo ID');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Photo storage is not configured');
    const result = getPhotoStore(root).readPhoto(id);
    const image = nativeImage.createFromBuffer(Buffer.from(result.bytes));
    const size = image.getSize();
    if (image.isEmpty() || size.width !== result.photo.width || size.height !== result.photo.height) throw new Error('Photo image is invalid');
    return { photo: result.photo, jpegBytes: result.bytes };
  });
  ipcMain.handle('koko:export-photo', async (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string' || !mainWindow) throw new Error('Invalid photo request');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Photo storage is not configured');
    const result = getPhotoStore(root).readPhoto(id);
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: 'Export photo', defaultPath: result.photo.fileName,
      buttonLabel: 'Export photo', filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
    });
    if (choice.canceled || !choice.filePath) return false;
    const temporaryPath = `${choice.filePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, result.bytes, { flag: 'wx', mode: 0o600 });
      renameSync(temporaryPath, choice.filePath);
      log('photo-exported', undefined, { byteLength: result.photo.byteLength });
      return true;
    } catch (error) {
      try { unlinkSync(temporaryPath); } catch { /* Preserve the original export error. */ }
      log('photo-export-failed', error);
      throw new Error('Could not export this photo');
    }
  });
  ipcMain.handle('koko:delete-photo', async (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string' || !mainWindow) throw new Error('Invalid photo request');
    const root = configuredPhotoRoot();
    if (!root) throw new Error('Photo storage is not configured');
    const store = getPhotoStore(root);
    const { photo } = store.readPhoto(id);
    const thai = readSettings().language === 'th';
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: thai ? 'ย้ายภาพไปถังขยะ?' : 'Move photo to Trash?',
      message: thai ? 'ภาพนี้จะถูกย้ายไปยังถังขยะของระบบ' : 'This photo will be moved to the system Trash.',
      detail: thai ? `${photo.width} × ${photo.height} · ${new Date(photo.savedAt).toLocaleString('th-TH')}` : `${photo.width} × ${photo.height} · ${photo.savedAt}`,
      buttons: thai ? ['ยกเลิก', 'ย้ายไปถังขยะ'] : ['Cancel', 'Move to Trash'],
      defaultId: 0, cancelId: 0, noLink: true
    });
    if (confirmation.response !== 1) return false;
    // Revalidate the managed record and its path after the native dialog returns.
    const verified = store.readPhoto(id);
    if (verified.photo.fileName !== photo.fileName) throw new Error('Photo changed while waiting for confirmation');
    const removed = await store.movePhotoToTrash(id, photoPath => shell.trashItem(photoPath));
    if (removed) log('photo-moved-to-trash', undefined, { id });
    return removed;
  });
  createWindow();
  cameraFolderConfig = readCameraFolderConfig();
  if (cameraFolderConfig.enabled && cameraFolderConfig.folderPath) {
    try { startCameraFolderWatcher(cameraFolderConfig.folderPath); }
    catch (error) { cameraFolderRestoreError = error instanceof Error ? error.message : 'Could not restore the camera folder'; log('camera-folder-restore-failed', error); writeCameraFolderConfig(cameraFolderConfig.folderPath, false); }
  }
  setTimeout(recoverPendingPhotoCloudUploads, 2000);
  setTimeout(() => { try { memoryQueue(); void drainKokoMemoryQueue(); } catch (error) { log('kokomemory-queue-restore-failed', error); } }, 2500);
  setInterval(() => { void drainKokoMemoryQueue().catch(error => log('kokomemory-queue-drain-failed', error)); }, 15_000);
});
app.on('before-quit', () => { cameraFolderWatcher?.stop(); });
app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', error => { lastError = 'An application error occurred'; log('uncaught-exception', error); });
process.on('unhandledRejection', reason => { log('unhandled-rejection', reason); });
