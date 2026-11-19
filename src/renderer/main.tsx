import { useEffect, useRef, useState } from 'react';
import { printerReadiness } from '../shared/printer-readiness';
import { createRoot } from 'react-dom/client';
import type { AppStatus, PhotoRecord, PhotoRecoveryIssue, PhotoStorageStatus, SavedPhoto, SavedVideo, Settings, PhotoboothEvent } from '../shared/contract';
import type { LicenseSnapshot, Plan } from '../shared/license-contract';
import { type CameraStatus } from './camera/camera-adapter';
import { Icon } from './icons';
import { AccountLinkCard } from './account-link-card';
import { UpdateBanner } from './update-banner';
import { TemplatesPage } from './templates';
import { refreshFonts } from './fonts';
import { loadGuestTemplate, type GuestTemplate } from './templates';
import { EventsPage } from './events';
import { cameraManager, PhotoThumb } from './ui-common';
import { CaptureSessionsPage } from './sessions';
import { CameraPanel } from './camera-panel';
import { GuestDisplay } from './guest-display';
import { cameraReadinessText, ReadinessItem, ReadinessChecklist, GuestPreviewPage } from './dashboard-parts';
import { CameraFolderWatchSettings, KokoMemorySettings, ReportProblem, GuestExitPinSettings } from './settings-sections';
import { ReceiptSettingsBlock } from './receipt';
import { BoothStatusCard } from './booth-status';

