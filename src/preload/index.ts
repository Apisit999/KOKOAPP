import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../shared/contract';

const bridge: Bridge = {
  isMacOS: process.platform === 'darwin',
  getStatus: () => ipcRenderer.invoke('koko:status'),
  saveSettings: value => ipcRenderer.invoke('koko:settings', value),
  setFullscreen: value => ipcRenderer.invoke('koko:fullscreen', value),
  listDisplays: () => ipcRenderer.invoke('koko:display-list'),
  openGuestDisplay: displayId => ipcRenderer.invoke('koko:display-open', displayId),
  closeGuestDisplay: () => ipcRenderer.invoke('koko:display-close'),
  isGuestDisplayOpen: () => ipcRenderer.invoke('koko:display-open-state'),
  publishGuestDisplay: payload => ipcRenderer.invoke('koko:display-publish', payload),
  onGuestDisplayUpdate: listener => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload);
    ipcRenderer.on('koko:guest-display-update', handler);
    return () => ipcRenderer.removeListener('koko:guest-display-update', handler);
  },
  getPhotoStorageStatus: () => ipcRenderer.invoke('koko:photo-storage-status'),
  inspectPhotoRecovery: () => ipcRenderer.invoke('koko:photo-recovery-inspect'),
  importRecoveredPhoto: id => ipcRenderer.invoke('koko:photo-recovery-import', id),
  quarantineRecoveryItem: (kind, token) => ipcRenderer.invoke('koko:photo-recovery-quarantine', kind, token),
  rebuildPhotoIndex: () => ipcRenderer.invoke('koko:photo-recovery-rebuild'),
  choosePhotoStorage: () => ipcRenderer.invoke('koko:choose-photo-storage'),
  openPhotoStorage: () => ipcRenderer.invoke('koko:open-photo-storage'),
  beginCapture: (photoCount, template, mediaMode) => ipcRenderer.invoke('koko:begin-capture', photoCount ?? 1, template ?? null, mediaMode ?? 'photo'),
  cancelCapture: captureAuthorization => ipcRenderer.invoke('koko:cancel-capture', captureAuthorization),
  savePhoto: (jpegBytes, captureAuthorization) => ipcRenderer.invoke('koko:save-photo', jpegBytes, captureAuthorization),
  saveComposition: (jpegBytes, sessionId) => ipcRenderer.invoke('koko:save-composition', jpegBytes, sessionId),
  saveVideo: (webmBytes, width, height, durationMs, captureAuthorization) => ipcRenderer.invoke('koko:save-video', webmBytes, width, height, durationMs, captureAuthorization),
  readVideo: id => ipcRenderer.invoke('koko:read-video', id),
  exportVideo: id => ipcRenderer.invoke('koko:export-video', id),
  listCaptureSessions: (limit, offset) => ipcRenderer.invoke('koko:capture-sessions-list', limit ?? 100, offset ?? 0),
  completeCaptureSession: (sessionId, nextStatus) => ipcRenderer.invoke('koko:capture-session-finish', sessionId, nextStatus),
  syncPhotoCloudSession: sessionId => ipcRenderer.invoke('koko:photo-cloud-sync', sessionId),
  onPhotoCloudProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('koko:photo-cloud-progress', handler);
    return () => ipcRenderer.removeListener('koko:photo-cloud-progress', handler);
  },
  getCameraFolderWatchStatus: () => ipcRenderer.invoke('koko:camera-folder-status'),
  startCameraFolderWatch: () => ipcRenderer.invoke('koko:camera-folder-start'),
  stopCameraFolderWatch: () => ipcRenderer.invoke('koko:camera-folder-stop'),
  onCameraFolderPhotoImport: listener => {
    const handler = (_event: Electron.IpcRendererEvent, result: Parameters<typeof listener>[0]) => listener(result);
    ipcRenderer.on('koko:camera-folder-photo-import', handler);
    return () => ipcRenderer.removeListener('koko:camera-folder-photo-import', handler);
  },
  getKokoMemoryStatus: () => ipcRenderer.invoke('koko:memory-status'),
  importKokoMemoryConfig: () => ipcRenderer.invoke('koko:memory-import-config'),
  setKokoMemoryGalleryUrl: value => ipcRenderer.invoke('koko:memory-gallery-url', value),
  clearKokoMemoryConnection: () => ipcRenderer.invoke('koko:memory-clear'),
  syncKokoMemorySession: sessionId => ipcRenderer.invoke('koko:memory-sync-session', sessionId),
  getKokoMemorySessionStatus: sessionId => ipcRenderer.invoke('koko:memory-session-status', sessionId),
  listPrintPrinters: () => ipcRenderer.invoke('koko:print-printers'),
  listPrintJobs: () => ipcRenderer.invoke('koko:print-jobs'),
  submitPrintImage: (pngBytes, options) => ipcRenderer.invoke('koko:print-submit', pngBytes, options),
  cancelPrintJob: jobId => ipcRenderer.invoke('koko:print-cancel', jobId),
  retryPrintJob: jobId => ipcRenderer.invoke('koko:print-retry', jobId),
  getPhotoCloudShareUrl: sessionId => ipcRenderer.invoke('koko:photo-cloud-link', sessionId),
  getPhotoCloudShareStatus: sessionId => ipcRenderer.invoke('koko:photo-cloud-status', sessionId),
  revokePhotoCloudShare: sessionId => ipcRenderer.invoke('koko:photo-cloud-revoke', sessionId),
  listPhotos: (offset, limit, eventId) => ipcRenderer.invoke('koko:list-photos', offset ?? 0, limit ?? 100, eventId),
  readPhoto: id => ipcRenderer.invoke('koko:read-photo', id),
  exportPhoto: id => ipcRenderer.invoke('koko:export-photo', id),
  deletePhoto: id => ipcRenderer.invoke('koko:delete-photo', id),
  getLicenseStatus: () => ipcRenderer.invoke('koko:license-status'),
  getLicensePlans: () => ipcRenderer.invoke('koko:license-plans'),
  activateLicense: licenseKey => ipcRenderer.invoke('koko:license-activate', licenseKey),
  deactivateLicense: () => ipcRenderer.invoke('koko:license-deactivate'),
  listEvents: () => ipcRenderer.invoke('koko:events-list'),
  createEvent: value => ipcRenderer.invoke('koko:events-create', value),
  updateEvent: (id, value) => ipcRenderer.invoke('koko:events-update', id, value),
  deleteEvent: id => ipcRenderer.invoke('koko:events-delete', id),
  setActiveEvent: id => ipcRenderer.invoke('koko:events-set-active', id)
};
contextBridge.exposeInMainWorld('koko', bridge);