function App() {
  useEffect(() => { void refreshFonts(); }, []);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [mode, setMode] = useState<'operator' | 'guest'>('operator');
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [exitPinInput, setExitPinInput] = useState('');
  const [exitPinError, setExitPinError] = useState('');
  const [verifyingExitPin, setVerifyingExitPin] = useState(false);
  const exitPinInputRef = useRef<HTMLInputElement | null>(null);
  const [page, setPage] = useState('studio');
  const [deviceDiagnostics, setDeviceDiagnostics] = useState(false);
  const [printerCount, setPrinterCount] = useState<number | null>(null);
  useEffect(() => { void window.koko.listPrintPrinters().then(list => setPrinterCount(list.length)).catch(() => setPrinterCount(null)); }, [page]);
  const [message, setMessage] = useState('');
  const [photoStorage, setPhotoStorage] = useState<PhotoStorageStatus | null>(null);
  const [recoveryIssues, setRecoveryIssues] = useState<PhotoRecoveryIssue[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [showRecoveryDetails, setShowRecoveryDetails] = useState(false);
  const [recoveringPhotoId, setRecoveringPhotoId] = useState('');
  const [choosingStorage, setChoosingStorage] = useState(false);
  const [cameraState, setCameraState] = useState<CameraStatus>('searching');
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [eventData, setEventData] = useState<{ events: (PhotoboothEvent & { photoCount: number })[]; activeEventId: string | null }>({ events: [], activeEventId: null });
  const [captureSessions, setCaptureSessions] = useState<import('../shared/contract').CaptureSessionRecord[]>([]);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  const [guestTemplate, setGuestTemplate] = useState<GuestTemplate | null>(() => loadGuestTemplate());
  const [guestDisplayActive, setGuestDisplayActive] = useState(false);
  const [availableGuestDisplays, setAvailableGuestDisplays] = useState<Array<{ id: number; label: string; width: number; height: number }>>([]);
  const [selectedGuestDisplayId, setSelectedGuestDisplayId] = useState<number | null>(null);
  const [galleryEventFilter, setGalleryEventFilter] = useState('all');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [activePhoto, setActivePhoto] = useState<PhotoRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const lastPhotoButton = useRef<HTMLButtonElement | null>(null);
  const modalCloseButton = useRef<HTMLButtonElement | null>(null);
  const [exportingId, setExportingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [hasMorePhotos, setHasMorePhotos] = useState(false);
  const [license, setLicense] = useState<LicenseSnapshot | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(true);
  const [licenseKey, setLicenseKey] = useState('');
  const [activatingLicense, setActivatingLicense] = useState(false);
  const [claimingFreeLicense, setClaimingFreeLicense] = useState(false);
  const [deactivatingLicense, setDeactivatingLicense] = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [licensePlans, setLicensePlans] = useState<Plan[]>([]);
  const [licensePlansLoading, setLicensePlansLoading] = useState(false);
  const settings = status?.settings;
  const th = settings?.language !== 'en';
  async function refreshEventData() { setEventData(await window.koko.listEvents()); }
  async function openGuestDisplay() {
    try {
      const displays = await window.koko.listDisplays();
      const guestDisplays = displays.filter(item => !item.current);
      setAvailableGuestDisplays(guestDisplays);
      const display = guestDisplays.find(item => item.id === selectedGuestDisplayId) ?? guestDisplays[0];
      if (!display) { setMessage(th ? 'เชื่อมต่อจอที่สองก่อนเปิดหน้าจอแขก' : 'Connect a second display before opening the guest screen.'); return; }
      await window.koko.openGuestDisplay(display.id);
      setGuestDisplayActive(true);
      setMessage(th ? `เปิดหน้าจอแขกบน ${display.label} แล้ว` : `Guest display opened on ${display.label}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : (th ? 'เปิดหน้าจอแขกไม่สำเร็จ' : 'Could not open the guest display.')); }
  }
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void window.koko.listDisplays().then(displays => {
        if (!mounted) return;
        const guestDisplays = displays.filter(item => !item.current);
        setAvailableGuestDisplays(guestDisplays);
        setSelectedGuestDisplayId(current => current !== null && guestDisplays.some(item => item.id === current) ? current : guestDisplays[0]?.id ?? null);
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void window.koko.isGuestDisplayOpen().then(open => { if (mounted) setGuestDisplayActive(open); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { window.koko.getStatus().then(next => { setStatus(next); if (next.guestModeActive) { setPage('studio'); setMode('guest'); } }).catch(() => setMessage('Unable to load app status')); }, []);
  useEffect(() => window.koko.onOperatorAccessRequest(() => { setPage('studio'); setMode('guest'); requestGuestExit(); }), []);
  useEffect(() => { window.koko.getPhotoStorageStatus().then(setPhotoStorage).catch(() => setMessage('Unable to load photo storage status')); }, []);
  useEffect(() => window.koko.onCameraFolderPhotoImport(({ fileName, photo }) => {
    setMessage(th ? `นำเข้าภาพจากกล้องแล้ว: ${fileName}` : `Camera photo imported: ${fileName}`);
    if (page === 'gallery' || page === 'studio' || page === 'templates' || page === 'printing') {
      const limit = page === 'studio' ? 6 : 100;
      const eventId = page === 'gallery' ? (galleryEventFilter === 'all' ? undefined : galleryEventFilter === 'unassigned' ? null : galleryEventFilter) : undefined;
      void window.koko.listPhotos(0, limit, eventId).then(result => { setPhotos(result); setHasMorePhotos(page === 'gallery' && result.length === limit); }).catch(() => undefined);
    } else if (photo.eventId === eventData.activeEventId) setPhotos(current => [photo, ...current.filter(item => item.id !== photo.id)]);
  }), [page, galleryEventFilter, eventData.activeEventId, th]);
  useEffect(() => { void refreshEventData().catch(() => setMessage('Could not load local events')); }, []);
  useEffect(() => {
    if (page !== 'sessions') return;
    let mounted = true;
    window.koko.listCaptureSessions(100, 0).then(items => { if (mounted) { setCaptureSessions(items); setSessionsHasMore(items.length === 100); } })
      .catch(() => { if (mounted) setMessage(th ? 'โหลดประวัติรอบถ่ายไม่สำเร็จ' : 'Could not load capture sessions.'); });
    return () => { mounted = false; };
  }, [page, th]);
  useEffect(() => { cameraManager.enumerateDevices().then(() => setCameraState(cameraManager.getStatus())).catch(() => setCameraState('error')); }, []);
  useEffect(() => {
    let mounted = true;
    window.koko.getLicenseStatus().then(value => { if (mounted) setLicense(value); })
      .catch(() => { if (mounted) setLicense({ state: 'server_error', checkedAt: null, expiresAt: null, offlineUntil: null, features: [] }); })
      .finally(() => { if (mounted) setLicenseLoading(false); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (page !== 'account') return;
    let mounted = true;
    setLicensePlansLoading(true);
    window.koko.getLicensePlans().then(value => { if (mounted) setLicensePlans(value); })
      .catch(() => { if (mounted) setLicensePlans([]); })
      .finally(() => { if (mounted) setLicensePlansLoading(false); });
    return () => { mounted = false; };
  }, [page]);
  useEffect(() => {
    if (page !== 'gallery' && page !== 'studio' && page !== 'templates' && page !== 'printing') return;
    const limit = page === 'studio' ? 6 : 100;
    const eventId = page === 'studio' ? eventData.activeEventId : page === 'gallery' ? (galleryEventFilter === 'all' ? undefined : galleryEventFilter === 'unassigned' ? null : galleryEventFilter) : undefined;
    let mounted = true;
    setLibraryLoading(true);
    setLibraryError('');
    window.koko.listPhotos(0, limit, eventId).then(result => {
      if (!mounted) return;
      setPhotos(result);
      setHasMorePhotos(page === 'gallery' && result.length === limit);
    }).catch(() => { if (mounted) setLibraryError(th ? 'เปิดคลังภาพไม่สำเร็จ โปรดตรวจสอบโฟลเดอร์จัดเก็บ' : 'Could not load photos. Check the configured storage folder.'); })
      .finally(() => { if (mounted) setLibraryLoading(false); });
    return () => { mounted = false; };
  }, [page, th, eventData.activeEventId, galleryEventFilter]);
  useEffect(() => {
    if (page !== 'gallery' || !photoStorage?.configured) return;
    let mounted = true;
    setRecoveryLoading(true);
    window.koko.inspectPhotoRecovery().then(items => { if (mounted) setRecoveryIssues(items); })
      .catch(() => { if (mounted) setRecoveryIssues([{ kind: 'storage-unavailable', id: null }]); })
      .finally(() => { if (mounted) setRecoveryLoading(false); });
    return () => { mounted = false; };
  }, [page, photoStorage?.configured]);
  useEffect(() => {
    if (!activePhoto) { setPreviewUrl(''); setPreviewError(''); return; }
    let mounted = true;
    let objectUrl = '';
    setPreviewError('');
    requestAnimationFrame(() => modalCloseButton.current?.focus());
    window.koko.readPhoto(activePhoto.id).then(result => {
      if (!mounted) return;
      const jpeg = Uint8Array.from(result.jpegBytes);
      objectUrl = URL.createObjectURL(new Blob([jpeg.buffer], { type: 'image/jpeg' }));
      setPreviewUrl(objectUrl);
    }).catch(() => { if (mounted) setPreviewError(th ? 'เปิดภาพนี้ไม่ได้ ไฟล์อาจหายหรือข้อมูลไม่ตรงกับดัชนี' : 'This photo could not be opened. The file may be missing or damaged.'); });
    return () => { mounted = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [activePhoto, th]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (mode === 'guest') {
          event.preventDefault(); event.stopPropagation();
          if (exitPromptOpen) { setExitPromptOpen(false); setExitPinInput(''); setExitPinError(''); }
          else requestGuestExit();
          return;
        }
        if (activePhoto) { setActivePhoto(null); requestAnimationFrame(() => lastPhotoButton.current?.focus()); return; }
        return;
      }
      if (page === 'studio' && event.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((event.target as HTMLElement).tagName)) {
        event.preventDefault(); document.querySelector<HTMLButtonElement>('.capture-button')?.click();
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [activePhoto, mode, page, exitPromptOpen]);
  useEffect(() => { if (exitPromptOpen) requestAnimationFrame(() => exitPinInputRef.current?.focus()); }, [exitPromptOpen]);
  function requestGuestExit() { setExitPromptOpen(true); setExitPinInput(''); setExitPinError(''); }
  async function confirmGuestExit() {
    if (verifyingExitPin || exitPinInput.length < 4) return;
    setVerifyingExitPin(true); setExitPinError('');
    try {
      const accepted = await window.koko.verifyGuestExitPin(exitPinInput);
      if (!accepted) { setExitPinError(th ? 'PIN ไม่ถูกต้อง หรือถูกพักชั่วคราว' : 'Incorrect PIN or temporarily locked.'); return; }
      await window.koko.setGuestModeActive(false);
      setExitPromptOpen(false); setExitPinInput(''); setMode('operator'); await window.koko.setFullscreen(false);
    } catch { setExitPinError(th ? 'ตรวจสอบ PIN ไม่สำเร็จ โปรดลองอีกครั้ง' : 'Could not verify the PIN. Try again.'); }
    finally { setVerifyingExitPin(false); }
  }
  async function update(next: Settings) {
    try { const saved = await window.koko.saveSettings(next); setStatus(old => old && { ...old, settings: saved }); setMessage(th ? 'บันทึกการตั้งค่าแล้ว' : 'Settings saved'); }
    catch { setMessage(th ? 'บันทึกการตั้งค่าไม่สำเร็จ' : 'Could not save settings'); }
  }
  async function choosePhotoStorage() {
    setChoosingStorage(true);
    try {
      const next = await window.koko.choosePhotoStorage();
      setPhotoStorage(next);
      setMessage(next.configured ? (th ? 'ตั้งค่าโฟลเดอร์เก็บภาพแล้ว' : 'Photo storage folder is ready') : (th ? 'ยกเลิกการเลือกโฟลเดอร์' : 'Folder selection cancelled'));
    } catch { setMessage(th ? 'ตั้งค่าโฟลเดอร์ไม่สำเร็จ โปรดตรวจสอบสิทธิ์และพื้นที่ว่าง' : 'Could not configure this folder. Check access and free space.'); }
    finally { setChoosingStorage(false); }
  }
  async function openPhotoStorageFolder() {
    try {
      if (!photoStorage?.configured) { go('settings'); setMessage(th ? 'เลือกโฟลเดอร์เก็บภาพก่อน' : 'Choose a photo folder first'); return; }
      await window.koko.openPhotoStorage();
    } catch { setMessage(th ? 'เปิดโฟลเดอร์ภาพไม่สำเร็จ' : 'Could not open the photo folder'); }
  }
  async function exportPhoto(photo: PhotoRecord) {
    setExportingId(photo.id);
    try {
      const exported = await window.koko.exportPhoto(photo.id);
      if (exported) setMessage(th ? 'ส่งออกภาพแล้ว' : 'Photo exported');
    } catch { setMessage(th ? 'ส่งออกภาพไม่สำเร็จ โปรดลองอีกครั้ง' : 'Could not export the photo. Try again.'); }
    finally { setExportingId(''); }
  }
  async function loadMorePhotos() {
    setLibraryLoading(true);
    try {
      const selectedEvent = galleryEventFilter === 'all' ? undefined : galleryEventFilter === 'unassigned' ? null : galleryEventFilter;
      const next = await window.koko.listPhotos(photos.length, 100, selectedEvent);
      setPhotos(old => [...old, ...next]);
      setHasMorePhotos(next.length === 100);
    } catch { setLibraryError(th ? 'โหลดภาพเพิ่มเติมไม่สำเร็จ' : 'Could not load more photos.'); }
    finally { setLibraryLoading(false); }
  }
  async function loadMoreSessions() {
    if (sessionsLoadingMore || !sessionsHasMore) return;
    setSessionsLoadingMore(true);
    try {
      const next = await window.koko.listCaptureSessions(100, captureSessions.length);
      setCaptureSessions(current => {
        const known = new Set(current.map(item => item.id));
        return [...current, ...next.filter(item => !known.has(item.id))];
      });
      setSessionsHasMore(next.length === 100);
    } catch { setMessage(th ? 'โหลดประวัติเพิ่มเติมไม่สำเร็จ' : 'Could not load more capture sessions.'); }
    finally { setSessionsLoadingMore(false); }
  }
  async function importRecoveredPhoto(id: string) {
    setRecoveringPhotoId(id);
    try {
      const imported = await window.koko.importRecoveredPhoto(id);
      if (!imported) return;
      const filter = galleryEventFilter === 'all' ? undefined : galleryEventFilter === 'unassigned' ? null : galleryEventFilter;
      const [items, storage, latest] = await Promise.all([
        window.koko.inspectPhotoRecovery(), window.koko.getPhotoStorageStatus(), window.koko.listPhotos(0, 100, filter)
      ]);
      setRecoveryIssues(items); setPhotoStorage(storage); setPhotos(latest); setHasMorePhotos(latest.length === 100);
      setMessage(th ? 'นำภาพเข้าคลังแล้ว โดยไม่ผูกกับ Event' : 'Recovered photo imported without an event assignment.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (th ? 'กู้คืนภาพไม่สำเร็จ' : 'Could not import the recovered photo.'));
    } finally { setRecoveringPhotoId(''); }
  }
  async function quarantineRecoveryItem(kind: 'incomplete-write' | 'index-temp', token: string) {
    setRecoveringPhotoId(token);
    try {
      const moved = await window.koko.quarantineRecoveryItem(kind, token);
      if (!moved) return;
      const [items, storage] = await Promise.all([window.koko.inspectPhotoRecovery(), window.koko.getPhotoStorageStatus()]);
      setRecoveryIssues(items); setPhotoStorage(storage);
      setMessage(th ? 'ย้ายไฟล์ไป recovery-quarantine แล้ว โดยเก็บไฟล์ไว้' : 'Temporary file moved to recovery-quarantine and preserved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (th ? 'ย้ายไฟล์ไปกักกันไม่สำเร็จ' : 'Could not quarantine the file.'));
    } finally { setRecoveringPhotoId(''); }
  }
  async function rebuildPhotoIndex() {
    setRecoveringPhotoId('rebuild-index');
    try {
      const count = await window.koko.rebuildPhotoIndex();
      if (count === null) return;
      const filter = galleryEventFilter === 'all' ? undefined : galleryEventFilter === 'unassigned' ? null : galleryEventFilter;
      const [items, storage, latest, events] = await Promise.all([
        window.koko.inspectPhotoRecovery(), window.koko.getPhotoStorageStatus(), window.koko.listPhotos(0, 100, filter), window.koko.listEvents()
      ]);
      setRecoveryIssues(items); setPhotoStorage(storage); setPhotos(latest); setHasMorePhotos(latest.length === 100); setEventData(events);
      setMessage(th ? `สร้างดัชนีใหม่แล้ว กู้คืน ${count} ภาพโดยไม่ผูก Event` : `Index rebuilt. Recovered ${count} photo(s) without event assignments.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (th ? 'สร้างดัชนีคลังภาพใหม่ไม่สำเร็จ' : 'Could not rebuild the photo library index.'));
    } finally { setRecoveringPhotoId(''); }
  }
  async function handleCaptureSaved(photo: SavedPhoto) {
    setMessage(th ? 'บันทึกภาพสำเร็จ' : 'Photo saved successfully');
    setPhotoStorage(await window.koko.getPhotoStorageStatus());
    const latest = await window.koko.listPhotos(0, 6, eventData.activeEventId);
    setPhotos(latest);
    void refreshEventData().catch(() => setMessage(th ? 'บันทึกภาพแล้ว แต่โหลดข้อมูล Event ไม่สำเร็จ' : 'Photo saved, but event counts could not be refreshed.'));
    if (!latest.some(item => item.id === photo.id)) setMessage(th ? 'บันทึกภาพแล้ว แต่โหลดตัวอย่างภาพไม่สำเร็จ' : 'Photo saved, but its preview could not be loaded.');
  }
  async function deletePhoto(photo: PhotoRecord) {
    setDeletingId(photo.id);
    try {
      const removed = await window.koko.deletePhoto(photo.id);
      if (!removed) return;
      setPhotos(current => current.filter(item => item.id !== photo.id));
      setPhotoStorage(await window.koko.getPhotoStorageStatus());
      void refreshEventData().catch(() => undefined);
      setActivePhoto(null);
      setMessage(th ? 'ย้ายภาพไปถังขยะแล้ว' : 'Photo moved to system Trash');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (th ? 'ย้ายภาพไปถังขยะไม่สำเร็จ' : 'Could not move this photo to Trash'));
    } finally { setDeletingId(''); }
  }
  async function activateLicense() {
    setActivatingLicense(true);
    setLicenseError('');
    try {
      const result = await window.koko.activateLicense(licenseKey);
      setLicense(result);
      setLicenseKey('');
    } catch (error) {
      setLicenseError(error instanceof Error ? error.message : (th ? 'เปิดใช้ License ไม่สำเร็จ' : 'License activation failed'));
    } finally { setActivatingLicense(false); }
  }
  async function claimFreeLicense() {
    setClaimingFreeLicense(true);
    setLicenseError('');
    try {
      const result = await window.koko.claimFreeLicense();
      setLicense(result);
    } catch (error) {
      setLicenseError(error instanceof Error ? error.message : (th ? 'รับสิทธิ์ Free ไม่สำเร็จ' : 'Could not claim the Free license'));
    } finally { setClaimingFreeLicense(false); }
  }
  async function deactivateLicense() {
    setDeactivatingLicense(true);
    setLicenseError('');
    try {
      await window.koko.deactivateLicense();
      setLicense(await window.koko.getLicenseStatus());
      setMessage(th ? 'ยกเลิกการผูกอุปกรณ์กับ License แล้ว' : 'This device was deactivated from the license');
    } catch (error) {
      setLicenseError(error instanceof Error ? error.message : (th ? 'ยกเลิกอุปกรณ์ไม่สำเร็จ' : 'Could not deactivate this device'));
    } finally { setDeactivatingLicense(false); }
  }
  function closePhotoPreview() {
    setActivePhoto(null);
    requestAnimationFrame(() => lastPhotoButton.current?.focus());
  }
  async function guest() {
    if (!status?.guestExitPinConfigured) {
      setMessage(th ? 'ตั้ง PIN ออกจากโหมดแขกก่อนเริ่มใช้งาน' : 'Set a Guest mode exit PIN before starting.');
      go('settings');
      return;
    }
    if (licenseLoading || (license?.state !== 'active' && license?.state !== 'offline_grace') || !license.features.includes('capture')) {
      setMessage(th ? 'ต้องตรวจสอบ License ก่อนเริ่มโหมดแขก' : 'Verify the capture license before starting Guest mode.');
      go('account');
      return;
    }
    if (!photoStorage?.configured) {
      setMessage(th ? 'เลือกโฟลเดอร์เก็บภาพก่อนเริ่มโหมดแขก' : 'Choose a photo storage folder before starting Guest mode.');
      go('settings');
      return;
    }
    try { await window.koko.setGuestModeActive(true); }
    catch { setMessage(th ? 'เปิดโหมดแขกไม่สำเร็จ' : 'Could not enter Guest mode.'); return; }
    setPage('studio');
    setMode('guest');
    await window.koko.setFullscreen(true);
  }
  async function handleVideoSaved(_video: SavedVideo) {
    setMessage(th ? 'บันทึกวิดีโอลงเครื่องแล้ว' : 'Video saved to this computer');
    if (page === 'sessions') {
      const sessions = await window.koko.listCaptureSessions(100, 0);
      setCaptureSessions(sessions); setSessionsHasMore(sessions.length === 100);
    }
  }
  const navItems = [
    { id: 'events', group: 'prepare', icon: 'calendar', th: 'อีเวนต์', en: 'Events' },
    { id: 'templates', group: 'prepare', icon: 'template', th: 'เทมเพลต', en: 'Templates' },
    { id: 'printing', group: 'prepare', icon: 'printer', th: 'การพิมพ์', en: 'Print' },
    { id: 'guest-preview', group: 'prepare', icon: 'monitor', th: 'จอแขก', en: 'Guest view' },
    { id: 'studio', group: 'run', icon: 'camera', th: 'ถ่ายภาพ', en: 'Capture' },
    { id: 'sessions', group: 'deliver', icon: 'calendar', th: 'รอบถ่าย', en: 'Sessions' },
    { id: 'gallery', group: 'deliver', icon: 'image', th: 'แกลเลอรี', en: 'Gallery' },
    { id: 'settings', group: 'system', icon: 'settings', th: 'ตั้งค่า', en: 'Settings' }
  ] as const;
  const navGroups = [
    { id: 'prepare', th: 'เตรียมงาน', en: 'PREPARE' },
    { id: 'run', th: 'ถ่ายภาพ', en: 'CAPTURE' },
    { id: 'deliver', th: 'ส่งมอบ', en: 'DELIVER' },
    { id: 'system', th: 'ระบบ', en: 'SYSTEM' }
  ] as const;
  const title = navItems.find(item => item.id === page);
  const go = (next: string) => { setPage(next); setMode('operator'); };
  const activeEvent = eventData.events.find(item => item.id === eventData.activeEventId) ?? null;
  const readinessItems: ReadinessItem[] = [
    { title: th ? 'งานอีเวนต์' : 'Event', detail: activeEvent ? activeEvent.name : (th ? 'เลือกหรือสร้างงานก่อนเริ่มรอบถ่าย' : 'Choose or create an event for this session.'), state: activeEvent ? 'ready' : 'todo', action: activeEvent ? (th ? 'เปลี่ยนงาน' : 'Change event') : (th ? 'เลือกงาน' : 'Choose event'), onClick: () => go('events') },
    { title: th ? 'กล้อง' : 'Camera', detail: cameraReadinessText(cameraState, th), state: cameraState === 'ready' ? 'ready' : 'todo', action: th ? 'ตรวจสอบ' : 'Check camera', onClick: () => { setDeviceDiagnostics(true); go('settings'); } },
    { title: th ? 'พื้นที่เก็บภาพ' : 'Photo storage', detail: photoStorage?.configured ? (photoStorage.directoryName ?? (th ? 'ตั้งค่าแล้ว' : 'Configured')) : (th ? 'เลือกโฟลเดอร์ปลายทางในเครื่อง' : 'Choose a local destination folder.'), state: photoStorage?.configured ? 'ready' : 'todo', action: photoStorage?.configured ? (th ? 'ดูการตั้งค่า' : 'Review') : (th ? 'ตั้งค่า' : 'Set up'), onClick: () => go('settings') },
    { title: th ? 'เทมเพลต KOKO' : 'KOKO template', detail: guestTemplate ? guestTemplate.name : (th ? 'เลือกกรอบและรูปแบบสำหรับงานนี้' : 'Choose the frame and layout for this event.'), state: guestTemplate ? 'ready' : 'todo', action: guestTemplate ? (th ? 'แก้ไข' : 'Edit') : (th ? 'เลือกเทมเพลต' : 'Choose template'), onClick: () => go('templates') },
    { title: th ? 'อัลบั้มและ QR' : 'Album & QR', detail: license?.state === 'active' ? (th ? 'License พร้อมสร้างลิงก์หลังอัปโหลดจบรอบ' : 'License is active; the link is created after upload.') : (th ? 'ต้องเชื่อมต่อ License ก่อนอัปโหลดอัลบั้ม' : 'An active license is needed to upload albums.'), state: license?.state === 'active' ? 'ready' : 'todo', action: license?.state === 'active' ? (th ? 'ดูบัญชี' : 'Account') : (th ? 'เชื่อม License' : 'Connect license'), onClick: () => go('account') },
    { title: th ? 'หน้าจอแขก' : 'Guest display', detail: guestDisplayActive ? (th ? 'กำลังแสดงบนจอที่สอง' : 'Showing on the second display.') : availableGuestDisplays.length ? (th ? 'พบจอที่สอง เปิดใช้ได้ตามต้องการ' : 'A second display is available when needed.') : (th ? 'ต่อจอที่สองเมื่ออยากแสดงภาพแยกให้แขก' : 'Connect a second screen when you want a separate guest view.'), state: guestDisplayActive ? 'ready' : 'optional', action: guestDisplayActive ? (th ? 'เปิดจออีกครั้ง' : 'Focus display') : (th ? 'เปิดจอแขก' : 'Open display'), onClick: () => void openGuestDisplay() },
    { title: th ? 'จัดภาพและพิมพ์' : 'Compose & print', detail: (th ? 'เลือกภาพ จัดวาง แล้วพิมพ์ · ' : 'Arrange photos, then print. ') + (th ? printerReadiness(printerCount).detail.th : printerReadiness(printerCount).detail.en), state: printerReadiness(printerCount).state, action: th ? 'เปิดการพิมพ์' : 'Print setup', onClick: () => go('printing') }
  ];
  const requiredFeature = page === 'studio' ? 'capture' : page === 'printing' ? 'printing' : null;
  const hasRequiredFeature = requiredFeature !== null && license?.features.includes(requiredFeature);
  const gated = requiredFeature !== null && (licenseLoading || (license?.state !== 'active' && license?.state !== 'offline_grace') || !hasRequiredFeature);
  const diagnostics = page === 'settings' && deviceDiagnostics;
  const statusLabel: Record<CameraStatus, string> = { searching: th ? 'กำลังตรวจสอบ' : 'Checking', detected: th ? 'พบกล้อง' : 'Camera found', 'not-found': th ? 'ไม่พบกล้อง' : 'No camera', connecting: th ? 'กำลังเชื่อมต่อ' : 'Connecting', ready: th ? 'พร้อมใช้งาน' : 'Ready', 'permission-denied': th ? 'ต้องอนุญาตใช้กล้อง' : 'Permission needed', busy: th ? 'กล้องกำลังถูกใช้งาน' : 'Camera is in use', disconnected: th ? 'กล้องหลุดการเชื่อมต่อ' : 'Disconnected', error: th ? 'ตรวจสอบกล้อง' : 'Needs attention' };
  const pageName = page === 'studio' ? 'Capture Studio' : page === 'dashboard' ? (th ? 'แดชบอร์ด' : 'Dashboard') : page === 'account' ? (th ? 'บัญชีและ License' : 'Account & License') : title ? (th ? title.th : title.en) : (th ? 'ศูนย์ช่วยเหลือ' : 'Help Center');
  return <div lang={th ? 'th' : 'en'} className={`${settings?.highContrast ? 'app contrast' : 'app'} ${page === 'studio' ? 'is-studio' : ''} ${window.koko.isMacOS ? 'macos' : ''}`}>
    {mode === 'operator' ? <div className="shell">
      <aside className="sidebar"><button className="brand brand-button" onClick={() => go('dashboard')} aria-label="KOKO Studio Dashboard"><img className="brand-symbol" src="./koko-studio-mark.png" alt="" /><span className="brand-lockup"><span className="brand-wordmark" lang="en">KOKO</span><small>STUDIO / PHOTOBOOTH</small></span></button>
        <nav aria-label="Main navigation">{navGroups.map(group => <div className="nav-group" key={group.id}><p className="side-label">{th ? group.th : group.en}</p>{navItems.filter(item => item.group === group.id).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => go(item.id)} title={th ? item.th : item.en}><span className="nav-icon"><Icon name={item.icon} size={18} /></span><span>{th ? item.th : item.en}</span></button>)}</div>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-license"><span className={`license-dot ${license?.state === 'active' || license?.state === 'offline_grace' ? 'good' : ''}`} /><span>{licenseLoading ? (th ? 'กำลังตรวจสอบ License' : 'Checking license') : license?.state === 'active' ? (th ? 'License ใช้งานได้' : 'License active') : license?.state === 'offline_grace' ? 'Offline grace' : (th ? 'License ไม่ได้เชื่อมต่อ' : 'License not active')}</span></div><button className={`sidebar-account ${page === 'account' ? 'active' : ''}`} onClick={() => go('account')} title={th ? 'บัญชีและ License' : 'Account & License'}><span className="nav-icon"><Icon name="user" size={17} /></span><span>{th ? 'บัญชีและ License' : 'Account & License'}</span><Icon name="chevron" size={14} /></button><div className="edition-meta"><span>{license?.state === 'active' ? 'LICENSED EDITION' : 'DESKTOP EDITION'}</span><small>v{status?.version ?? '…'}</small></div></div>
      </aside>
      <div className="workspace"><header className="topbar"><div className="topbar-title"><span className="crumb">KOKO</span><span className="crumb-sep">/</span><span>{pageName}</span></div><div className="topbar-actions"><span className={`camera-top-status ${cameraState === 'ready' ? 'good' : ''}`}><i />{cameraState === 'ready' ? 'LIVE' : statusLabel[cameraState]}</span><button className="topbar-settings" onClick={() => go('settings')} title={th ? 'ตั้งค่า' : 'Settings'} aria-label={th ? 'ตั้งค่า' : 'Settings'}><Icon name="settings" size={18} /></button><button className="topbar-account" onClick={() => go('account')}><Icon name="user" size={17} />{th ? 'บัญชี' : 'Account'}</button><span className={`license-chip ${license?.state === 'active' || license?.state === 'offline_grace' ? 'is-active' : ''}`}><span />{licenseLoading ? (th ? 'กำลังตรวจสอบ' : 'Checking') : license?.state === 'active' ? 'ACTIVE' : license?.state === 'offline_grace' ? 'OFFLINE GRACE' : license?.state === 'expired' ? 'EXPIRED' : license?.state === 'revoked' ? 'REVOKED' : license?.state === 'device_limit' ? 'DEVICE LIMIT' : 'UNLICENSED'}</span></div></header>
        <main className={`page-content ${page === 'studio' ? 'studio-page' : ''}`}><UpdateBanner th={th} />{page === 'dashboard' ? <>
          <div className="welcome-row"><div><p className="eyebrow">{th ? 'ยินดีต้อนรับสู่ KOKO' : 'WELCOME TO KOKO'}</p><h1>{th ? 'พร้อมสร้างช่วงเวลาพิเศษหรือยัง?' : 'Ready to make something memorable?'}</h1><p className="lead">{th ? 'ตั้งค่าพื้นฐานให้พร้อม แล้วเริ่มต้นเซสชันถ่ายภาพของคุณ' : 'Get your setup ready and start a new photo session.'}</p></div><div className="welcome-actions"><button className="camera-secondary" onClick={() => void guest()}>{th ? 'เริ่มโหมดแขก' : 'Start Guest mode'}</button><button className="primary start-button" onClick={() => go('studio')}><span>＋</span>{th ? 'เริ่มเซสชัน' : 'Start Session'}<span>→</span></button></div></div>
          <ReadinessChecklist items={readinessItems} th={th} />
          <section className="dashboard-cards"><article className="summary-card camera-summary"><div className="card-heading"><div><span className="card-icon pink">◎</span><span><small>{th ? 'สถานะอุปกรณ์' : 'DEVICE STATUS'}</small><h2>{th ? 'กล้อง' : 'Camera'}</h2></span></div><span className={`status-dot ${cameraState === 'ready' || cameraState === 'detected' ? 'good' : ''}`}>{statusLabel[cameraState]}</span></div><p>{cameraState === 'ready' ? (th ? 'กล้องพร้อมแล้ว ดูภาพตัวอย่างได้ในการตรวจสอบอุปกรณ์' : 'Camera is ready. Open diagnostics to preview it.') : (cameraState === 'detected' ? (th ? 'พบกล้องแล้ว เปิดการตรวจสอบอุปกรณ์เพื่อดูภาพตัวอย่างก่อนเริ่ม' : 'A camera was found. Open diagnostics to check its preview before you start.') : cameraState === 'searching' || cameraState === 'connecting' ? (th ? 'กำลังตรวจสอบกล้อง' : 'Checking for cameras…') : (cameraState === 'permission-denied' ? (th ? 'ระบบบล็อกการเข้าถึงกล้อง เปิดสิทธิ์กล้องให้แอปในการตั้งค่า Windows แล้วตรวจสอบอีกครั้ง' : 'Camera access is blocked. Allow camera access for this app in Windows settings, then check again.') : cameraState === 'busy' ? (th ? 'โปรแกรมอื่นกำลังใช้กล้องอยู่ ปิดโปรแกรมนั้นแล้วลองใหม่' : 'Another program is using the camera. Close it and try again.') : cameraState === 'disconnected' ? (th ? 'กล้องถูกถอดออก เสียบกล้องกลับแล้วตรวจสอบอุปกรณ์' : 'The camera was unplugged. Reconnect it, then open Device Diagnostics.') : cameraState === 'error' ? (th ? 'กล้องรายงานข้อผิดพลาด เปิดการตรวจสอบอุปกรณ์เพื่อดูรายละเอียด' : 'The camera reported an error. Open Device Diagnostics for details.') : (th ? 'เชื่อมต่อกล้องก่อนเริ่มใช้งาน' : 'Connect a camera before starting a session.')))}</p><button className="text-link" onClick={() => { setDeviceDiagnostics(true); go('settings'); }}>{th ? 'ตรวจสอบอุปกรณ์' : 'Device Diagnostics'} <span>→</span></button></article>
          <article className="summary-card license-summary"><div className="card-heading"><div><span className="card-icon violet">✦</span><span><small>{th ? 'บัญชีของคุณ' : 'YOUR ACCOUNT'}</small><h2>{th ? 'สถานะ License' : 'License status'}</h2></span></div><span className={`status-dot ${license?.state === 'active' ? 'good' : 'neutral'}`}>{licenseLoading ? (th ? 'กำลังตรวจสอบ' : 'Checking') : license?.state === 'active' ? (th ? 'ใช้งานได้' : 'Active') : license?.state === 'offline_grace' ? (th ? 'Offline Grace' : 'Offline grace') : license?.state === 'expired' ? (th ? 'หมดอายุ' : 'Expired') : license?.state === 'device_limit' ? (th ? 'เกินจำนวนเครื่อง' : 'Device limit') : license?.state === 'revoked' ? (th ? 'ถูกเพิกถอน' : 'Revoked') : (th ? 'ตรวจสอบไม่ได้' : 'Unverified')}</span></div><p>{license?.state === 'active' ? (th ? 'ตรวจสอบ License กับบริการแล้ว' : 'License was verified with the service.') : license?.state === 'offline_grace' ? (th ? `ใช้งานในเครื่องได้ถึง ${license.offlineUntil ?? '—'}` : `Local use allowed until ${license.offlineUntil ?? '—'}`) : (th ? 'ยังยืนยันสิทธิ์จากบริการ License ไม่ได้' : 'Entitlement cannot currently be verified by the licensing service.')}</p><button className="text-link" onClick={() => go('account')}>{th ? 'ดูบัญชีและ License' : 'Account & license'} <span>→</span></button></article>
          <article className="summary-card storage-summary"><div className="card-heading"><div><span className="card-icon blue">▧</span><span><small>{th ? 'จัดเก็บในเครื่อง' : 'LOCAL STORAGE'}</small><h2>{th ? 'คลังภาพ' : 'Photo library'}</h2></span></div><span className={`status-dot ${photoStorage?.configured ? 'good' : 'neutral'}`}>{photoStorage?.configured ? (th ? 'พร้อมใช้งาน' : 'Ready') : (th ? 'ตั้งค่าโฟลเดอร์' : 'Set up folder')}</span></div><p>{photoStorage?.configured ? (th ? `เก็บภาพ ${photoStorage.photoCount} ภาพใน ${photoStorage.directoryName}` : `${photoStorage.photoCount} photo(s) in ${photoStorage.directoryName}`) : (th ? 'ตั้งค่าโฟลเดอร์จัดเก็บก่อนเริ่มถ่ายภาพ' : 'Choose a storage folder before capturing photos.')}</p><button className="text-link" onClick={() => go('settings')}>{th ? 'ตั้งค่าพื้นที่จัดเก็บ' : 'Storage settings'} <span>→</span></button></article>
          <BoothStatusCard th={th} onOpenSettings={() => go('settings')} /></section>
        </> : gated ? <section className="gate-card"><div className="gate-symbol">K</div><p className="eyebrow">KOKO / {page === 'studio' ? 'CAPTURE STUDIO' : 'PRINTING'}</p><h1>{licenseLoading ? (th ? 'กำลังตรวจสอบ License' : 'Checking your license') : license?.state === 'expired' ? (th ? 'License หมดอายุแล้ว' : 'Your license has expired') : license?.state === 'revoked' ? (th ? 'License นี้ถูกเพิกถอน' : 'This license was revoked') : license?.state === 'device_limit' ? (th ? 'ใช้ License ครบจำนวนเครื่องแล้ว' : 'Device limit reached') : (th ? 'ต้องตรวจสอบ License ก่อนใช้งาน' : 'License verification required')}</h1><p className="lead">{licenseLoading ? (th ? 'กำลังตรวจสอบสิทธิ์กับบริการ License' : 'Verifying your entitlement with the licensing service.') : license?.state === 'expired' ? (th ? 'ต่ออายุ License เพื่อเริ่มเซสชันใหม่ ภาพเดิมยังอยู่ในคลังภาพและส่งออกได้' : 'Renew your license to start new sessions. Existing photos remain available in Gallery.') : license?.state === 'revoked' ? (th ? 'ติดต่อผู้ดูแลบัญชีหรือฝ่ายช่วยเหลือ ภาพที่บันทึกไว้ยังเปิดได้' : 'Contact your account administrator or support. Saved photos remain accessible.') : license?.state === 'device_limit' ? (th ? 'ปิดใช้งานอุปกรณ์อื่นในบัญชี หรือดูวิธีจัดการอุปกรณ์' : 'Deactivate another device on your account or review device management.') : (th ? 'ยังยืนยันสิทธิ์จาก License Server ไม่ได้ จึงปิดฟีเจอร์นี้ไว้' : 'Entitlement could not be verified by the license server, so this feature remains locked.')}</p><div className="inline-error"><span>●</span>{th ? `สถานะ: ${licenseLoading ? 'กำลังตรวจสอบ' : license?.state ?? 'server_error'}` : `Status: ${licenseLoading ? 'loading' : license?.state ?? 'server_error'}`}</div><button className="primary" onClick={() => go('account')}>{th ? 'ไปที่บัญชีและ License' : 'ไปที่บัญชีและ License'}</button>{!licenseLoading && <button className="text-link gate-secondary" onClick={() => go('gallery')}>{th ? 'เปิดคลังภาพและกู้คืน' : 'Open Gallery & recovery'} →</button>}</section>
        : page === 'studio' ? <><div className="studio-heading"><div><p className="eyebrow">KOKO / CAPTURE STUDIO</p><h1 lang="en">Capture Studio</h1><p className="studio-tagline">{th ? 'เก็บภาพช่วงเวลาที่มีความหมาย' : 'CAPTURE MORE THAN MEMORIES'}</p></div><span className={cameraState === 'ready' ? 'studio-live-state is-live' : 'studio-live-state'}><i />{cameraState === 'ready' ? 'LIVE' : statusLabel[cameraState]}</span></div><CameraPanel th={th} onStatus={setCameraState} onCapture={photo => void handleCaptureSaved(photo)} onVideoCapture={video => void handleVideoSaved(video)} storageReady={Boolean(photoStorage?.configured)} storageName={photoStorage?.directoryName} activeEventName={eventData.events.find(item => item.id === eventData.activeEventId)?.name ?? null} activeReceiptMessage={eventData.events.find(item => item.id === eventData.activeEventId)?.receiptMessage ?? null} photos={photos} onOpenPhoto={photo => setActivePhoto(photo)} onDeletePhoto={photo => void deletePhoto(photo)} onExportPhoto={photo => void exportPhoto(photo)} onOpenStorage={() => void openPhotoStorageFolder()} onOpenGallery={() => go('gallery')} onOpenPrint={() => go('printing')} onOpenGuestDisplay={() => void openGuestDisplay()} guestDisplayActive={guestDisplayActive} availableGuestDisplays={availableGuestDisplays} selectedGuestDisplayId={selectedGuestDisplayId} onSelectGuestDisplay={setSelectedGuestDisplayId} onOpenSettings={() => { setDeviceDiagnostics(true); go('settings'); }} /></>
        : page === 'settings' ? <><p className="eyebrow">KOKO / SETTINGS</p><h1>{diagnostics ? (th ? 'ตรวจสอบอุปกรณ์' : 'Device Diagnostics') : (th ? 'ตั้งค่าแอป' : 'App settings')}</h1><p className="lead">{diagnostics ? (th ? 'ตรวจสอบการเชื่อมต่อและภาพตัวอย่างกล้อง' : 'Check camera connectivity and preview.') : (th ? 'จัดการประสบการณ์และพื้นที่จัดเก็บบนอุปกรณ์นี้' : 'Manage your app experience and local storage.')}</p>{diagnostics ? <><button className="back-link" onClick={() => setDeviceDiagnostics(false)}>← {th ? 'กลับไปตั้งค่า' : 'Back to settings'}</button><CameraPanel th={th} onStatus={setCameraState} /></> : <><section className="settings"><label>{th ? 'ภาษา' : 'Language'}<select value={settings?.language ?? 'th'} onChange={e => settings && void update({ ...settings, language: e.target.value as 'th' | 'en' })}><option value="th">ไทย</option><option value="en">English</option></select></label><label className="switch"><span>{th ? 'ความคมชัดสูง' : 'High contrast'}<small>{th ? 'เพิ่มความชัดเมื่อใช้ในพื้นที่สว่าง' : 'Clearer display in bright venues'}</small></span><input type="checkbox" checked={settings?.highContrast ?? false} onChange={e => settings && void update({ ...settings, highContrast: e.target.checked })}/></label><label className="switch"><span>{th ? 'เปิดเต็มหน้าจอเมื่อเริ่มแอป' : 'Start in fullscreen'}<small>{th ? 'กด Esc เพื่อออกจากเต็มหน้าจอ' : 'Press Esc to exit fullscreen'}</small></span><input type="checkbox" checked={settings?.fullscreen ?? false} onChange={e => settings && void update({ ...settings, fullscreen: e.target.checked })}/></label></section><section className="storage-settings"><div><strong>{th ? 'โฟลเดอร์เก็บภาพ' : 'Photo storage folder'}</strong><p>{photoStorage?.configured ? (th ? 'เลือกแล้ว: ' + photoStorage.directoryName : 'Selected: ' + photoStorage.directoryName) : (th ? 'ยังไม่ได้เลือกโฟลเดอร์' : 'No folder selected')}</p>{photoStorage?.configured && <small>{th ? 'บันทึกแล้ว ' + photoStorage.photoCount + ' ภาพ' : photoStorage.photoCount + ' saved photo(s)'}{photoStorage.needsAttention && <span className="storage-warning">{th ? ' · ต้องตรวจสอบไฟล์กู้คืน ' + photoStorage.pendingRecovery + ' รายการ' : ' · Recovery needs attention (' + photoStorage.pendingRecovery + ')'}</span>}</small>}</div><button className="camera-secondary" onClick={() => void choosePhotoStorage()} disabled={choosingStorage}>{choosingStorage ? (th ? 'กำลังเลือก…' : 'Choosing…') : (th ? 'เลือกโฟลเดอร์' : 'Choose folder')}</button><p>{th ? 'ภาพจะไม่ถูกบันทึกจนกว่าจะเลือกโฟลเดอร์นี้' : 'Photos will not be saved until a folder is selected.'}</p></section><section className="diagnostics-link"><div><strong>{th ? 'การวินิจฉัยอุปกรณ์' : 'Device diagnostics'}</strong><p>{th ? 'ตรวจสอบกล้องและสิทธิ์การเข้าถึง' : 'Inspect cameras and device permissions.'}</p></div><button className="camera-secondary" onClick={() => { setDeviceDiagnostics(true); setMessage(''); }}> {th ? 'เปิดการวินิจฉัย' : 'Open diagnostics'} →</button></section>
          <details className="advanced-settings"><summary>{th ? 'ตั้งค่าขั้นสูง' : 'Advanced settings'}<small>{th ? 'PIN โหมดแขก · โฟลเดอร์ภาพจากกล้อง · KOKOMEMORY' : 'Guest PIN · camera export folder · KOKOMEMORY'}</small></summary>
          <GuestExitPinSettings th={th} configured={status?.guestExitPinConfigured ?? false} onConfigured={value => setStatus(old => old && { ...old, guestExitPinConfigured: value })} onMessage={setMessage} />
          <CameraFolderWatchSettings th={th} storageReady={Boolean(photoStorage?.configured)} onMessage={setMessage} />
          <ReceiptSettingsBlock th={th} event={eventData.events.find(item => item.id === eventData.activeEventId) ?? null} />
          <KokoMemorySettings th={th} onMessage={setMessage} /></details></>}</>
        : page === 'account' ? <><p className="eyebrow">KOKO / ACCOUNT</p><h1>{th ? 'บัญชีและ License' : 'Account & License'}</h1><p className="lead">{th ? 'รับสิทธิ์ Free สำหรับอุปกรณ์นี้ หรือเปิดใช้ License จากบริการของ KOKO' : 'Claim the Free plan for this device or activate a KOKO license.'}</p><section className="account-state"><div className="account-state-icon">◉</div><div><span className={`status-dot ${license?.state === 'active' ? 'good' : 'neutral'}`}>{licenseLoading ? (th ? 'กำลังตรวจสอบ' : 'Checking') : license?.state ?? 'server_error'}</span><h2>{license?.state === 'active' ? (th ? 'License ใช้งานได้' : 'License active') : license?.state === 'offline_grace' ? (th ? 'ใช้งานในช่วง Offline Grace' : 'Offline grace is active') : license?.state === 'expired' ? (th ? 'License หมดอายุ' : 'License expired') : license?.state === 'device_limit' ? (th ? 'ใช้ครบจำนวนเครื่องแล้ว' : 'Device limit reached') : license?.state === 'revoked' ? (th ? 'License ถูกเพิกถอน' : 'License revoked') : (th ? 'ยังยืนยันสิทธิ์ไม่ได้' : 'Entitlement is unverified')}</h2><p>{license?.state === 'active' || license?.state === 'offline_grace' ? (th ? `ฟีเจอร์ที่อนุญาต: ${license.features.join(', ') || '—'}` : `Allowed features: ${license.features.join(', ') || '—'}`) : (th ? 'Capture Studio จะเปิดเมื่อ Main ตรวจลายเซ็นและสถานะจาก License Server แล้วเท่านั้น' : 'Capture Studio opens only after Electron Main verifies the server signed entitlement.')}</p><p className="muted">{th ? `หมดอายุ: ${license?.expiresAt ?? 'ไม่ระบุ'} · ใช้ Offline ถึง: ${license?.offlineUntil ?? '—'}` : `Expires: ${license?.expiresAt ?? 'none'} · Offline until: ${license?.offlineUntil ?? '—'}`}</p></div></section><section className="activate-card free-plan-card"><h2>{th ? 'ใช้ฟรีบนอุปกรณ์นี้' : 'Use KOKO Free on this device'}</h2><p>{th ? 'ใช้งานถ่ายภาพ เทมเพลต และพิมพ์ในเครื่องได้ ไม่รวมอัลบั้มคลาวด์ จำนวน 1 อุปกรณ์' : 'Includes local capture, templates, and printing on one device. Cloud albums are not included.'}</p><button className="primary" type="button" onClick={() => void claimFreeLicense()} disabled={claimingFreeLicense || license?.state === 'active' || license?.state === 'offline_grace'}>{claimingFreeLicense ? (th ? 'กำลังรับสิทธิ์…' : 'Claiming…') : (th ? 'รับสิทธิ์ Free' : 'Claim Free license')}</button></section><AccountLinkCard th={th} canLink={license?.state === 'active'} onLinked={setLicense} /><section className="activate-card"><h2>{th ? 'เปิดใช้ License Key' : 'Activate a license key'}</h2><p>{th ? 'ระบบจะส่ง Key ไปตรวจสอบกับ License Server และรับ entitlement ที่ลงลายเซ็นจาก Server' : 'The key is verified by the License Server, which returns a signed entitlement.'}</p><form onSubmit={event => { event.preventDefault(); void activateLicense(); }}><label>{th ? 'License Key' : 'License key'}<input value={licenseKey} onChange={event => setLicenseKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={256} placeholder="KOKO-XXXX-XXXX-XXXX" /></label><button className="primary" type="submit" disabled={activatingLicense || licenseKey.trim().length < 8}>{activatingLicense ? (th ? 'กำลังตรวจสอบ…' : 'Verifying…') : (th ? 'ตรวจสอบและเปิดใช้' : 'Verify & activate')}</button></form>{licenseError && <p className="activation-error" role="alert">{licenseError}</p>}</section><section className="plan-state"><div><span className="card-icon violet">✦</span><h2>{th ? 'แผนการใช้งาน' : 'Available plans'}</h2><p>{licensePlansLoading ? (th ? 'กำลังโหลดแผนจาก License Server…' : 'Loading plans from License Server…') : licensePlans.length ? (th ? 'ราคาและสิทธิ์ต่ออายุจากการตั้งค่าฝั่ง Server' : 'Plan prices and entitlements are served by the backend.') : (th ? 'ขณะนี้โหลดแผนจาก License Server ไม่ได้' : 'Plans are currently unavailable from the License Server.')}</p>{licensePlans.map(plan => <p className="muted" key={plan.id}>{plan.name} · {(plan.amountMinor / 100).toLocaleString(th ? 'th-TH' : 'en-US', { style: 'currency', currency: plan.currency })} · {plan.deviceLimit} {th ? 'อุปกรณ์' : 'devices'}</p>)}</div><span className={`status-dot ${licensePlans.length ? 'good' : 'neutral'}`}>{licensePlansLoading ? (th ? 'กำลังโหลด' : 'Loading') : licensePlans.length ? (th ? 'จาก Server' : 'Server plans') : (th ? 'ไม่พร้อมใช้งาน' : 'Unavailable')}</span></section><div className="account-links"><button onClick={() => go('help')}>{th ? 'ศูนย์ช่วยเหลือ' : 'Help Center'} <span>→</span></button><button onClick={() => go('gallery')}>{th ? 'คลังภาพและการกู้คืน' : 'Photo access & recovery'} <span>→</span></button>{license?.state === 'active' && <button disabled={deactivatingLicense} onClick={() => void deactivateLicense()}>{deactivatingLicense ? (th ? 'กำลังยกเลิก…' : 'Deactivating…') : (th ? 'ยกเลิกการผูกอุปกรณ์นี้' : 'Deactivate this device')} <span>↗</span></button>}</div></>
        : page === 'help' ? <><p className="eyebrow">KOKO / HELP</p><h1>{th ? 'ศูนย์ช่วยเหลือ' : 'Help Center'}</h1><p className="lead">{th ? 'แนวทางช่วยเหลือในเครื่อง' : 'Local support information.'}</p><section className="account-state"><div className="account-state-icon">?</div><div><h2>{th ? 'ต้องการความช่วยเหลือ?' : 'Need help?'}</h2><p>{th ? 'ตรวจสอบกล้องและพื้นที่จัดเก็บได้ที่ ตั้งค่า > ตรวจสอบอุปกรณ์ และ ตั้งค่าแอป หากมีปัญหาให้บันทึกข้อความผิดพลาดที่เห็นไว้สำหรับทีมสนับสนุน' : 'Check your camera in Settings > Device Diagnostics and review your storage settings. Keep any error message for support.'}</p></div></section><ReportProblem th={th} /></>
        : page === 'gallery' ? <><p className="eyebrow">KOKO / GALLERY</p><div className="gallery-title-row"><div><h1>{th ? 'คลังภาพ' : 'Gallery'}</h1><p className="lead">{th ? 'ภาพที่บันทึกไว้ในเครื่องนี้ ใช้งานได้แม้ไม่มี License หรืออินเทอร์เน็ต' : 'Photos saved on this device remain available without a license or internet connection.'}</p></div><span className="gallery-count">{photos.length}{hasMorePhotos ? '+' : ''} {th ? 'ภาพ' : 'photos'}</span></div>
          <div className="gallery-event-filter"><label>{th ? 'แสดงภาพ' : 'Show photos'}<select value={galleryEventFilter} onChange={event => setGalleryEventFilter(event.target.value)}><option value="all">{th ? 'ทุก Event' : 'All photos'}</option><option value="unassigned">{th ? 'ยังไม่ผูก Event' : 'Unassigned'}</option>{eventData.events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{eventData.activeEventId && <span>{th ? 'Event ที่กำลังถ่าย' : 'Active capture event'}: {eventData.events.find(item => item.id === eventData.activeEventId)?.name}</span>}</div>{(photoStorage?.needsAttention || recoveryIssues.length > 0) && <div className="recovery-banner"><span>!</span><div className="recovery-copy"><strong>{th ? 'ต้องตรวจสอบพื้นที่จัดเก็บ' : 'Storage needs attention'}</strong><small>{th ? `พบรายการตรวจสอบ ${recoveryIssues.length || photoStorage?.pendingRecovery || 0} รายการ ภาพที่สมบูรณ์ยังเปิดและส่งออกได้` : `${recoveryIssues.length || photoStorage?.pendingRecovery || 0} item(s) need review. Verified photos remain available for viewing and export.`}</small>{showRecoveryDetails && <div className="recovery-details" aria-live="polite">{recoveryLoading ? <span>{th ? 'กำลังตรวจสอบ…' : 'Inspecting storage…'}</span> : recoveryIssues.length ? recoveryIssues.slice(0, 20).map((issue, index) => <div key={`${issue.kind}-${issue.id ?? index}`}><strong>{issue.kind === 'orphan-photo' ? (th ? 'พบ JPEG ที่ยังไม่อยู่ในคลัง' : 'Unindexed JPEG found') : issue.kind === 'incomplete-write' ? (th ? 'พบไฟล์เขียนไม่สมบูรณ์' : 'Incomplete photo write') : issue.kind === 'index-temp' ? (th ? 'พบไฟล์ดัชนีชั่วคราว' : 'Temporary index file') : issue.kind === 'missing-photo' ? (th ? 'ไม่พบไฟล์ของภาพในคลัง' : 'Library photo file is missing or has changed') : issue.kind === 'invalid-index' ? (th ? 'ดัชนีคลังภาพเสียหาย' : 'Photo index is invalid') : (th ? 'เปิดพื้นที่จัดเก็บไม่ได้' : 'Storage could not be inspected')}</strong>{issue.id && <code>{issue.id}</code>}{issue.kind === 'orphan-photo' && issue.id && <button type="button" onClick={() => void importRecoveredPhoto(issue.id!)} disabled={recoveringPhotoId === issue.id}>{recoveringPhotoId === issue.id ? (th ? 'กำลังตรวจ…' : 'Checking…') : (th ? 'ตรวจและนำเข้า' : 'Verify & import')}</button>}{(issue.kind === 'incomplete-write' || issue.kind === 'index-temp') && issue.token && <button type="button" onClick={() => void quarantineRecoveryItem(issue.kind as 'incomplete-write' | 'index-temp', issue.token!)} disabled={recoveringPhotoId === issue.token}>{recoveringPhotoId === issue.token ? (th ? 'กำลังย้าย…' : 'Moving…') : (th ? 'ย้ายไปกักกัน' : 'Quarantine')}</button>}{issue.kind === 'invalid-index' && <button type="button" onClick={() => void rebuildPhotoIndex()} disabled={recoveringPhotoId === 'rebuild-index'}>{recoveringPhotoId === 'rebuild-index' ? (th ? 'กำลังสร้าง…' : 'Rebuilding…') : (th ? 'ตรวจและสร้างดัชนีใหม่' : 'Verify & rebuild index')}</button>}</div>) : <span>{th ? 'ไม่พบรายการกู้คืนที่ต้องดำเนินการ' : 'No recovery items were found.'}</span>}{recoveryIssues.length > 20 && <span>{th ? `แสดง 20 จาก ${recoveryIssues.length} รายการ` : `Showing 20 of ${recoveryIssues.length} items`}</span>}<small>{th ? 'ดัชนีเดิมและไฟล์ชั่วคราวจะถูกเก็บใน recovery-quarantine ภาพที่กู้คืนจะไม่ผูก Event' : 'The original index and temporary files are preserved in recovery-quarantine. Rebuilt photos remain unassigned to events.'}</small></div>}</div><button onClick={() => setShowRecoveryDetails(value => !value)}>{showRecoveryDetails ? (th ? 'ซ่อน' : 'Hide') : (th ? 'ตรวจรายการ' : 'Inspect items')} {showRecoveryDetails ? '↑' : '→'}</button></div>}
          {libraryLoading && photos.length === 0 ? <section className="empty-state"><span className="loading-mark">◌</span><h2>{th ? 'กำลังโหลดคลังภาพ' : 'Loading your library'}</h2><p>{th ? 'กำลังตรวจสอบรายการภาพที่บันทึกไว้' : 'Checking your locally saved photos.'}</p></section> : libraryError ? <section className="empty-state error-state"><span>!</span><h2>{th ? 'เปิดคลังภาพไม่ได้' : 'Library unavailable'}</h2><p>{libraryError}</p><button className="camera-secondary" onClick={() => { setLibraryError(''); setPage('dashboard'); setTimeout(() => setPage('gallery'), 0); }}>{th ? 'ลองอีกครั้ง' : 'Try again'}</button></section> : photos.length === 0 ? <section className="empty-state"><span>▧</span><h2>{th ? 'ยังไม่มีภาพที่บันทึกไว้' : 'No saved photos yet'}</h2><p>{photoStorage?.configured ? (th ? 'ภาพที่บันทึกสำเร็จจะแสดงที่นี่ ภาพจะอยู่ในโฟลเดอร์จัดเก็บของคุณ' : 'Photos that are saved successfully will appear here and remain in your selected storage folder.') : (th ? 'เลือกโฟลเดอร์จัดเก็บเพื่อเตรียมพื้นที่สำหรับภาพของคุณ' : 'Choose a storage folder to prepare a place for your photos.')}</p><button className="camera-secondary" onClick={() => go('settings')}>{th ? 'ตั้งค่าพื้นที่จัดเก็บ' : 'Storage settings'} →</button></section> : <><div className="photo-grid">{photos.map(photo => <article className="photo-card" key={photo.id}><button className="photo-thumb" onClick={event => { lastPhotoButton.current = event.currentTarget; setActivePhoto(photo); }} aria-label={th ? 'เปิดดูภาพ' : 'Preview photo'}><PhotoThumb photo={photo} /><small>{photo.width} × {photo.height}</small></button><div className="photo-info"><strong>{new Date(photo.savedAt).toLocaleString(th ? 'th-TH' : 'en-US')}</strong><small>{(photo.byteLength / 1024 / 1024).toFixed(1)} MB · JPEG</small><button className="export-button" onClick={() => void exportPhoto(photo)} disabled={exportingId === photo.id}>{exportingId === photo.id ? (th ? 'กำลังส่งออก…' : 'Exporting…') : (th ? 'ส่งออกภาพ' : 'Export photo')} ↓</button></div></article>)}</div>{hasMorePhotos && <div className="load-more"><button className="camera-secondary" onClick={() => void loadMorePhotos()} disabled={libraryLoading}>{libraryLoading ? (th ? 'กำลังโหลด…' : 'Loading…') : (th ? 'โหลดภาพเพิ่มเติม' : 'Load more photos')}</button></div>}</>}
        </> : page === 'sessions' ? <CaptureSessionsPage sessions={captureSessions} th={th} onOpenPhoto={photo => setActivePhoto(photo)} onLoadMore={() => void loadMoreSessions()} hasMore={sessionsHasMore} loadingMore={sessionsLoadingMore} onRoundsChanged={() => void window.koko.listCaptureSessions(100, 0).then(items => { setCaptureSessions(items); setSessionsHasMore(items.length === 100); }).catch(() => undefined)} /> : page === 'events' ? <EventsPage events={eventData.events} activeEventId={eventData.activeEventId} onRefresh={refreshEventData} onMessage={setMessage} th={th} /> : page === 'templates' || page === 'printing' ? <TemplatesPage photos={photos} th={th} onMessage={setMessage} onUseTemplate={setGuestTemplate} printEnabled={page === 'printing'} /> : <><p className="eyebrow">KOKO / {page.toUpperCase()}</p><h1>{th ? 'หน้าจอแขก' : 'Guest preview'}</h1><GuestPreviewPage th={th} active={guestDisplayActive} displays={availableGuestDisplays} selectedDisplayId={selectedGuestDisplayId} onSelectDisplay={setSelectedGuestDisplayId} onOpenDisplay={() => void openGuestDisplay()} onCloseDisplay={() => void window.koko.closeGuestDisplay().then(() => setGuestDisplayActive(false))} onGuestMode={() => void guest()} /></>}
        </main>{activePhoto && <div className="photo-modal-backdrop" role="presentation" onClick={closePhotoPreview}><section className="photo-modal" role="dialog" aria-modal="true" aria-label={th ? 'ตัวอย่างภาพ' : 'Photo preview'} onClick={event => event.stopPropagation()}><button ref={modalCloseButton} className="modal-close" onClick={closePhotoPreview} aria-label={th ? 'ปิด' : 'Close'}>×</button>{previewError ? <div className="modal-error" role="alert">{previewError}</div> : previewUrl ? <img src={previewUrl} alt={th ? 'ภาพที่บันทึกไว้' : 'Saved photo'} /> : <div className="modal-loading">{th ? 'กำลังเปิดภาพ…' : 'Opening photo…'}</div>}<div className="modal-caption"><span>{activePhoto.width} × {activePhoto.height} · {new Date(activePhoto.savedAt).toLocaleString(th ? 'th-TH' : 'en-US')}</span><div className="modal-actions"><button className="camera-secondary" onClick={() => { setActivePhoto(null); go('studio'); }}>{th ? 'ถ่ายใหม่' : 'Retake'}</button><button className="camera-secondary delete-button" onClick={() => void deletePhoto(activePhoto)} disabled={deletingId === activePhoto.id}>{deletingId === activePhoto.id ? (th ? 'กำลังย้าย…' : 'Moving…') : (th ? 'ลบภาพ' : 'Delete')}</button><button className="primary" onClick={() => void exportPhoto(activePhoto)} disabled={deletingId === activePhoto.id || exportingId === activePhoto.id}>{exportingId === activePhoto.id ? (th ? 'กำลังส่งออก…' : 'Exporting…') : (th ? 'ส่งออกภาพ' : 'Export photo')} ↓</button></div></div></section></div>}<footer><span><i className="footer-indicator" />{th ? 'ทำงานในเครื่อง' : 'Running locally'}</span><span>{th ? `กล้อง: ${statusLabel[cameraState]} · v${status?.version ?? '…'}` : `Camera: ${statusLabel[cameraState]} · v${status?.version ?? '…'}`}</span></footer>
      </div>
    </div> : <main className="guest guest-capture"><header className="guest-toolbar"><div className="guest-brand-lockup"><img src="./koko-studio-mark.png" alt="" /><span><span className="brand-wordmark" lang="en">KOKO</span><span className="brand-subtitle">STUDIO / PHOTOBOOTH</span></span></div><button className="camera-secondary" onClick={requestGuestExit}>{th ? 'กลับไปหน้าควบคุม' : 'Back to controls'}</button></header><div className="guest-heading"><p className="eyebrow">{th ? 'โหมดถ่ายภาพ' : 'GUEST PHOTO SESSION'}</p><h1>{eventData.events.find(item => item.id === eventData.activeEventId)?.name ?? (th ? 'ช่วงเวลาของคุณ เริ่มที่นี่' : 'Your moment starts here')}</h1><p>{guestTemplate ? `${th ? 'เทมเพลต' : 'Template'}: ${guestTemplate.name} · ${guestTemplate.count} ${th ? 'ภาพต่อรอบ' : guestTemplate.count === 1 ? 'photo per round' : 'photos per round'}` : (th ? 'จัดภาพให้พร้อม แล้วกดถ่ายภาพเมื่อคุณพร้อม' : 'Get into position, then capture when you are ready.')}</p></div><CameraPanel th={th} guestMode guestTemplate={guestTemplate} guestDisplayActive={guestDisplayActive} availableGuestDisplays={availableGuestDisplays} selectedGuestDisplayId={selectedGuestDisplayId} onSelectGuestDisplay={setSelectedGuestDisplayId} onOpenGuestDisplay={() => void openGuestDisplay()} onStatus={setCameraState} onCapture={photo => void handleCaptureSaved(photo)} onVideoCapture={video => void handleVideoSaved(video)} storageReady={Boolean(photoStorage?.configured)} storageName={photoStorage?.directoryName} activeEventName={eventData.events.find(item => item.id === eventData.activeEventId)?.name ?? null} activeReceiptMessage={eventData.events.find(item => item.id === eventData.activeEventId)?.receiptMessage ?? null} photos={photos} onOpenPhoto={photo => setActivePhoto(photo)} onDeletePhoto={photo => void deletePhoto(photo)} onExportPhoto={photo => void exportPhoto(photo)} onOpenStorage={() => void openPhotoStorageFolder()} onOpenGallery={requestGuestExit} onOpenSettings={requestGuestExit} /></main>}
    {mode === 'guest' && exitPromptOpen && <div className="photo-modal-backdrop guest-exit-backdrop" role="presentation" onClick={() => { if (!verifyingExitPin) { setExitPromptOpen(false); setExitPinInput(''); setExitPinError(''); } }}><section className="photo-modal guest-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-exit-title" onClick={event => event.stopPropagation()}><div className="guest-exit-copy"><p className="eyebrow">KOKO / OPERATOR ACCESS</p><h2 id="guest-exit-title">{th ? 'กลับไปหน้าควบคุม' : 'Return to operator controls'}</h2><p>{th ? 'ใส่ PIN ผู้ดูแลเพื่อออกจากโหมดแขก' : 'Enter the operator PIN to leave Guest mode.'}</p><form onSubmit={event => { event.preventDefault(); void confirmGuestExit(); }}><label>{th ? 'PIN ผู้ดูแล' : 'Operator PIN'}<input ref={exitPinInputRef} type="password" inputMode="numeric" autoComplete="current-password" maxLength={12} value={exitPinInput} onChange={event => { setExitPinInput(event.target.value.replace(/\D/g, '')); setExitPinError(''); }} /></label>{exitPinError && <p className="guest-exit-error" role="alert">{exitPinError}</p>}<div className="guest-pin-actions"><button className="camera-secondary" type="button" disabled={verifyingExitPin} onClick={() => { setExitPromptOpen(false); setExitPinInput(''); setExitPinError(''); }}>{th ? 'อยู่หน้า Photobooth' : 'Stay in Photobooth'}</button><button className="primary" type="submit" disabled={verifyingExitPin || exitPinInput.length < 4}>{verifyingExitPin ? (th ? 'กำลังตรวจสอบ…' : 'Checking…') : (th ? 'ยืนยัน PIN' : 'Verify PIN')}</button></div></form></div></section></div>}
    {(message || status?.lastError) && <div className="notice" role="status">{message || status?.lastError}</div>}
  </div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(new URLSearchParams(window.location.search).get('guestDisplay') === '1' ? <GuestDisplay /> : <App />);




