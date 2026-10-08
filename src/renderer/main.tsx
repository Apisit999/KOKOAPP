import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import type { AppStatus, CameraFolderWatchStatus, KokoMemoryStatus, KokoMemorySessionStatus, PhotoRecord, PhotoRecoveryIssue, PhotoStorageStatus, SavedPhoto, SavedVideo, Settings, PhotoboothEvent, GuestDisplayPayload } from '../shared/contract';
import type { LicenseSnapshot, Plan } from '../shared/license-contract';
import { BrowserCameraAdapter, CameraError, CameraManager, type CameraDevice, type CameraStatus } from './camera/camera-adapter';
import { waitForCaptureDelay } from './camera/capture-delay';
import { Icon } from './icons';
import { TemplatesPage, drawComposition } from './templates';
import { loadGuestTemplate, type GuestTemplate } from './templates';
import { EventsPage } from './events';
import { normalizedRectToPixels } from './template-layout';
import { drawImageLayers, drawTextLayers, loadImageLayers } from './template-layers';

const cameraManager = new CameraManager(new BrowserCameraAdapter());

function PhotoThumb({ photo, className = '' }: { photo: PhotoRecord; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let mounted = true;
    let objectUrl = '';
    window.koko.readPhoto(photo.id).then(result => {
      if (!mounted) return;
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(result.jpegBytes)], { type: 'image/jpeg' }));
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { mounted = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.id]);
  return url ? <img className={className} src={url} alt="" /> : <span className={`${className} photo-placeholder-mark`}>▧</span>;
}

function CaptureSessionsPage({ sessions, th, onOpenPhoto, onLoadMore, hasMore, loadingMore }: { sessions: import('../shared/contract').CaptureSessionRecord[]; th: boolean; onOpenPhoto: (photo: PhotoRecord) => void; onLoadMore: () => void; hasMore: boolean; loadingMore: boolean }) {
  const [sessionPhotos, setSessionPhotos] = useState<Record<string, PhotoRecord[]>>({});
  const [cloudShareLinks, setCloudShareLinks] = useState<Record<string, string>>({});
  const [cloudShareRevoked, setCloudShareRevoked] = useState<Record<string, boolean>>({});
  const [cloudShareExpiry, setCloudShareExpiry] = useState<Record<string, string>>({});
  const [copiedShareId, setCopiedShareId] = useState('');
  const [cloudSyncMessages, setCloudSyncMessages] = useState<Record<string, string>>({});
  useEffect(() => {
    let mounted = true;
    void Promise.all(sessions.map(async session => {
      try { return [session.id, await window.koko.getPhotoCloudShareUrl(session.id)] as const; }
      catch { return [session.id, null] as const; }
    })).then(entries => { if (mounted) setCloudShareLinks(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'))); });
    return () => { mounted = false; };
  }, [sessions]);
  useEffect(() => window.koko.onPhotoCloudProgress(progress => {
    setCloudSyncMessages(current => ({
      ...current,
      [progress.sessionId]: progress.total === 0
        ? (th ? 'ไม่มีไฟล์ให้อัปโหลด' : 'No media to upload')
        : th
          ? `ตรวจแล้ว ${progress.completed}/${progress.total} · อัปโหลดสำเร็จ ${progress.uploadedCount}/${progress.total}`
          : `Checked ${progress.completed}/${progress.total} · uploaded ${progress.uploadedCount}/${progress.total}`
    }));
  }), [th]);
  useEffect(() => {
    let mounted = true;
    void Promise.all(sessions.map(async session => {
      try { const status = await window.koko.getPhotoCloudShareStatus(session.id); return [session.id, status] as const; }
      catch { return [session.id, { revoked: false, expiresAt: null }] as const; }
    })).then(entries => { if (mounted) { setCloudShareRevoked(Object.fromEntries(entries.map(([id, status]) => [id, status.revoked]))); setCloudShareExpiry(Object.fromEntries(entries.filter(([, status]) => status.expiresAt).map(([id, status]) => [id, status.expiresAt!] ))); } });
    return () => { mounted = false; };
  }, [sessions]);
  useEffect(() => {
    let mounted = true;
    void Promise.all(sessions.map(async session => {
      const photos = await Promise.all([...session.photoIds, ...(session.compositionPhotoId ? [session.compositionPhotoId] : [])].map(async id => {
        try { return (await window.koko.readPhoto(id)).photo; } catch { return null; }
      }));
      return [session.id, photos.filter((photo): photo is PhotoRecord => photo !== null)] as const;
    })).then(entries => { if (mounted) setSessionPhotos(Object.fromEntries(entries)); });
    return () => { mounted = false; };
  }, [sessions]);
  const statusLabel: Record<import('../shared/contract').CaptureSessionRecord['status'], string> = {
    capturing: th ? 'กำลังถ่าย' : 'Capturing', review: th ? 'รอตรวจภาพ' : 'Needs review',
    confirmed: th ? 'ยืนยันแล้ว' : 'Confirmed', interrupted: th ? 'หยุดก่อนจบ' : 'Interrupted',
    cancelled: th ? 'ยกเลิก' : 'Cancelled', retaken: th ? 'ถ่ายใหม่' : 'Retaken'
  };
  return <><p className="eyebrow">KOKO / SESSIONS</p><h1>{th ? 'ประวัติรอบถ่าย' : 'Capture sessions'}</h1><p className="lead">{th ? 'รอบถ่ายและภาพต้นฉบับถูกเก็บไว้ในเครื่อง' : 'Capture rounds and their original photos are stored on this device.'}</p>
    {!sessions.length ? <section className="empty-state"><span>◷</span><h2>{th ? 'ยังไม่มีประวัติรอบถ่าย' : 'No capture sessions yet'}</h2><p>{th ? 'รอบถ่ายที่บันทึกสำเร็จจะแสดงที่นี่' : 'Saved capture rounds will appear here.'}</p></section> : <div className="capture-session-list">{sessions.map(session => <article className="capture-session-card" key={session.id}><div className="capture-session-heading"><div><strong>{session.template?.name || (session.videoIds?.length ? (th ? 'รอบวิดีโอ' : 'Video session') : (th ? 'ถ่ายภาพ' : 'Photo session'))}</strong><small>{new Date(session.createdAt).toLocaleString(th ? 'th-TH' : 'en-US')}{session.eventId ? ` · ${th ? 'มี Event' : 'Event assigned'}` : ''}</small></div><span className={`session-status session-${session.status}`}>{statusLabel[session.status]}</span></div><div className="capture-session-detail">{th ? `${session.photoIds.length} ภาพต้นฉบับ${session.compositionPhotoId ? ' · 1 ภาพประกอบ' : ''} · ${(session.videoIds ?? []).length} คลิป` : `${session.photoIds.length} original photo(s)${session.compositionPhotoId ? ' · 1 composed photo' : ''} · ${(session.videoIds ?? []).length} video(s)`}{session.template?.title ? ` · ${session.template.title}` : ''}</div>{sessionPhotos[session.id]?.length ? <div className="capture-session-photos">{sessionPhotos[session.id].map(photo => <button type="button" key={photo.id} onClick={() => onOpenPhoto(photo)} aria-label={th ? 'เปิดภาพจากรอบนี้' : 'Open a photo from this round'}><PhotoThumb photo={photo} /></button>)}</div> : session.photoIds.length > 0 && <p className="muted">{th ? 'บางภาพไม่อยู่ในคลังแล้ว' : 'บางภาพไม่อยู่ในคลังแล้ว'}</p>}{(session.videoIds ?? []).map(id => <SessionVideo key={id} id={id} th={th} />)}</article>)}</div>}
    {sessions.filter(session => session.photoIds.length > 0 || session.compositionPhotoId || (session.videoIds?.length ?? 0) > 0).map(session => <div className="photo-cloud-share session-share-link" key={`share-${session.id}`} role="status" aria-live="polite"><span>{new Date(session.createdAt).toLocaleString(th ? 'th-TH' : 'en-US')}{cloudSyncMessages[session.id] ? ` · ${cloudSyncMessages[session.id]}` : ''}</span><button type="button" onClick={() => void window.koko.syncPhotoCloudSession(session.id).then(result => { if (result.shareUrl) setCloudShareLinks(current => ({ ...current, [session.id]: result.shareUrl! })); if (result.mediaCount > 0 && result.uploadedCount === result.mediaCount && result.shareUrl) return navigator.clipboard.writeText(result.shareUrl).then(() => { setCopiedShareId(session.id); setCloudSyncMessages(current => ({ ...current, [session.id]: th ? 'อัปโหลดและคัดลอกลิงก์แล้ว' : 'Uploaded and copied the private link' })); }); setCopiedShareId(''); setCloudSyncMessages(current => ({ ...current, [session.id]: th ? `อัปโหลด ${result.uploadedCount}/${result.mediaCount} ไฟล์` : `Uploaded ${result.uploadedCount}/${result.mediaCount} media files` })); }).catch(error => { setCopiedShareId(''); setCloudSyncMessages(current => ({ ...current, [session.id]: error instanceof Error ? error.message : (th ? 'อัปโหลดไม่สำเร็จ' : 'Upload failed') })); })}>{copiedShareId === session.id ? (th ? 'คัดลอกแล้ว' : 'Copied') : cloudShareLinks[session.id] ? (th ? 'อัปโหลดซ้ำและคัดลอกลิงก์' : 'Retry upload & copy link') : (th ? 'อัปโหลดและสร้างลิงก์ส่วนตัว' : 'Upload & create private link')} ↗</button>{cloudShareExpiry[session.id] && !cloudShareRevoked[session.id] ? <small>{th ? "หมดอายุ " : "Expires "}{new Date(cloudShareExpiry[session.id]).toLocaleDateString(th ? "th-TH" : "en-US")}</small> : null}{cloudShareRevoked[session.id] ? <span className="muted">{th ? "ลิงก์ถูกปิดแล้ว" : "Link revoked"}</span> : cloudShareLinks[session.id] ? <button type="button" onClick={() => { if (!window.confirm(th ? "ปิดลิงก์อัลบั้มนี้ใช่ไหม ลูกค้าจะเปิดหรือดาวน์โหลดรูปจากลิงก์นี้ไม่ได้อีก" : "Revoke this album link? Customers will no longer be able to view or download its files.")) return; void window.koko.revokePhotoCloudShare(session.id).then(ok => { if (ok) { setCloudShareRevoked(current => ({ ...current, [session.id]: true })); setCloudShareLinks(current => { const next = { ...current }; delete next[session.id]; return next; }); setCloudSyncMessages(current => ({ ...current, [session.id]: th ? "ปิดลิงก์อัลบั้มแล้ว" : "Album link revoked" })); } }).catch(error => setCloudSyncMessages(current => ({ ...current, [session.id]: error instanceof Error ? error.message : "Revoke failed" }))); }}>{th ? "ปิดลิงก์" : "Revoke link"}</button> : null}</div>)}
    {sessions.map(session => <KokoMemorySessionAction key={`kokomemory-${session.id}`} session={session} th={th} />)}\n    {hasMore && <div className="load-more"><button className="camera-secondary" type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? (th ? 'กำลังโหลด…' : 'Loading…') : (th ? 'โหลดประวัติเพิ่มเติม' : 'Load more sessions')}</button></div>}
  </>;
}

function SessionVideo({ id, th }: { id: string; th: boolean }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function openVideo() {
    setBusy(true);
    setError('');
    try {
      const result = await window.koko.readVideo(id);
      setUrl(URL.createObjectURL(new Blob([Uint8Array.from(result.webmBytes)], { type: 'video/webm' })));
    } catch { setError(th ? 'เปิดคลิปไม่สำเร็จ ตรวจสอบโฟลเดอร์จัดเก็บ' : 'Could not open this clip. Check the storage folder.'); }
    finally { setBusy(false); }
  }
  async function exportVideo() { try { await window.koko.exportVideo(id); } catch { setError(th ? 'ส่งออกคลิปไม่สำเร็จ' : 'Could not export this clip.'); } }
  return <div className="session-video-item">{url ? <><video controls playsInline src={url} aria-label={th ? 'คลิปจากรอบถ่าย' : 'Clip from this session'} /><button type="button" className="camera-secondary" onClick={() => void exportVideo()}>{th ? 'ส่งออกคลิป' : 'Export clip'} ↓</button></> : <button type="button" className="camera-secondary" onClick={() => void openVideo()} disabled={busy}>{busy ? (th ? 'กำลังเปิดคลิป…' : 'Loading clip…') : (th ? '▶ เปิดคลิปวิดีโอ' : '▶ Play video clip')}</button>}{error && <small role="alert">{error}</small>}</div>;
}

function CameraPanel({ th, onStatus, onCapture, onVideoCapture, storageReady = false, photos = [], onOpenPhoto, onDeletePhoto, onExportPhoto, onOpenStorage, onOpenGallery, onOpenSettings, onOpenPrint, onOpenGuestDisplay, guestDisplayActive = false, availableGuestDisplays = [], selectedGuestDisplayId = null, onSelectGuestDisplay, storageName = null, activeEventName = null, guestMode = false, guestTemplate = null }: {
  th: boolean; onStatus?: (status: CameraStatus) => void; onCapture?: (photo: SavedPhoto) => void | Promise<void>; onVideoCapture?: (video: SavedVideo) => void | Promise<void>; storageReady?: boolean;
  photos?: PhotoRecord[]; onOpenPhoto?: (photo: PhotoRecord) => void; onDeletePhoto?: (photo: PhotoRecord) => void;
  onExportPhoto?: (photo: PhotoRecord) => void; onOpenStorage?: () => void; onOpenGallery?: () => void; onOpenSettings?: () => void;
  onOpenPrint?: () => void; onOpenGuestDisplay?: () => void; guestDisplayActive?: boolean;
  availableGuestDisplays?: Array<{ id: number; label: string; width: number; height: number }>;
  selectedGuestDisplayId?: number | null; onSelectGuestDisplay?: (displayId: number) => void;
  storageName?: string | null; activeEventName?: string | null; guestMode?: boolean; guestTemplate?: GuestTemplate | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const selectedIdRef = useRef('');
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraAspect, setCameraAspect] = useState<number | null>(null);
  const [cameraState, setCameraState] = useState<CameraStatus>('searching');
  const [countdown, setCountdown] = useState(3);
  const [photoCount, setPhotoCount] = useState<number>(() => guestMode ? guestTemplate?.count ?? 1 : 1);
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');
  const previewVideoAspect = guestMode && captureMode === 'video' && guestTemplate?.videoAspect
    ? guestTemplate.videoAspect : cameraAspect && Number.isFinite(cameraAspect) ? cameraAspect : 16 / 9;
  const [videoDuration, setVideoDuration] = useState(10);
  const [recordVideoAudio, setRecordVideoAudio] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [roundVideoId, setRoundVideoId] = useState('');
  const [roundVideoUrl, setRoundVideoUrl] = useState('');
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [captureNotice, setCaptureNotice] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [roundPhotoIds, setRoundPhotoIds] = useState<string[]>([]);
  const [roundSessionId, setRoundSessionId] = useState('');
  const roundSessionIdRef = useRef('');
  const [roundShareUrl, setRoundShareUrl] = useState('');
  const [roundCloudUploaded, setRoundCloudUploaded] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [guestCompositionUrl, setGuestCompositionUrl] = useState('');
  const [shareQrDataUrl, setShareQrDataUrl] = useState('');
  const [showGrid, setShowGrid] = useState(false);
  const capturingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const authorizationRef = useRef('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const guestDisplayPayloadRef = useRef<GuestDisplayPayload>({ language: th ? 'th' : 'en', eventName: '', status: 'disconnected', mediaMode: 'photo', countdown: null, resultCount: 0, previewDataUrl: '', qrDataUrl: '', message: '' });
  useEffect(() => onStatus?.(cameraState), [cameraState, onStatus]);
  useEffect(() => { if (guestMode) setPhotoCount(guestTemplate?.count ?? 1); }, [guestMode, guestTemplate]);
  useEffect(() => {
    const status: GuestDisplayPayload['status'] = reviewing ? 'review' : countdownValue !== null ? 'countdown' : capturing || recordingVideo ? 'capturing' : cameraState === 'ready' ? 'ready' : cameraState === 'connecting' || cameraState === 'searching' ? 'connecting' : 'disconnected';
    const message = reviewing
      ? roundCloudUploaded && roundShareUrl ? (th ? 'สแกน QR เพื่อรับภาพและวิดีโอ' : 'Scan the QR to receive your photos and videos') : (th ? 'กำลังเตรียมผลงาน กรุณารอสักครู่' : 'Preparing your captures. Please wait.')
      : cameraState === 'ready' ? (th ? 'พร้อมแล้ว เริ่มถ่ายได้เลย' : 'Ready when you are') : (th ? 'กรุณารอเจ้าหน้าที่ตรวจสอบกล้อง' : 'Please wait while the attendant checks the camera');
    guestDisplayPayloadRef.current = {
      language: th ? 'th' : 'en', eventName: activeEventName ?? '', status, mediaMode: captureMode,
      countdown: countdownValue, resultCount: reviewing ? reviewCount : roundPhotoIds.length + (roundVideoId ? 1 : 0),
      previewDataUrl: guestDisplayPayloadRef.current.previewDataUrl,
      qrDataUrl: reviewing && roundCloudUploaded ? shareQrDataUrl : '', message
    };
    if (guestDisplayActive) void window.koko.publishGuestDisplay(guestDisplayPayloadRef.current).catch(() => undefined);
  }, [guestDisplayActive, th, activeEventName, reviewing, countdownValue, capturing, recordingVideo, cameraState, roundCloudUploaded, roundShareUrl, captureMode, reviewCount, roundPhotoIds.length, roundVideoId, shareQrDataUrl]);
  useEffect(() => {
    if (!guestDisplayActive || cameraState !== 'ready' || !stream) return;
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const context = canvas.getContext('2d'); if (!context) return;
    let sending = false;
    const timer = window.setInterval(() => {
      if (sending || !video.videoWidth || !video.videoHeight) return;
      sending = true;
      context.fillStyle = '#080808'; context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale; const height = video.videoHeight * scale;
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      canvas.toBlob(blob => {
        if (!blob) { sending = false; return; }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            guestDisplayPayloadRef.current = { ...guestDisplayPayloadRef.current, previewDataUrl: reader.result };
            void window.koko.publishGuestDisplay(guestDisplayPayloadRef.current).catch(() => undefined);
          }
          sending = false;
        };
        reader.onerror = () => { sending = false; };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.55);
    }, 500);
    return () => window.clearInterval(timer);
  }, [guestDisplayActive, cameraState, stream]);
  useEffect(() => () => { if (guestCompositionUrl) URL.revokeObjectURL(guestCompositionUrl); }, [guestCompositionUrl]);
  useEffect(() => () => { if (roundVideoUrl) URL.revokeObjectURL(roundVideoUrl); }, [roundVideoUrl]);
  useEffect(() => {
    let current = true;
    if (!reviewing || !roundCloudUploaded || !roundShareUrl) { setShareQrDataUrl(''); return; }
    void QRCode.toDataURL(roundShareUrl, { errorCorrectionLevel: 'M', margin: 2, width: 240, color: { dark: '#111111', light: '#ffffff' } })
      .then(dataUrl => { if (current) setShareQrDataUrl(dataUrl); })
      .catch(() => { if (current) setShareQrDataUrl(''); });
    return () => { current = false; };
  }, [reviewing, roundCloudUploaded, roundShareUrl]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const found = await cameraManager.enumerateDevices();
        if (!mounted) return;
        setDevices(found);
        setCameraState(cameraManager.getStatus());
        if (selectedIdRef.current && !found.some(device => device.deviceId === selectedIdRef.current) && cameraManager.getStream()) {
          if (videoRef.current) cameraManager.stopPreview(videoRef.current);
          else cameraManager.disconnect();
          setStream(null);
          setSelectedId('');
          selectedIdRef.current = '';
          setCameraState(found.length ? 'disconnected' : 'not-found');
        }
      } catch { if (mounted) setCameraState('error'); }
    };
    const unsubscribe = cameraManager.onDevicesChanged(() => void refresh());
    void refresh();
    return () => {
      mounted = false;
      unsubscribe();
      if (videoRef.current) cameraManager.stopPreview(videoRef.current);
      else cameraManager.disconnect();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (stream && video) void Promise.resolve(cameraManager.startPreview(video, stream)).then(() => {
      if (cameraManager.getStream() === stream) setCameraState('ready');
    }).catch(() => {
      if (cameraManager.getStream() === stream) cameraManager.stopPreview(video);
      setStream(null);
      setCameraState('error');
    });
  }, [stream]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    const authorization = authorizationRef.current;
    if (authorization) void window.koko.cancelCapture(authorization).catch(() => undefined);
  }, []);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && capturingRef.current) { event.preventDefault(); abortRef.current?.abort(); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, []);

  async function connect(deviceId?: string) {
    if (videoRef.current) cameraManager.stopPreview(videoRef.current);
    else cameraManager.disconnect();
    setStream(null);
    setCameraState('connecting');
    try {
      const next = await cameraManager.connect(deviceId || undefined);
      if (!next) return;
      const actualId = next.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? '';
      setSelectedId(actualId);
      selectedIdRef.current = actualId;
      setStream(next);
      setCameraState('connecting');
      next.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (cameraManager.getStream() === next) {
          cameraManager.disconnect();
          setStream(null);
          setCameraState('disconnected');
        }
      }, { once: true }));
      const found = await cameraManager.enumerateDevices();
      setDevices(found);
    } catch (error) {
      const code = error instanceof CameraError ? error.code : 'unknown';
      setCameraState(code === 'permission-denied' ? 'permission-denied' : code === 'not-found' ? 'not-found' : 'error');
    }
  }

  const stop = () => {
    if (videoRef.current) cameraManager.stopPreview(videoRef.current);
    else cameraManager.disconnect();
    setStream(null);
    setCameraState(devices.length ? 'detected' : 'not-found');
  };
  async function capture() {
    const video = videoRef.current;
    if (!stream || !video || !onCapture || capturingRef.current) return;
    capturingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setCapturing(true);
    setCaptureError('');
    setCaptureNotice('');
    setRoundShareUrl('');
    setRoundCloudUploaded(false);
    setRoundPhotoIds([]);
    setRoundVideoId('');
    setRoundVideoUrl('');
    setGuestCompositionUrl('');
    const roundRecords: PhotoRecord[] = [];
    const savedPhotoIds: string[] = [];
    let savedVideoId = '';
    let sessionId = '';
    let sessionFinished = false;
    try {
      const requestedCount = captureMode === 'photo' ? photoCount : 1;
      const grant = await window.koko.beginCapture(requestedCount, guestMode ? guestTemplate : null, captureMode);
      sessionId = grant.sessionId;
      roundSessionIdRef.current = grant.sessionId;
      setRoundSessionId(grant.sessionId);
      setRoundShareUrl(grant.cloudShareUrl ?? '');
      setRoundCloudUploaded(Boolean(grant.cloudShareUrl));
      authorizationRef.current = grant.authorizationId;
      if (controller.signal.aborted) throw new DOMException('Capture canceled', 'AbortError');
      for (let value = countdown; value > 0; value--) {
        setCountdownValue(value);
        await waitForCaptureDelay(1000, controller.signal);
      }
      setCountdownValue(null);
      if (captureMode === 'photo') {
        for (let index = 0; index < photoCount; index++) {
          if (controller.signal.aborted) throw new DOMException('Capture canceled', 'AbortError');
          setCaptureProgress(index + 1);
          const blob = await cameraManager.captureStill(video, stream);
          if (controller.signal.aborted) throw new DOMException('Capture canceled', 'AbortError');
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const saved = await window.koko.savePhoto(bytes, grant.authorizationId);
          setRoundCloudUploaded(current => current && saved.cloudUploaded === true);
          setRoundPhotoIds(current => [...current, saved.id]);
          savedPhotoIds.push(saved.id);
          try { roundRecords.push((await window.koko.readPhoto(saved.id)).photo); } catch { /* The original is safely saved; preview loading can recover later. */ }
          try { await onCapture(saved); } catch { setCaptureNotice(th ? 'บันทึกภาพแล้ว แต่โหลดตัวอย่างภาพไม่สำเร็จ' : 'Photo saved, but the gallery preview did not refresh.'); }
          if (index < photoCount - 1) await waitForCaptureDelay(650, controller.signal);
        }
      } else {
        if (typeof MediaRecorder === 'undefined') throw new Error(th ? 'เครื่องนี้ไม่รองรับการอัดวิดีโอ' : 'Video recording is not supported on this device.');
        const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
        let recordingStream = stream;
        let microphoneStream: MediaStream | null = null;
        let framedCanvas: HTMLCanvasElement | null = null;
        let frameBitmap: ImageBitmap | null = null;
        let stickerBitmaps: Awaited<ReturnType<typeof loadImageLayers>> = [];
        let drawFrame = 0;
        if (guestMode && (guestTemplate?.videoOverlay || guestTemplate?.videoTextLayers?.length || guestTemplate?.videoImageLayers?.length)) {
          if (guestTemplate.videoOverlay) frameBitmap = await createImageBitmap(await (await fetch(guestTemplate.videoOverlay)).blob());
          stickerBitmaps = await loadImageLayers(guestTemplate.videoImageLayers);
          framedCanvas = document.createElement('canvas');
          const cameraSize = stream.getVideoTracks()[0]?.getSettings();
          const sourceWidth = frameBitmap ? frameBitmap.width : video.videoWidth || cameraSize?.width || 16;
          const sourceHeight = frameBitmap ? frameBitmap.height : video.videoHeight || cameraSize?.height || 9;
          const outputScale = 1920 / Math.max(sourceWidth, sourceHeight);
          framedCanvas.width = Math.max(2, Math.round(sourceWidth * outputScale / 2) * 2);
          framedCanvas.height = Math.max(2, Math.round(sourceHeight * outputScale / 2) * 2);
          const outputWidth = framedCanvas.width; const outputHeight = framedCanvas.height;
          const context = framedCanvas.getContext('2d');
          if (!context || !framedCanvas.captureStream) throw new Error(th ? 'ไม่สามารถสร้างวิดีโอพร้อมกรอบบนเครื่องนี้ได้' : 'Framed video recording is not supported on this device.');
          const renderFrame = () => {
            context.fillStyle = '#000'; context.fillRect(0, 0, outputWidth, outputHeight);
            if (video.videoWidth && video.videoHeight) {
              const scale = Math.max(outputWidth / video.videoWidth, outputHeight / video.videoHeight);
              const cropWidth = outputWidth / scale; const cropHeight = outputHeight / scale;
              context.drawImage(video, (video.videoWidth - cropWidth) / 2, (video.videoHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
            }
            if (frameBitmap) {
              const frame = guestTemplate!.videoFrame ?? { x: 0, y: 0, width: 100, height: 100 };
              const frameRect = normalizedRectToPixels(frame, outputWidth, outputHeight);
              context.drawImage(frameBitmap, frameRect.x, frameRect.y, frameRect.width, frameRect.height);
            }
            drawImageLayers(context, stickerBitmaps, outputWidth, outputHeight);
            drawTextLayers(context, guestTemplate?.videoTextLayers, outputWidth, outputHeight);
            drawFrame = requestAnimationFrame(renderFrame);
          };
          renderFrame();
          recordingStream = framedCanvas.captureStream(30);
        }
        if (recordVideoAudio) {
          microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (controller.signal.aborted) {
            microphoneStream.getTracks().forEach(track => track.stop());
            throw new DOMException('Capture canceled', 'AbortError');
          }
          if (framedCanvas) microphoneStream.getAudioTracks().forEach(track => recordingStream.addTrack(track));
          else recordingStream = new MediaStream([...recordingStream.getVideoTracks(), ...microphoneStream.getAudioTracks()]);
        }
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(recordingStream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 4_000_000, ...(recordVideoAudio ? { audioBitsPerSecond: 128_000 } : {}) });
        } catch (error) {
          microphoneStream?.getTracks().forEach(track => track.stop());
          if (framedCanvas) recordingStream.getVideoTracks().forEach(track => track.stop());
          throw error;
        }
        recorderRef.current = recorder;
        const chunks: Blob[] = [];
        const recordingStarted = performance.now();
        const clipPromise = new Promise<Blob>((resolve, reject) => {
          recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
          recorder.addEventListener('error', () => reject(new Error(th ? 'กล้องอัดวิดีโอไม่สำเร็จ' : 'The camera could not record this clip.')), { once: true });
          recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' })), { once: true });
        });
        const stopOnCancel = () => { if (recorder.state === 'recording') recorder.stop(); };
        controller.signal.addEventListener('abort', stopOnCancel, { once: true });
        try { recorder.start(250); }
        catch (error) {
          microphoneStream?.getTracks().forEach(track => track.stop());
          if (framedCanvas) recordingStream.getVideoTracks().forEach(track => track.stop());
          throw error;
        }
        setRecordingVideo(true);
        const durationTimer = window.setTimeout(stopOnCancel, videoDuration * 1000);
        let clip: Blob;
        try { clip = await clipPromise; }
        finally {
          window.clearTimeout(durationTimer); controller.signal.removeEventListener('abort', stopOnCancel);
          if (drawFrame) cancelAnimationFrame(drawFrame);
          if (framedCanvas) recordingStream.getVideoTracks().forEach(track => track.stop());
          microphoneStream?.getTracks().forEach(track => track.stop());
          frameBitmap?.close();
          stickerBitmaps.forEach(layer => layer.bitmap.close());
        }
        if (controller.signal.aborted) throw new DOMException('Video recording canceled', 'AbortError');
        if (!clip.size || clip.size > 100 * 1024 * 1024 || !clip.type.toLowerCase().startsWith('video/webm')) throw new Error(th ? 'คลิปมีรูปแบบหรือขนาดที่ไม่รองรับ' : 'The clip format or file size is not supported.');
        const bytes = new Uint8Array(await clip.arrayBuffer());
        const trackSize = stream.getVideoTracks()[0]?.getSettings();
        const durationMs = Math.max(500, Math.min(30_000, Math.round(performance.now() - recordingStarted)));
        const saved = await window.koko.saveVideo(bytes, framedCanvas?.width || video.videoWidth || trackSize?.width || 1280, framedCanvas?.height || video.videoHeight || trackSize?.height || 720, durationMs, grant.authorizationId);
        savedVideoId = saved.id;
        setRoundVideoId(saved.id);
        setRoundCloudUploaded(current => current && saved.cloudUploaded === true);
        setRoundVideoUrl(URL.createObjectURL(clip));
        try { await onVideoCapture?.(saved); } catch { setCaptureNotice(th ? 'บันทึกคลิปแล้ว แต่โหลดสถานะคลังไม่สำเร็จ' : 'Clip saved, but the library status did not refresh.'); }
      }
      await window.koko.completeCaptureSession(sessionId, 'review');
      sessionFinished = true;
      if (guestMode && guestTemplate && roundRecords.length === guestTemplate.count) {
        try {
          const canvas = document.createElement('canvas');
          await drawComposition(canvas, roundRecords, guestTemplate, th);
          const [blob, jpegBlob] = await Promise.all([
            new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not create the composed image')), 'image/png')),
            new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the composed image')), 'image/jpeg', 0.94))
          ]);
          setGuestCompositionUrl(URL.createObjectURL(blob));
          try { await window.koko.saveComposition(new Uint8Array(await jpegBlob.arrayBuffer()), sessionId); }
          catch { setCaptureNotice(th ? 'สร้างภาพประกอบแล้ว แต่บันทึกสำเนาเข้าคลังไม่สำเร็จ' : 'Composed image rendered, but its library copy could not be saved.'); }
        } catch { setCaptureNotice(th ? 'บันทึกภาพต้นฉบับแล้ว แต่สร้างภาพจากเทมเพลตไม่สำเร็จ' : 'Original photos were saved, but the template image could not be rendered.'); }
      }
      setReviewCount(savedPhotoIds.length + (savedVideoId ? 1 : 0));
      setReviewing(true);
      void window.koko.syncPhotoCloudSession(sessionId).then(result => {
        if (roundSessionIdRef.current !== sessionId) return;
        setRoundShareUrl(result.shareUrl ?? '');
        setRoundCloudUploaded(result.mediaCount > 0 && result.uploadedCount === result.mediaCount);
      }).catch(() => undefined);
    } catch (error) {
      const reason = controller.signal.aborted
        ? (th ? 'ยกเลิกรอบถ่ายแล้ว' : 'Capture session canceled')
        : (error instanceof Error ? error.message : (th ? 'ถ่ายไม่สำเร็จ' : 'Capture could not be completed'));
      if ((savedPhotoIds.length || savedVideoId) && sessionId) {
        try { await window.koko.completeCaptureSession(sessionId, 'review'); sessionFinished = true; } catch { /* Keep the saved photos accessible even if session bookkeeping fails. */ }
        setReviewCount(savedPhotoIds.length + (savedVideoId ? 1 : 0));
        setReviewing(true);
        void window.koko.syncPhotoCloudSession(sessionId).then(result => {
          if (roundSessionIdRef.current !== sessionId) return;
          setRoundShareUrl(result.shareUrl ?? '');
          setRoundCloudUploaded(result.mediaCount > 0 && result.uploadedCount === result.mediaCount);
        }).catch(() => undefined);
        setCaptureNotice(th ? `${reason} · บันทึกสื่อแล้ว ${savedPhotoIds.length + (savedVideoId ? 1 : 0)} รายการ` : `${reason} · ${savedPhotoIds.length + (savedVideoId ? 1 : 0)} item(s) saved.`);
      } else {
        setCaptureError(reason);
      }
    } finally {
      if (sessionId && !sessionFinished && !savedPhotoIds.length && !savedVideoId) {
        try { await window.koko.completeCaptureSession(sessionId, 'cancelled'); } catch { /* Session recovery handles an interrupted record. */ }
      }
      if (authorizationRef.current) void window.koko.cancelCapture(authorizationRef.current).catch(() => undefined);
      authorizationRef.current = '';
      abortRef.current = null;
      capturingRef.current = false;
      recorderRef.current = null;
      setRecordingVideo(false);
      setCountdownValue(null); setCaptureProgress(0); setCapturing(false);
    }
  }
  async function copyShareLink() {
    if (!roundShareUrl || !roundCloudUploaded) return;
    try {
      await navigator.clipboard.writeText(roundShareUrl);
      setCaptureNotice(th ? 'คัดลอกลิงก์โฟลเดอร์ภาพส่วนตัวแล้ว' : 'Private photo folder link copied');
    } catch {
      setCaptureNotice(th ? 'คัดลอกลิงก์ไม่ได้ ลองเริ่มแอปใหม่แล้วทำซ้ำ' : 'Could not copy the folder link. Restart the app and try again.');
    }
  }
  async function retryCloudUpload() {
    if (!roundSessionId || cloudSyncing) return;
    setCloudSyncing(true);
    try {
      const result = await window.koko.syncPhotoCloudSession(roundSessionId);
      setRoundShareUrl(result.shareUrl ?? '');
      const complete = result.mediaCount > 0 && result.uploadedCount === result.mediaCount;
      setRoundCloudUploaded(complete);
      setCaptureNotice(complete
        ? (th ? 'อัปโหลดภาพและวิดีโอทั้งหมดแล้ว' : 'All photos and videos uploaded')
        : (th ? `อัปโหลดแล้ว ${result.uploadedCount}/${result.mediaCount} ไฟล์` : `Uploaded ${result.uploadedCount}/${result.mediaCount} media files`));
    } catch (error) {
      setCaptureNotice(error instanceof Error ? error.message : (th ? 'อัปโหลดภาพไม่สำเร็จ' : 'Photo upload failed'));
    } finally { setCloudSyncing(false); }
  }
  async function retakeRound() {
    const sessionId = roundSessionIdRef.current;
    if (sessionId) await window.koko.completeCaptureSession(sessionId, 'retaken').catch(() => undefined);
    setReviewing(false);
    setReviewCount(0);
    setRoundPhotoIds([]);
    setRoundVideoId('');
    setRoundVideoUrl('');
    setGuestCompositionUrl('');
    void capture();
  }
  async function confirmRound() {
    const sessionId = roundSessionIdRef.current;
    if (sessionId) await window.koko.completeCaptureSession(sessionId, 'confirmed').catch(() => undefined);
    setReviewing(false);
    setReviewCount(0);
  }
  function cancelSession() { abortRef.current?.abort(); }
  function downloadComposition() {
    if (!guestCompositionUrl) return;
    const anchor = document.createElement('a');
    anchor.href = guestCompositionUrl;
    anchor.download = `${(guestTemplate?.name || 'koko-photo-template').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 80)}.png`;
    document.body.append(anchor); anchor.click(); anchor.remove();
  }
  const labels: Record<CameraStatus, string> = {
    searching: th ? 'กำลังค้นหากล้อง' : 'Searching for cameras',
    detected: th ? 'พบกล้องแล้ว ยังไม่ได้เชื่อมต่อ' : 'Camera found, not connected',
    'not-found': th ? 'ไม่พบกล้อง' : 'No camera found',
    connecting: th ? 'กำลังเชื่อมต่อกล้อง' : 'Connecting to camera',
    ready: th ? 'พร้อมใช้งาน' : 'Ready',
        'permission-denied': th ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง' : 'Camera permission denied',
    busy: th ? 'กล้องกำลังถูกใช้งาน' : 'Camera is in use',
    disconnected: th ? 'กล้องถูกถอดออก' : 'Camera disconnected',
    error: th ? 'เกิดข้อผิดพลาดกับกล้อง' : 'Camera error'
  };

  const captureDisabled = capturing || !storageReady || cameraState !== 'ready';
  const roundPhotos = roundPhotoIds.map(id => photos.find(photo => photo.id === id)).filter((photo): photo is PhotoRecord => Boolean(photo));
  async function runSamplePhotoSession() {
    if (capturingRef.current || captureMode !== 'photo') return;
    if (!storageReady) { setCaptureError(th ? 'เลือกโฟลเดอร์เก็บภาพก่อนเริ่มโหมดทดลอง' : 'Choose a photo storage folder before starting the sample session.'); return; }
    capturingRef.current = true;
    setCapturing(true); setCaptureError(''); setCaptureNotice(''); setRoundShareUrl(''); setRoundCloudUploaded(false);
    setRoundPhotoIds([]); setRoundVideoId(''); setRoundVideoUrl(''); setGuestCompositionUrl('');
    const template = guestMode ? guestTemplate : null;
    const requestedCount = template?.count ?? photoCount;
    const records: PhotoRecord[] = [];
    const savedIds: string[] = [];
    let sessionId = '';
    let finished = false;
    let authorizationId = '';
    try {
      const grant = await window.koko.beginCapture(requestedCount, template, 'photo');
      sessionId = grant.sessionId; authorizationId = grant.authorizationId;
      authorizationRef.current = authorizationId; roundSessionIdRef.current = sessionId;
      setRoundSessionId(sessionId); setRoundShareUrl(grant.cloudShareUrl ?? '');
      for (let index = 0; index < requestedCount; index++) {
        setCaptureProgress(index + 1);
        const response = await fetch(`/demo/portrait-${['one', 'two', 'three', 'four'][index]}.svg`);
        if (!response.ok) throw new Error('A built-in sample photo could not be loaded.');
        const bitmap = await createImageBitmap(await response.blob());
        const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round(bitmap.width * scale)); canvas.height = Math.max(2, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) { bitmap.close(); throw new Error('Sample photo canvas is unavailable.'); }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
        const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the sample photo.')), 'image/jpeg', .94));
        const saved = await window.koko.savePhoto(new Uint8Array(await jpeg.arrayBuffer()), authorizationId);
        savedIds.push(saved.id); setRoundPhotoIds(current => [...current, saved.id]);
        try { records.push((await window.koko.readPhoto(saved.id)).photo); } catch { /* Saved sample remains available in the library. */ }
        await onCapture?.(saved);
      }
      await window.koko.completeCaptureSession(sessionId, 'review'); finished = true;
      if (template && records.length === template.count) {
        const canvas = document.createElement('canvas');
        await drawComposition(canvas, records, template, th);
        const [png, jpeg] = await Promise.all([
          new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not render the sample composition.')), 'image/png')),
          new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode the sample composition.')), 'image/jpeg', .94))
        ]);
        setGuestCompositionUrl(URL.createObjectURL(png));
        await window.koko.saveComposition(new Uint8Array(await jpeg.arrayBuffer()), sessionId);
      }
      setReviewCount(savedIds.length); setReviewing(true);
      void window.koko.syncPhotoCloudSession(sessionId).then(result => {
        if (roundSessionIdRef.current !== sessionId) return;
        setRoundShareUrl(result.shareUrl ?? ''); setRoundCloudUploaded(result.mediaCount > 0 && result.uploadedCount === result.mediaCount);
      }).catch(() => undefined);
      setCaptureNotice(th ? 'โหมดทดลองใช้ภาพตัวอย่าง ระบบบันทึกภาพลงคลังแล้ว' : 'Sample session complete. The images were saved to your library.');
    } catch (error) {
      const message = error instanceof Error ? error.message : (th ? 'โหมดทดลองทำงานไม่สำเร็จ' : 'Sample session could not be completed.');
      if (sessionId && savedIds.length && !finished) {
        try { await window.koko.completeCaptureSession(sessionId, 'review'); finished = true; } catch { /* Keep saved sample files available. */ }
        setReviewCount(savedIds.length); setReviewing(true);
        void window.koko.syncPhotoCloudSession(sessionId).catch(() => undefined);
        setCaptureNotice(`${message} · ${savedIds.length} ${th ? 'ภาพถูกบันทึกแล้ว' : 'sample photo(s) saved.'}`);
      } else setCaptureError(message);
    } finally {
      if (authorizationId) void window.koko.cancelCapture(authorizationId).catch(() => undefined);
      authorizationRef.current = ''; setCaptureProgress(0); setCapturing(false); capturingRef.current = false;
    }
  }
  function activateCapture() {
    if (recordingVideo && recorderRef.current?.state === 'recording') recorderRef.current.stop();
    else void capture();
  }
  return <section className={`camera-panel ${onCapture ? 'studio-layout' : 'diagnostics-layout'} ${guestMode ? 'guest-camera-panel' : ''}`} aria-label={th ? 'กล้อง' : 'Camera'}>
    <div className="studio-left">
      <div className="camera-selector-row">
        <span className={`camera-status-pill ${cameraState === 'ready' ? 'is-ready' : cameraState === 'permission-denied' || cameraState === 'error' || cameraState === 'disconnected' ? 'is-error' : ''}`} role="status"><i />{cameraState === 'ready' ? (th ? 'เชื่อมต่อแล้ว' : 'Connected') : labels[cameraState]}</span>
        <label className="camera-select-label"><span>{th ? 'กล้อง' : 'Camera'}</span><select value={selectedId} onChange={event => { const id = event.target.value; setSelectedId(id); selectedIdRef.current = id; void connect(id || undefined); }} disabled={cameraState === 'connecting' || capturing} aria-label={th ? 'เลือกกล้อง' : 'Select camera'}>
          <option value="">{th ? 'กล้องเริ่มต้น' : 'Default camera'}</option>
          {devices.map((device, index) => <option value={device.deviceId} key={device.deviceId || index}>{device.label || `${th ? 'กล้อง' : 'Camera'} ${index + 1}`}</option>)}
        </select></label>
        <button className="icon-button camera-settings-button" onClick={onOpenSettings} title={th ? 'ตั้งค่ากล้อง' : 'Camera settings'} aria-label={th ? 'ตั้งค่ากล้อง' : 'Camera settings'}><Icon name="settings" /></button>
      </div>
      <p className="camera-capability-note">{th ? 'กล้องเว็บแคมถ่ายภาพจากเฟรมสดและอัดคลิปสั้นลงเครื่องได้ ยังไม่สั่งชัตเตอร์กล้อง DSLR โดยตรง' : 'Webcams can save a still frame or record a short local clip. This does not trigger a DSLR shutter.'}</p>
      <div className={`camera-preview ${stream ? 'has-stream' : ''}`}>
        {stream ? <div className="video-composition-preview" style={{ '--preview-aspect': previewVideoAspect } as React.CSSProperties}><video ref={videoRef} autoPlay muted playsInline aria-label={th ? 'ภาพสดจากกล้อง' : 'Live camera preview'} onLoadedMetadata={event => { const item = event.currentTarget; if (item.videoWidth && item.videoHeight) setCameraAspect(item.videoWidth / item.videoHeight); }} onResize={event => { const item = event.currentTarget; if (item.videoWidth && item.videoHeight) setCameraAspect(item.videoWidth / item.videoHeight); }} />{guestMode && captureMode === 'video' && guestTemplate?.videoOverlay && <img className="video-frame-preview" src={guestTemplate.videoOverlay} alt={th ? 'ตัวอย่างกรอบวิดีโอ' : 'Video frame preview'} style={guestTemplate.videoFrame ? { inset: 'auto', left: `${guestTemplate.videoFrame.x}%`, top: `${guestTemplate.videoFrame.y}%`, width: `${guestTemplate.videoFrame.width}%`, height: `${guestTemplate.videoFrame.height}%` } : undefined} />}{guestMode && captureMode === 'video' && guestTemplate?.videoImageLayers?.map(layer => <img key={layer.id} className="video-sticker-live" src={layer.src} alt="" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%` }} />)}{guestMode && captureMode === 'video' && guestTemplate?.videoTextLayers?.map(layer => <span key={layer.id} className="video-text-live" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, color: layer.color, fontSize: `${layer.fontSize}cqh`, textAlign: layer.align }}>{layer.text}</span>)}</div> : <div className="camera-placeholder"><span className="placeholder-icon"><Icon name="camera" size={32} /></span><strong>{labels[cameraState]}</strong><small>{cameraState === 'permission-denied' ? (th ? 'อนุญาตการเข้าถึงกล้องในการตั้งค่าระบบ' : 'Allow camera access in system settings') : cameraState === 'not-found' ? (th ? 'เชื่อมต่อกล้องแล้วกดเริ่มภาพตัวอย่าง' : 'Connect a camera, then start the live preview') : (th ? 'เริ่มภาพตัวอย่างเพื่อจัดเฟรมภาพถ่าย' : 'Start the live preview to frame your photograph')}</small>{cameraState !== 'connecting' && <button className="preview-start" onClick={() => cameraState === 'permission-denied' && onOpenSettings ? onOpenSettings() : void connect(selectedId || undefined)}><Icon name={cameraState === 'permission-denied' && onOpenSettings ? 'settings' : 'camera'} size={16} />{cameraState === 'permission-denied' && onOpenSettings ? (th ? 'เปิดการตั้งค่าอุปกรณ์' : 'Device settings') : (th ? 'เริ่มภาพตัวอย่าง' : 'Start live preview')}</button>}</div>}
        <div className="preview-corners" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="preview-tools" aria-label={th ? 'เครื่องมือแสดงภาพ' : 'Preview tools'}>
          <button className={showGrid ? 'selected' : ''} onClick={() => setShowGrid(value => !value)} title={th ? 'เส้นช่วยจัดองค์ประกอบ' : 'Composition grid'} aria-label={th ? 'สลับเส้นช่วยจัดองค์ประกอบ' : 'Toggle composition grid'} aria-pressed={showGrid}><Icon name="grid" /></button>
        </div>
        {showGrid && stream && <div className="composition-grid" aria-hidden="true"><i /><i /><i /><i /></div>}
        {stream && <span className="live-badge"><i /> LIVE</span>}
        {!stream && cameraState === 'connecting' && <div className="preview-loading" role="status"><span className="loading-mark">◌</span>{th ? 'กำลังเชื่อมต่อกล้อง…' : 'Connecting camera…'}</div>}
        {countdownValue !== null && <div className="countdown-overlay" role="status">{countdownValue}</div>}
      </div>
      {onCapture && !stream && captureMode === 'photo' && <section className="sample-session-card"><div><strong>{th ? 'ทดลองโดยไม่ใช้กล้อง' : 'Try a sample session'}</strong><small>{th ? 'ใช้ภาพตัวอย่างในแอป เพื่อทดสอบการบันทึก เทมเพลต คลังภาพ และอัลบั้ม' : 'Use built-in sample portraits to try saving, templates, the library, and private albums.'}</small></div><button className="camera-secondary" type="button" onClick={() => void runSamplePhotoSession()} disabled={!storageReady || capturing || reviewing}>{capturing ? (th ? 'กำลังบันทึกตัวอย่าง…' : 'Saving samples…') : (th ? `เริ่มตัวอย่าง ${guestMode && guestTemplate ? guestTemplate.count : photoCount} ภาพ` : `Preview ${guestMode && guestTemplate ? guestTemplate.count : photoCount} sample photo(s)`)}</button></section>}
      {onCapture && <>
        {guestMode && reviewing && guestCompositionUrl && <section className="guest-composition"><img src={guestCompositionUrl} alt={th ? 'ภาพประกอบจากเทมเพลต' : 'Composed template image'} /><button type="button" className="camera-secondary" onClick={downloadComposition}>{th ? 'ดาวน์โหลดภาพประกอบ' : 'Download composed image'}</button></section>}
        <div className="capture-strip">
          <div className="strip-main"><div className="strip-heading"><span className="panel-kicker">{guestMode ? (th ? 'ภาพในรอบนี้' : 'THIS ROUND') : 'CAPTURE STRIP'}</span><small>{guestMode ? `${roundPhotos.length} ${th ? 'ภาพ' : roundPhotos.length === 1 ? 'photo' : 'photos'}` : photos.length ? `${photos.length} ${th ? 'ภาพล่าสุด' : 'recent photos'}` : (th ? 'ยังไม่มีภาพที่บันทึก' : 'No saved photos yet')}</small></div>
            {guestMode ? roundPhotos.length ? <div className="guest-round-grid">{roundPhotos.map(photo => <button className="guest-round-photo" key={photo.id} onClick={() => onOpenPhoto?.(photo)} aria-label={th ? 'ดูภาพที่ถ่ายในรอบนี้' : 'View a photo from this round'}><PhotoThumb photo={photo} /></button>)}</div> : <div className="strip-empty">{th ? 'ภาพที่ถ่ายในรอบนี้จะแสดงที่นี่' : 'Photos from this round will appear here.'}</div> : photos.length ? <div className="strip-photos">{photos.slice(0, 4).map(photo => <div className="strip-photo" key={photo.id}><button className="strip-thumb" onClick={() => onOpenPhoto?.(photo)} aria-label={th ? 'เปิดดูภาพ' : 'Preview photo'}><PhotoThumb photo={photo} /></button><div className="strip-photo-actions"><button onClick={() => onExportPhoto?.(photo)} title={th ? 'ส่งออกภาพ' : 'Export photo'} aria-label={th ? 'ส่งออกภาพ' : 'Export photo'}><Icon name="download" size={14} /></button><button onClick={() => onDeletePhoto?.(photo)} title={th ? 'ลบภาพ' : 'Delete photo'} aria-label={th ? 'ลบภาพ' : 'Delete photo'}><Icon name="close" size={14} /></button></div></div>)}</div> : <div className="strip-empty">{th ? 'ภาพที่ถ่ายสำเร็จจะแสดงที่นี่' : 'Photos from this session will appear here.'}</div>}
          </div>
          <div className="capture-actions"><button className={`capture-disc ${recordingVideo ? 'is-recording' : ''}`} onClick={activateCapture} disabled={(captureDisabled && !recordingVideo) || reviewing} aria-label={recordingVideo ? (th ? 'หยุดอัดวิดีโอ' : 'Stop video') : (captureMode === 'video' ? (th ? 'เริ่มอัดวิดีโอ' : 'Record video') : (th ? 'ถ่ายภาพ' : 'Capture'))}><span>{recordingVideo ? <i className="recording-mark" /> : capturing ? <span className="loading-mark">◌</span> : <Icon name="camera" size={27} />}</span></button><span className="capture-caption">{recordingVideo ? (th ? 'กำลังอัด · แตะเพื่อหยุด' : 'RECORDING · TAP TO STOP') : capturing ? (captureMode === 'photo' ? (th ? `${captureProgress || 1}/${photoCount} กำลังบันทึก` : `${captureProgress || 1}/${photoCount} SAVING`) : (th ? 'กำลังเตรียมวิดีโอ…' : 'PREPARING VIDEO…')) : captureMode === 'video' ? (th ? 'อัดวิดีโอ' : 'RECORD VIDEO') : (th ? 'ถ่ายภาพ' : 'CAPTURE')}</span>{!guestMode && <button className="export-latest" onClick={() => photos[0] && onExportPhoto?.(photos[0])} disabled={!photos.length}>{th ? 'ส่งออกล่าสุด' : 'Export latest'}</button>}</div>
        </div>
        {guestMode && reviewing && roundVideoUrl && <section className="guest-composition"><video controls playsInline src={roundVideoUrl} aria-label={th ? 'คลิปวิดีโอของคุณ' : 'Your recorded clip'} /><button type="button" className="camera-secondary" onClick={() => roundVideoId && void window.koko.exportVideo(roundVideoId)}>{th ? 'ส่งออกคลิปวิดีโอ' : 'Export video clip'} ↓</button></section>}
        {reviewing ? <div className="capture-feedback review-feedback" role="status"><div><strong>{th ? 'ตรวจสอบผลงานของคุณ' : 'Review your capture'}</strong><span>{th ? `บันทึกแล้ว ${reviewCount} รายการ · ไฟล์ต้นฉบับยังอยู่ในคลัง` : `${reviewCount} item(s) saved · original files stay in the library`}</span></div><div className="review-actions">{roundPhotos[0] && <button type="button" onClick={() => onOpenPhoto?.(roundPhotos[0])}>{th ? 'ดูภาพ' : 'View photo'}</button>}{roundVideoId && <button type="button" onClick={() => void window.koko.exportVideo(roundVideoId)}>{th ? 'บันทึกคลิป' : 'Save clip'}</button>}<button type="button" onClick={() => void retakeRound()}>{captureMode === 'video' ? (th ? 'อัดใหม่' : 'Record again') : (th ? 'ถ่ายใหม่' : 'Retake')}</button><button type="button" className="review-confirm" onClick={() => void confirmRound()}>{th ? 'ยืนยันจบรอบ' : 'Finish round'}</button></div></div> : (captureError || captureNotice || !storageReady) && <div className={`capture-feedback ${captureError ? 'has-error' : ''}`} role={captureError ? 'alert' : 'status'}>{captureError || captureNotice || (th ? 'เลือกโฟลเดอร์จัดเก็บใน Settings ก่อนเริ่ม' : 'Choose a storage folder in Settings before capturing.')}</div>}
        {reviewing && (roundPhotoIds.length > 0 || roundVideoId) && <div className="photo-cloud-share" role="status">{roundCloudUploaded && roundShareUrl ? <><span>{th ? 'อัปโหลดผลงานรอบนี้ไปยังอัลบั้มส่วนตัวแล้ว' : 'This session is uploaded to its private album.'}</span><button type="button" onClick={() => void copyShareLink()}>{th ? 'คัดลอกลิงก์อัลบั้ม' : 'Copy private album link'} ↗</button>{shareQrDataUrl && <div className="private-album-qr"><img src={shareQrDataUrl} alt={th ? 'QR สำหรับเปิดอัลบั้มส่วนตัว' : 'QR code for this private album'} /><small>{th ? 'สแกนเพื่อดูและดาวน์โหลดภาพ/วิดีโอ' : 'Scan to view and download this session'}</small></div>}</> : <><span>{th ? 'ผลงานอยู่ในเครื่องแล้ว — ยังอัปโหลดไม่ครบ' : 'Media is saved locally; cloud upload is incomplete.'}</span><button type="button" onClick={() => void retryCloudUpload()} disabled={cloudSyncing}>{cloudSyncing ? (th ? 'กำลังอัปโหลด…' : 'Uploading…') : (th ? 'ลองอัปโหลดอีกครั้ง' : 'Retry upload')}</button></>}{captureNotice && <span>{captureNotice}</span>}</div>}
          <div className="event-session-panel"><span className="event-icon"><Icon name="calendar" /></span><div className="event-copy"><span className="panel-kicker">EVENT SESSION</span><strong>{activeEventName || (th ? 'เซสชันในเครื่อง' : 'Local photo session')}</strong><small>{storageReady ? (th ? `โฟลเดอร์: ${storageName}` : `Folder: ${storageName}`) : (th ? 'ยังไม่ได้เลือกโฟลเดอร์จัดเก็บ' : 'No photo folder selected')}</small></div><button className="icon-button folder-action" onClick={storageReady ? onOpenStorage : onOpenSettings} title={storageReady ? (th ? 'เปิดโฟลเดอร์ภาพ' : 'Open photo folder') : (th ? 'เลือกโฟลเดอร์ภาพ' : 'Choose a photo folder')} aria-label={storageReady ? (th ? 'เปิดโฟลเดอร์ภาพ' : 'Open photo folder') : (th ? 'เลือกโฟลเดอร์ภาพ' : 'Choose a photo folder')}><Icon name={storageReady ? 'folder' : 'settings'} /></button><span className={`storage-ready ${storageReady ? 'is-ready' : ''}`}><i />{storageReady ? (th ? 'บันทึกพร้อม' : 'READY TO SAVE') : (th ? 'ตั้งค่าพื้นที่' : 'SET STORAGE')}</span></div>
      </>}
    </div>
    {onCapture && <aside className="studio-right">
      <section className="control-section capture-settings"><div className="section-heading"><span className="panel-kicker">CAPTURE SETTINGS</span><span className="control-mark"><Icon name="settings" size={15} /></span></div>
        <div className="setting-row"><span>{th ? 'ชนิดสื่อ' : 'Capture mode'}</span><div className="segmented-control" role="group" aria-label={th ? 'เลือกถ่ายภาพหรือวิดีโอ' : 'Choose photo or video'}>{(['photo', 'video'] as const).map(value => <button key={value} type="button" className={captureMode === value ? 'selected' : ''} aria-pressed={captureMode === value} disabled={capturing || reviewing} onClick={() => setCaptureMode(value)}>{value === 'photo' ? (th ? 'ภาพถ่าย' : 'Photo') : (th ? 'วิดีโอ' : 'Video')}</button>)}</div></div>
        {captureMode === 'photo' && <div className="setting-row"><span>{th ? 'จำนวนภาพ' : 'Photo count'}</span><div className="segmented-control" role="group" aria-label={th ? 'จำนวนภาพต่อชุด' : 'Photos per session'}>{[1, 2, 4].map(count => <button key={count} type="button" className={photoCount === count ? 'selected' : ''} aria-pressed={photoCount === count} disabled={capturing} onClick={() => setPhotoCount(count)}>{count}<small>{th ? 'ภาพ' : count === 1 ? 'photo' : 'photos'}</small></button>)}</div></div>}
        {captureMode === 'video' && <div className="setting-row"><span>{th ? 'ความยาวคลิป' : 'Clip length'}</span><div className="segmented-control countdown-options" role="group" aria-label={th ? 'เลือกความยาววิดีโอ' : 'Choose video length'}>{[5, 10, 15].map(value => <button key={value} type="button" className={videoDuration === value ? 'selected' : ''} aria-pressed={videoDuration === value} disabled={capturing} onClick={() => setVideoDuration(value)}>{value}s</button>)}</div></div>}
        {captureMode === 'video' && <div className="setting-row"><span>{th ? 'เสียงไมโครโฟน' : 'Microphone audio'}</span><label className="audio-toggle"><input type="checkbox" checked={recordVideoAudio} disabled={capturing} onChange={event => setRecordVideoAudio(event.target.checked)} /><small>{recordVideoAudio ? (th ? 'บันทึกเสียงขณะอัดคลิป' : 'Include audio in recorded clips') : (th ? 'ปิดเสียงไมโครโฟน' : 'Record video without microphone audio')}</small></label></div>}
        <div className="setting-row"><span>{th ? 'นับถอยหลัง' : 'Countdown'}</span><div className="segmented-control countdown-options" role="group" aria-label={th ? 'ตั้งเวลานับถอยหลัง' : 'Countdown timer'}>{[0, 3, 5, 10].map(value => <button key={value} type="button" className={countdown === value ? 'selected' : ''} aria-pressed={countdown === value} disabled={capturing} onClick={() => setCountdown(value)}>{value ? `${value}s` : 'OFF'}</button>)}</div></div>
        {capturing && <button className="cancel-session" onClick={cancelSession}>{th ? 'ยกเลิกชุดถ่าย' : 'Cancel session'} <Icon name="close" size={14} /></button>}
      </section>
      <section className="control-section quick-actions"><div className="section-heading"><span className="panel-kicker">QUICK ACTIONS</span></div><div className="quick-action-grid">
        <button onClick={onOpenGallery}><Icon name="image" /><span>{th ? 'เปิดคลังภาพ' : 'Open gallery'}</span><Icon name="chevron" size={14} /></button>
        <button onClick={onOpenSettings}><Icon name="settings" /><span>{th ? 'ตั้งค่ากล้อง' : 'Camera settings'}</span><Icon name="chevron" size={14} /></button>
        <button onClick={onOpenPrint}><Icon name="printer" /><span>{th ? 'ตั้งค่าการพิมพ์' : 'Print setup'}</span><Icon name="chevron" size={14} /></button>
        <button onClick={onOpenGuestDisplay} disabled={!availableGuestDisplays.length}><Icon name="grid" /><span>{guestDisplayActive ? (th ? 'เปิดจอแขกอีกครั้ง' : 'Focus guest display') : (th ? 'เปิดจอแขก' : 'Open guest display')}</span><Icon name="chevron" size={14} /></button>
      </div></section>
      <label className="guest-display-target"><span>{th ? 'จอแสดงผลให้แขก' : 'Guest display'}</span>{availableGuestDisplays.length ? <select value={selectedGuestDisplayId ?? ''} onChange={event => onSelectGuestDisplay?.(Number(event.target.value))}>{availableGuestDisplays.map(display => <option key={display.id} value={display.id}>{display.label} · {display.width}×{display.height}</option>)}</select> : <small>{th ? 'เชื่อมต่อจอที่สองเพื่อเปิดหน้าจอแขก' : 'Connect a second display to enable the guest screen.'}</small>}</label>
      <section className="output-note"><span className="panel-kicker">LOCAL OUTPUT</span><p>{storageReady ? (th ? `ภาพจะถูกบันทึกไปยัง ${storageName}` : `Captures save to ${storageName}`) : (th ? 'เลือกโฟลเดอร์ปลายทางเพื่อเริ่มถ่ายภาพ' : 'Choose an output folder to enable capture.')}</p><button className="text-link" onClick={storageReady ? onOpenStorage : onOpenSettings}>{storageReady ? (th ? 'เปิดโฟลเดอร์' : 'Open folder') : (th ? 'เลือกโฟลเดอร์' : 'Choose folder')} <Icon name="arrow" size={14} /></button></section>
    </aside>}
    {!onCapture && <div className="diagnostics-actions">{stream ? <button className="camera-secondary" onClick={stop} disabled={capturing}>{th ? 'หยุดภาพตัวอย่าง' : 'Stop preview'}</button> : <button className="primary" onClick={() => void connect(selectedId || undefined)} disabled={cameraState === 'connecting'}>{cameraState === 'connecting' ? (th ? 'กำลังเชื่อมต่อ…' : 'Connecting…') : (th ? 'เปิดภาพตัวอย่าง' : 'Start preview')}</button>}</div>}
  </section>;
}
function GuestDisplay() {
  const [payload, setPayload] = useState<GuestDisplayPayload>({ language: 'th', eventName: '', status: 'connecting', mediaMode: 'photo', countdown: null, resultCount: 0, previewDataUrl: '', qrDataUrl: '', message: 'กำลังเชื่อมต่อหน้าจอเจ้าหน้าที่' });
  const th = payload.language === 'th';
  useEffect(() => window.koko.onGuestDisplayUpdate(setPayload), []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') void window.koko.closeGuestDisplay(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  return <main className="guest-display" lang={payload.language}>
    <header className="koko-header-brand"><img src="/koko-studio-mark.png" alt="" /><div><span className="brand-wordmark" lang="en">KOKO</span><span className="brand-subtitle">STUDIO / PHOTOBOOTH</span></div><span className="guest-display-event">{payload.eventName}</span></header>
    <section className="guest-display-stage">
      {payload.previewDataUrl ? <img className="guest-display-preview" src={payload.previewDataUrl} alt={th ? 'ภาพสดจากกล้อง' : 'Live camera preview'} /> : <div className="guest-display-placeholder"><span>◉</span><p>{th ? 'เตรียมตัวให้พร้อม แล้วมาสร้างภาพที่ระลึกกัน' : 'Get ready to make a memory.'}</p></div>}
      {payload.status === 'countdown' && payload.countdown !== null && <div className="guest-display-countdown" role="status">{payload.countdown}</div>}
      {payload.status === 'capturing' && <div className="guest-display-recording" role="status"><i />{payload.mediaMode === 'video' ? (th ? 'กำลังบันทึกวิดีโอ' : 'RECORDING VIDEO') : (th ? 'กำลังถ่ายภาพ' : 'CAPTURING')}</div>}
    </section>
    <section className="guest-display-footer">
      {payload.status === 'review' && payload.qrDataUrl
        ? <div className="guest-display-qr"><img src={payload.qrDataUrl} alt={th ? 'QR สำหรับรับผลงาน' : 'QR code to receive your captures'} /><div><strong>{th ? 'ผลงานของคุณพร้อมแล้ว' : 'Your captures are ready'}</strong><span>{th ? 'สแกนเพื่อดูและดาวน์โหลดภาพหรือวิดีโอ' : 'Scan to view and download your photos or videos'}</span></div></div>
        : <><strong>{payload.message}</strong>{payload.status === 'review' && <span>{th ? 'กรุณารอสักครู่ หรือสอบถามเจ้าหน้าที่' : 'Please wait or ask the attendant for help.'}</span>}</>}
      <small>{th ? 'กด Esc เพื่อปิดหน้าจอแขก' : 'Press Esc to close this display'}</small>
    </section>
  </main>;
}

function cameraReadinessText(status: CameraStatus, th: boolean) {
  if (status === 'ready') return th ? 'กล้องพร้อมใช้งาน' : 'Camera is ready.';
  if (status === 'permission-denied') return th ? 'อนุญาตให้ KOKO ใช้กล้อง' : 'Allow KOKO to use the camera.';
  if (status === 'not-found') return th ? 'ไม่พบกล้องที่เชื่อมต่อ' : 'No camera was found.';
  if (status === 'busy') return th ? 'กล้องกำลังใช้งานโดยโปรแกรมอื่น' : 'Another app is using the camera.';
  if (status === 'disconnected') return th ? 'กล้องหลุดการเชื่อมต่อ' : 'Camera disconnected.';
  return th ? 'เปิดภาพตัวอย่างเพื่อตรวจสอบกล้อง' : 'Start the preview to check the camera.';
}

type ReadinessItem = { title: string; detail: string; state: 'ready' | 'todo' | 'optional'; action: string; onClick: () => void };

function ReadinessChecklist({ items, th }: { items: ReadinessItem[]; th: boolean }) {
  const required = items.filter(item => item.state !== 'optional');
  const ready = required.filter(item => item.state === 'ready').length;
  return <section className="readiness-section" aria-labelledby="readiness-title">
    <div className="section-heading"><div><p className="eyebrow">KOKO / EVENT SETUP</p><h2 id="readiness-title">{th ? 'เตรียมงานให้พร้อม' : 'Get your event ready'}</h2><p>{th ? `พร้อมแล้ว ${ready} จาก ${required.length} ขั้นตอนหลัก · หน้าจอแขกเป็นตัวเลือกเสริม` : `${ready} of ${required.length} essentials ready · The guest display is optional.`}</p></div></div>
    <div className="readiness-grid">{items.map((item, index) => <article className={`readiness-card readiness-${item.state}`} key={item.title}>
      <span className="readiness-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="readiness-indicator" aria-label={item.state === 'ready' ? (th ? 'พร้อม' : 'Ready') : item.state === 'optional' ? (th ? 'ตัวเลือก' : 'Optional') : (th ? 'ต้องตั้งค่า' : 'Needs setup')}>{item.state === 'ready' ? '✓' : item.state === 'optional' ? '○' : '·'}</span>
      <div className="readiness-copy"><strong>{item.title}</strong><small>{item.detail}</small></div>
      <button type="button" className="text-link" onClick={item.onClick}>{item.action} <span>→</span></button>
    </article>)}</div>
  </section>;
}

function GuestPreviewPage({ th, active, displays, selectedDisplayId, onSelectDisplay, onOpenDisplay, onCloseDisplay, onGuestMode }: {
  th: boolean;
  active: boolean;
  displays: Array<{ id: number; label: string; width: number; height: number }>;
  selectedDisplayId: number | null;
  onSelectDisplay: (id: number) => void;
  onOpenDisplay: () => void;
  onCloseDisplay: () => void;
  onGuestMode: () => void;
}) {
  return <div className="guest-preview-layout">
    <section className="guest-preview-stage"><img src="/demo/portrait-one.svg" alt=""/><div className="guest-preview-copy"><img src="/koko-studio-mark.png" alt=""/><span className="brand-wordmark">KOKO</span><small>YOUR MOMENT STARTS HERE</small></div><div className="guest-preview-badge"><i/> {th ? 'ตัวอย่างหน้าจอแขก' : 'GUEST DISPLAY PREVIEW'}</div></section>
    <section className="guest-preview-controls"><span className="panel-kicker">DISPLAY SETUP</span><h2>{th ? 'หน้าจอที่สอง' : 'Second display'}</h2><p>{active ? (th ? 'กำลังเปิดหน้าจอแขกบนจอที่สอง' : 'The guest display is open on your second screen.') : displays.length ? (th ? 'เลือกจอแล้วเปิดหน้าจอแขกได้' : 'Choose a display and open the guest screen.') : (th ? 'ยังไม่พบจอที่สอง แต่ดูตัวอย่างหน้าจอนี้และทดลองโหมดแขกได้' : 'No second display detected. You can still preview this screen and try Guest mode.')}</p><label className="guest-display-target"><span>{th ? 'เลือกจอ' : 'Choose display'}</span><select value={selectedDisplayId ?? ''} onChange={event => onSelectDisplay(Number(event.target.value))} disabled={!displays.length}>{displays.length ? displays.map(display => <option key={display.id} value={display.id}>{display.label} · {display.width}×{display.height}</option>) : <option value="">{th ? 'ยังไม่พบจอที่สอง' : 'No second display found'}</option>}</select></label><button className="primary" type="button" onClick={onOpenDisplay} disabled={active || !displays.length}>{th ? 'เปิดบนจอที่สอง' : 'Open on second display'} <Icon name="arrow" size={15}/></button>{active && <button className="camera-secondary" type="button" onClick={onCloseDisplay}>{th ? 'ปิดจอแขก' : 'Close guest display'}</button>}<hr/><h2>{th ? 'ทดลองโหมดแขก' : 'Try Guest mode'}</h2><p>{th ? 'ไม่มีกล้องก็ใช้ภาพตัวอย่างทดสอบเทมเพลต คลังภาพ และอัลบั้มได้' : 'Use built-in sample photos to try templates, the library, and private albums without a camera.'}</p><button className="camera-secondary" type="button" onClick={onGuestMode}>{th ? 'เปิดโหมดแขกแบบเต็มจอ' : 'Open full-screen Guest mode'} <Icon name="arrow" size={15}/></button></section>
  </div>;
}

function CameraFolderWatchSettings({ th, storageReady, onMessage }: { th: boolean; storageReady: boolean; onMessage: (value: string) => void }) {
  const [watch, setWatch] = useState<CameraFolderWatchStatus>({ enabled: false, folderPath: null, importedCount: 0, lastError: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.koko.getCameraFolderWatchStatus().then(setWatch).catch(() => undefined); }, []);
  useEffect(() => {
    if (!watch.enabled) return;
    const refresh = () => { void window.koko.getCameraFolderWatchStatus().then(setWatch).catch(() => undefined); };
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [watch.enabled]);
  useEffect(() => window.koko.onCameraFolderPhotoImport(() => setWatch(current => ({ ...current, importedCount: current.importedCount + 1, lastError: null }))), []);
  async function toggle() {
    setBusy(true);
    try {
      const next = watch.enabled ? await window.koko.stopCameraFolderWatch() : await window.koko.startCameraFolderWatch();
      setWatch(next);
      onMessage(next.enabled ? (th ? 'เริ่มเฝ้าดูโฟลเดอร์กล้องแล้ว' : 'Camera folder monitoring started.') : (th ? 'หยุดเฝ้าดูโฟลเดอร์กล้องแล้ว' : 'Camera folder monitoring stopped.'));
    } catch (error) { onMessage(error instanceof Error ? error.message : (th ? 'ตั้งค่าโฟลเดอร์กล้องไม่สำเร็จ' : 'Could not configure the camera folder.')); }
    finally { setBusy(false); }
  }
  return <section className="storage-settings"><div><strong>{th ? 'นำเข้าภาพจากกล้อง' : 'Camera folder import'}</strong><p>{watch.folderPath ? (th ? `โฟลเดอร์: ${watch.folderPath}` : `Folder: ${watch.folderPath}`) : (th ? 'เฝ้าดูโฟลเดอร์ที่ซอฟต์แวร์กล้องบันทึกไฟล์ JPEG' : 'Watch the folder where camera software saves JPEG files.')}</p>{watch.enabled && <small>{th ? `นำเข้าแล้ว ${watch.importedCount} ภาพ · สแกนทุก 1.5 วินาที` : `${watch.importedCount} photo(s) imported · scanning every 1.5 seconds`}</small>}{watch.lastError && <small className="storage-warning">{watch.lastError}</small>}</div><button className="camera-secondary" onClick={() => void toggle()} disabled={busy || (!storageReady && !watch.enabled)}>{busy ? (th ? 'กำลังตั้งค่า…' : 'Working…') : watch.enabled ? (th ? 'หยุดเฝ้าดู' : 'Stop watching') : (th ? 'เลือกโฟลเดอร์และเริ่ม' : 'Choose folder and start')}</button><p>{th ? 'ภาพ JPEG ที่เขียนเสร็จจะถูกคัดลอกเข้าคลัง โดยไม่ลบต้นฉบับ และผูกกับ Event ที่กำลังเลือก การเฝ้าดูจะทำงานต่อหลังเปิดแอปใหม่' : 'Completed JPEG files are copied into the library, source files stay untouched, and imports use the active event. Monitoring resumes when the app restarts.'}</p></section>;
}

function KokoMemorySettings({ th, onMessage }: { th: boolean; onMessage: (value: string) => void }) {
  const [status, setStatus] = useState<KokoMemoryStatus | null>(null);
  const [galleryUrl, setGalleryUrl] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.koko.getKokoMemoryStatus().then(value => { setStatus(value); setGalleryUrl(value.galleryUrl ?? ''); }).catch(error => onMessage(error instanceof Error ? error.message : 'KOKOMEMORY unavailable')); }, []);
  async function run(action: () => Promise<KokoMemoryStatus>) {
    setBusy(true);
    try { const next = await action(); setStatus(next); setGalleryUrl(next.galleryUrl ?? ''); }
    catch (error) { onMessage(error instanceof Error ? error.message : 'KOKOMEMORY settings could not be saved'); }
    finally { setBusy(false); }
  }
  return <section className="storage-settings"><div><strong>KOKOMEMORY</strong><p>{status?.configured ? `${status.apiOrigin} · Booking ${status.bookingId} · Album ${status.shareId}` : (th ? 'ยังไม่ได้เชื่อมต่ออัลบั้ม' : 'No KOKOMEMORY album connected')}</p><small>{th ? 'นำเข้าไฟล์ uploader จากหน้าแอดมิน KOKOMEMORY ข้อมูลลับจะเข้ารหัสด้วย Windows' : 'Import the uploader JSON from the KOKOMEMORY admin page. The credential is encrypted with Windows secure storage.'}</small></div><button className="camera-secondary" disabled={busy} onClick={() => void run(() => window.koko.importKokoMemoryConfig())}>{th ? 'นำเข้าไฟล์ uploader' : 'Import uploader file'}</button>{status?.configured && <><label>{th ? 'ลิงก์อัลบั้มลูกค้า (ไม่บังคับ)' : 'Customer gallery URL (optional)'}<input value={galleryUrl} onChange={event => setGalleryUrl(event.target.value)} placeholder="https://…/gallery/booking?guestToken=…" /></label><div><button className="camera-secondary" disabled={busy} onClick={() => void run(() => window.koko.setKokoMemoryGalleryUrl(galleryUrl))}>{th ? 'บันทึกลิงก์' : 'Save gallery URL'}</button> <button className="camera-secondary" disabled={busy} onClick={() => void run(() => window.koko.clearKokoMemoryConnection())}>{th ? 'ตัดการเชื่อมต่อ' : 'Disconnect'}</button></div></>}{!status?.configured && <p>{th ? 'การอัปโหลดใช้ได้กับภาพ JPEG ไม่เกิน 25 MB และอัลบั้มที่ตรงกับ booking เท่านั้น' : 'Uploads support JPEG photos up to 25 MB and use the imported booking album only.'}</p>}</section>;
}

function KokoMemorySessionAction({ session, th }: { session: import('../shared/contract').CaptureSessionRecord; th: boolean }) {
  const [status, setStatus] = useState<KokoMemorySessionStatus>({ state: 'idle', total: 0, uploadedCount: 0, lastError: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.koko.getKokoMemorySessionStatus(session.id).then(setStatus).catch(() => undefined); }, [session.id]);
  if (session.status !== 'confirmed' || (!session.compositionPhotoId && !session.photoIds.length)) return null;
  const labels = { idle: th ? 'ยังไม่ได้ส่ง' : 'Not uploaded', pending: th ? 'รอส่ง' : 'Queued', uploading: th ? 'กำลังอัปโหลด' : 'Uploading', uploaded: th ? 'อัปโหลดครบแล้ว' : 'Uploaded', 'needs-attention': th ? 'ต้องตรวจสอบ' : 'Needs attention' };
  return <div className="photo-cloud-share session-share-link"><span>{labels[status.state]} · {status.uploadedCount}/{status.total}{status.lastError ? ` · ${status.lastError}` : ''}</span><button type="button" disabled={busy} onClick={() => { setBusy(true); void window.koko.syncKokoMemorySession(session.id).then(setStatus).catch(error => setStatus(current => ({ ...current, lastError: error instanceof Error ? error.message : 'Upload failed' }))).finally(() => setBusy(false)); }}>{busy ? (th ? 'กำลังอัปโหลด…' : 'Uploading…') : status.state === 'uploaded' ? (th ? 'ตรวจสอบ/ส่งซ้ำ' : 'Check / retry') : (th ? 'ส่งไป KOKOMEMORY' : 'Upload to KOKOMEMORY')}</button></div>;
}

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [mode, setMode] = useState<'operator' | 'guest'>('operator');
  const [page, setPage] = useState('studio');
  const [deviceDiagnostics, setDeviceDiagnostics] = useState(false);
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
  useEffect(() => { window.koko.getStatus().then(setStatus).catch(() => setMessage('Unable to load app status')); }, []);
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
        if (activePhoto) { setActivePhoto(null); requestAnimationFrame(() => lastPhotoButton.current?.focus()); return; }
        if (mode === 'guest') { setMode('operator'); void window.koko.setFullscreen(false); }
        return;
      }
      if (page === 'studio' && event.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((event.target as HTMLElement).tagName)) {
        event.preventDefault(); document.querySelector<HTMLButtonElement>('.capture-button')?.click();
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [activePhoto, mode, page]);
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
    { id: 'studio', icon: 'camera', th: 'ถ่ายภาพ', en: 'Capture' },
    { id: 'sessions', icon: 'calendar', th: 'รอบถ่าย', en: 'Sessions' },
    { id: 'gallery', icon: 'image', th: 'แกลเลอรี', en: 'Gallery' },
    { id: 'templates', icon: 'template', th: 'เทมเพลต', en: 'Templates' },
    { id: 'printing', icon: 'printer', th: 'การพิมพ์', en: 'Print' },
    { id: 'guest-preview', icon: 'monitor', th: 'จอแขก', en: 'Guest view' },
    { id: 'events', icon: 'calendar', th: 'อีเวนต์', en: 'Events' },
    { id: 'settings', icon: 'settings', th: 'ตั้งค่า', en: 'Settings' }
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
    { title: th ? 'จัดภาพและพิมพ์' : 'Compose & print', detail: th ? 'เลือกภาพ จัดวาง แล้วเปิดกล่องพิมพ์ของ Windows' : 'Arrange photos and open the system print dialog.', state: 'optional', action: th ? 'เปิดการพิมพ์' : 'Print setup', onClick: () => go('printing') }
  ];
  const requiredFeature = page === 'studio' ? 'capture' : page === 'printing' ? 'printing' : null;
  const hasRequiredFeature = requiredFeature !== null && license?.features.includes(requiredFeature);
  const gated = requiredFeature !== null && (licenseLoading || (license?.state !== 'active' && license?.state !== 'offline_grace') || !hasRequiredFeature);
  const diagnostics = page === 'settings' && deviceDiagnostics;
  const statusLabel: Record<CameraStatus, string> = { searching: th ? 'กำลังตรวจสอบ' : 'Checking', detected: th ? 'พบกล้อง' : 'Camera found', 'not-found': th ? 'ไม่พบกล้อง' : 'No camera', connecting: th ? 'กำลังเชื่อมต่อ' : 'Connecting', ready: th ? 'พร้อมใช้งาน' : 'Ready', 'permission-denied': th ? 'ต้องอนุญาตใช้กล้อง' : 'Permission needed', busy: th ? 'กล้องกำลังถูกใช้งาน' : 'Camera is in use', disconnected: th ? 'กล้องหลุดการเชื่อมต่อ' : 'Disconnected', error: th ? 'ตรวจสอบกล้อง' : 'Needs attention' };
  const pageName = page === 'studio' ? 'Capture Studio' : page === 'dashboard' ? (th ? 'แดชบอร์ด' : 'Dashboard') : page === 'account' ? (th ? 'บัญชีและ License' : 'Account & License') : title ? (th ? title.th : title.en) : (th ? 'ศูนย์ช่วยเหลือ' : 'Help Center');
  return <div lang={th ? 'th' : 'en'} className={`${settings?.highContrast ? 'app contrast' : 'app'} ${page === 'studio' ? 'is-studio' : ''} ${window.koko.isMacOS ? 'macos' : ''}`}>
    {mode === 'operator' ? <div className="shell">
      <aside className="sidebar"><button className="brand brand-button" onClick={() => go('dashboard')} aria-label="KOKO Studio Dashboard"><img className="brand-symbol" src="/koko-studio-mark.png" alt="" /><span className="brand-lockup"><span className="brand-wordmark" lang="en">KOKO</span><small>STUDIO / PHOTOBOOTH</small></span></button>
        <p className="side-label">{th ? 'สตูดิโอ' : 'STUDIO'}</p><nav aria-label="Main navigation">{navItems.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => go(item.id)} title={th ? item.th : item.en}><span className="nav-icon"><Icon name={item.icon} size={18} /></span><span>{th ? item.th : item.en}</span></button>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-license"><span className={`license-dot ${license?.state === 'active' || license?.state === 'offline_grace' ? 'good' : ''}`} /><span>{licenseLoading ? (th ? 'กำลังตรวจสอบ License' : 'Checking license') : license?.state === 'active' ? (th ? 'License ใช้งานได้' : 'License active') : license?.state === 'offline_grace' ? 'Offline grace' : (th ? 'License ไม่ได้เชื่อมต่อ' : 'License not active')}</span></div><button className={`sidebar-account ${page === 'account' ? 'active' : ''}`} onClick={() => go('account')} title={th ? 'บัญชีและ License' : 'Account & License'}><span className="nav-icon"><Icon name="user" size={17} /></span><span>{th ? 'บัญชีและ License' : 'Account & License'}</span><Icon name="chevron" size={14} /></button><div className="edition-meta"><span>{license?.state === 'active' ? 'LICENSED EDITION' : 'DESKTOP EDITION'}</span><small>v{status?.version ?? '…'}</small></div></div>
      </aside>
      <div className="workspace"><header className="topbar"><div className="topbar-title"><span className="crumb">KOKO</span><span className="crumb-sep">/</span><span>{pageName}</span></div><div className="topbar-actions"><span className={`camera-top-status ${cameraState === 'ready' ? 'good' : ''}`}><i />{cameraState === 'ready' ? 'LIVE' : statusLabel[cameraState]}</span><button className="topbar-settings" onClick={() => go('settings')} title={th ? 'ตั้งค่า' : 'Settings'} aria-label={th ? 'ตั้งค่า' : 'Settings'}><Icon name="settings" size={18} /></button><button className="topbar-account" onClick={() => go('account')}><Icon name="user" size={17} />{th ? 'บัญชี' : 'Account'}</button><span className={`license-chip ${license?.state === 'active' || license?.state === 'offline_grace' ? 'is-active' : ''}`}><span />{licenseLoading ? (th ? 'กำลังตรวจสอบ' : 'Checking') : license?.state === 'active' ? 'ACTIVE' : license?.state === 'offline_grace' ? 'OFFLINE GRACE' : license?.state === 'expired' ? 'EXPIRED' : license?.state === 'revoked' ? 'REVOKED' : license?.state === 'device_limit' ? 'DEVICE LIMIT' : 'UNLICENSED'}</span></div></header>
        <main className={`page-content ${page === 'studio' ? 'studio-page' : ''}`}>{page === 'dashboard' ? <>
          <div className="welcome-row"><div><p className="eyebrow">{th ? 'ยินดีต้อนรับสู่ KOKO' : 'WELCOME TO KOKO'}</p><h1>{th ? 'พร้อมสร้างช่วงเวลาพิเศษหรือยัง?' : 'Ready to make something memorable?'}</h1><p className="lead">{th ? 'ตั้งค่าพื้นฐานให้พร้อม แล้วเริ่มต้นเซสชันถ่ายภาพของคุณ' : 'Get your setup ready and start a new photo session.'}</p></div><div className="welcome-actions"><button className="camera-secondary" onClick={() => void guest()}>{th ? 'เริ่มโหมดแขก' : 'Start Guest mode'}</button><button className="primary start-button" onClick={() => go('studio')}><span>＋</span>{th ? 'เริ่มเซสชัน' : 'Start Session'}<span>→</span></button></div></div>
          <section className="dashboard-cards"><article className="summary-card camera-summary"><div className="card-heading"><div><span className="card-icon pink">◎</span><span><small>{th ? 'สถานะอุปกรณ์' : 'DEVICE STATUS'}</small><h2>{th ? 'กล้อง' : 'Camera'}</h2></span></div><span className={`status-dot ${cameraState === 'ready' || cameraState === 'detected' ? 'good' : ''}`}>{statusLabel[cameraState]}</span></div><p>{cameraState === 'ready' ? (th ? 'กล้องพร้อมแล้ว ดูภาพตัวอย่างได้ในการตรวจสอบอุปกรณ์' : 'Camera is ready. Open diagnostics to preview it.') : (th ? 'เชื่อมต่อกล้องก่อนเริ่มใช้งาน' : 'Connect a camera before starting a session.')}</p><button className="text-link" onClick={() => { setDeviceDiagnostics(true); go('settings'); }}>{th ? 'ตรวจสอบอุปกรณ์' : 'Device Diagnostics'} <span>→</span></button></article>
          <article className="summary-card license-summary"><div className="card-heading"><div><span className="card-icon violet">✦</span><span><small>{th ? 'บัญชีของคุณ' : 'YOUR ACCOUNT'}</small><h2>{th ? 'สถานะ License' : 'License status'}</h2></span></div><span className={`status-dot ${license?.state === 'active' ? 'good' : 'neutral'}`}>{licenseLoading ? (th ? 'กำลังตรวจสอบ' : 'Checking') : license?.state === 'active' ? (th ? 'ใช้งานได้' : 'Active') : license?.state === 'offline_grace' ? (th ? 'Offline Grace' : 'Offline grace') : license?.state === 'expired' ? (th ? 'หมดอายุ' : 'Expired') : license?.state === 'device_limit' ? (th ? 'เกินจำนวนเครื่อง' : 'Device limit') : license?.state === 'revoked' ? (th ? 'ถูกเพิกถอน' : 'Revoked') : (th ? 'ตรวจสอบไม่ได้' : 'Unverified')}</span></div><p>{license?.state === 'active' ? (th ? 'ตรวจสอบ License กับบริการแล้ว' : 'License was verified with the service.') : license?.state === 'offline_grace' ? (th ? `ใช้งานในเครื่องได้ถึง ${license.offlineUntil ?? '—'}` : `Local use allowed until ${license.offlineUntil ?? '—'}`) : (th ? 'ยังยืนยันสิทธิ์จากบริการ License ไม่ได้' : 'Entitlement cannot currently be verified by the licensing service.')}</p><button className="text-link" onClick={() => go('account')}>{th ? 'ดูบัญชีและ License' : 'Account & license'} <span>→</span></button></article>
          <article className="summary-card storage-summary"><div className="card-heading"><div><span className="card-icon blue">▧</span><span><small>{th ? 'จัดเก็บในเครื่อง' : 'LOCAL STORAGE'}</small><h2>{th ? 'คลังภาพ' : 'Photo library'}</h2></span></div><span className={`status-dot ${photoStorage?.configured ? 'good' : 'neutral'}`}>{photoStorage?.configured ? (th ? 'พร้อมใช้งาน' : 'Ready') : (th ? 'ตั้งค่าโฟลเดอร์' : 'Set up folder')}</span></div><p>{photoStorage?.configured ? (th ? `เก็บภาพ ${photoStorage.photoCount} ภาพใน ${photoStorage.directoryName}` : `${photoStorage.photoCount} photo(s) in ${photoStorage.directoryName}`) : (th ? 'ตั้งค่าโฟลเดอร์จัดเก็บก่อนเริ่มถ่ายภาพ' : 'Choose a storage folder before capturing photos.')}</p><button className="text-link" onClick={() => go('settings')}>{th ? 'ตั้งค่าพื้นที่จัดเก็บ' : 'Storage settings'} <span>→</span></button></article></section>
          <section className="welcome-panel"><div><span className="panel-kicker">KOKO PHOTOBOOTH</span><h2>{th ? 'ช่วงเวลาดี ๆ เริ่มจากภาพถ่ายหนึ่งใบ' : 'Great moments start with one photo.'}</h2><p>{th ? 'เตรียมกล้องและพื้นที่จัดเก็บ เพื่อพร้อมสำหรับเซสชันแรกของคุณ' : 'Connect your camera and choose where to save photos to prepare for your first session.'}</p></div></section>
          <ReadinessChecklist items={readinessItems} th={th} />
        </> : gated ? <section className="gate-card"><div className="gate-symbol">K</div><p className="eyebrow">KOKO / {page === 'studio' ? 'CAPTURE STUDIO' : 'PRINTING'}</p><h1>{licenseLoading ? (th ? 'กำลังตรวจสอบ License' : 'Checking your license') : license?.state === 'expired' ? (th ? 'License หมดอายุแล้ว' : 'Your license has expired') : license?.state === 'revoked' ? (th ? 'License นี้ถูกเพิกถอน' : 'This license was revoked') : license?.state === 'device_limit' ? (th ? 'ใช้ License ครบจำนวนเครื่องแล้ว' : 'Device limit reached') : (th ? 'ต้องตรวจสอบ License ก่อนใช้งาน' : 'License verification required')}</h1><p className="lead">{licenseLoading ? (th ? 'กำลังตรวจสอบสิทธิ์กับบริการ License' : 'Verifying your entitlement with the licensing service.') : license?.state === 'expired' ? (th ? 'ต่ออายุ License เพื่อเริ่มเซสชันใหม่ ภาพเดิมยังอยู่ในคลังภาพและส่งออกได้' : 'Renew your license to start new sessions. Existing photos remain available in Gallery.') : license?.state === 'revoked' ? (th ? 'ติดต่อผู้ดูแลบัญชีหรือฝ่ายช่วยเหลือ ภาพที่บันทึกไว้ยังเปิดได้' : 'Contact your account administrator or support. Saved photos remain accessible.') : license?.state === 'device_limit' ? (th ? 'ปิดใช้งานอุปกรณ์อื่นในบัญชี หรือดูวิธีจัดการอุปกรณ์' : 'Deactivate another device on your account or review device management.') : (th ? 'ยังยืนยันสิทธิ์จาก License Server ไม่ได้ จึงปิดฟีเจอร์นี้ไว้' : 'Entitlement could not be verified by the license server, so this feature remains locked.')}</p><div className="inline-error"><span>●</span>{th ? `สถานะ: ${licenseLoading ? 'กำลังตรวจสอบ' : license?.state ?? 'server_error'}` : `Status: ${licenseLoading ? 'loading' : license?.state ?? 'server_error'}`}</div><button className="primary" onClick={() => go('account')}>{th ? 'ไปที่บัญชีและ License' : 'ไปที่บัญชีและ License'}</button>{!licenseLoading && <button className="text-link gate-secondary" onClick={() => go('gallery')}>{th ? 'เปิดคลังภาพและกู้คืน' : 'Open Gallery & recovery'} →</button>}</section>
        : page === 'studio' ? <><div className="studio-heading"><div><p className="eyebrow">KOKO / CAPTURE STUDIO</p><h1 lang="en">Capture Studio</h1><p className="studio-tagline">{th ? 'เก็บภาพช่วงเวลาที่มีความหมาย' : 'CAPTURE MORE THAN MEMORIES'}</p></div><span className={cameraState === 'ready' ? 'studio-live-state is-live' : 'studio-live-state'}><i />{cameraState === 'ready' ? 'LIVE' : statusLabel[cameraState]}</span></div><CameraPanel th={th} onStatus={setCameraState} onCapture={photo => void handleCaptureSaved(photo)} onVideoCapture={video => void handleVideoSaved(video)} storageReady={Boolean(photoStorage?.configured)} storageName={photoStorage?.directoryName} activeEventName={eventData.events.find(item => item.id === eventData.activeEventId)?.name ?? null} photos={photos} onOpenPhoto={photo => setActivePhoto(photo)} onDeletePhoto={photo => void deletePhoto(photo)} onExportPhoto={photo => void exportPhoto(photo)} onOpenStorage={() => void openPhotoStorageFolder()} onOpenGallery={() => go('gallery')} onOpenPrint={() => go('printing')} onOpenGuestDisplay={() => void openGuestDisplay()} guestDisplayActive={guestDisplayActive} availableGuestDisplays={availableGuestDisplays} selectedGuestDisplayId={selectedGuestDisplayId} onSelectGuestDisplay={setSelectedGuestDisplayId} onOpenSettings={() => { setDeviceDiagnostics(true); go('settings'); }} /></>
        : page === 'settings' ? <><p className="eyebrow">KOKO / SETTINGS</p><h1>{diagnostics ? (th ? 'ตรวจสอบอุปกรณ์' : 'Device Diagnostics') : (th ? 'ตั้งค่าแอป' : 'App settings')}</h1><p className="lead">{diagnostics ? (th ? 'ตรวจสอบการเชื่อมต่อและภาพตัวอย่างกล้อง' : 'Check camera connectivity and preview.') : (th ? 'จัดการประสบการณ์และพื้นที่จัดเก็บบนอุปกรณ์นี้' : 'Manage your app experience and local storage.')}</p>{diagnostics ? <><button className="back-link" onClick={() => setDeviceDiagnostics(false)}>← {th ? 'กลับไปตั้งค่า' : 'Back to settings'}</button><CameraPanel th={th} onStatus={setCameraState} /></> : <><section className="settings"><label>{th ? 'ภาษา' : 'Language'}<select value={settings?.language ?? 'th'} onChange={e => settings && void update({ ...settings, language: e.target.value as 'th' | 'en' })}><option value="th">ไทย</option><option value="en">English</option></select></label><label className="switch"><span>{th ? 'ความคมชัดสูง' : 'High contrast'}<small>{th ? 'เพิ่มความชัดเมื่อใช้ในพื้นที่สว่าง' : 'Clearer display in bright venues'}</small></span><input type="checkbox" checked={settings?.highContrast ?? false} onChange={e => settings && void update({ ...settings, highContrast: e.target.checked })}/></label><label className="switch"><span>{th ? 'เปิดเต็มหน้าจอเมื่อเริ่มแอป' : 'Start in fullscreen'}<small>{th ? 'กด Esc เพื่อออกจากเต็มหน้าจอ' : 'Press Esc to exit fullscreen'}</small></span><input type="checkbox" checked={settings?.fullscreen ?? false} onChange={e => settings && void update({ ...settings, fullscreen: e.target.checked })}/></label></section><section className="storage-settings"><div><strong>{th ? 'โฟลเดอร์เก็บภาพ' : 'Photo storage folder'}</strong><p>{photoStorage?.configured ? (th ? 'เลือกแล้ว: ' + photoStorage.directoryName : 'Selected: ' + photoStorage.directoryName) : (th ? 'ยังไม่ได้เลือกโฟลเดอร์' : 'No folder selected')}</p>{photoStorage?.configured && <small>{th ? 'บันทึกแล้ว ' + photoStorage.photoCount + ' ภาพ' : photoStorage.photoCount + ' saved photo(s)'}{photoStorage.needsAttention && <span className="storage-warning">{th ? ' · ต้องตรวจสอบไฟล์กู้คืน ' + photoStorage.pendingRecovery + ' รายการ' : ' · Recovery needs attention (' + photoStorage.pendingRecovery + ')'}</span>}</small>}</div><button className="camera-secondary" onClick={() => void choosePhotoStorage()} disabled={choosingStorage}>{choosingStorage ? (th ? 'กำลังเลือก…' : 'Choosing…') : (th ? 'เลือกโฟลเดอร์' : 'Choose folder')}</button><p>{th ? 'ภาพจะไม่ถูกบันทึกจนกว่าจะเลือกโฟลเดอร์นี้' : 'Photos will not be saved until a folder is selected.'}</p></section><CameraFolderWatchSettings th={th} storageReady={Boolean(photoStorage?.configured)} onMessage={setMessage} /><KokoMemorySettings th={th} onMessage={setMessage} /><section className="diagnostics-link"><div><strong>{th ? 'การวินิจฉัยอุปกรณ์' : 'Device diagnostics'}</strong><p>{th ? 'ตรวจสอบกล้องและสิทธิ์การเข้าถึง' : 'Inspect cameras and device permissions.'}</p></div><button className="camera-secondary" onClick={() => { setDeviceDiagnostics(true); setMessage(''); }}> {th ? 'เปิดการวินิจฉัย' : 'Open diagnostics'} →</button></section></>}</>
        : page === 'account' ? <><p className="eyebrow">KOKO / ACCOUNT</p><h1>{th ? 'บัญชีและ License' : 'Account & License'}</h1><p className="lead">{th ? 'ตรวจสอบสิทธิ์และเปิดใช้ License จากบริการของ KOKO' : 'Check your entitlement and activate a license with the KOKO service.'}</p><section className="account-state"><div className="account-state-icon">◉</div><div><span className={`status-dot ${license?.state === 'active' ? 'good' : 'neutral'}`}>{licenseLoading ? (th ? 'กำลังตรวจสอบ' : 'Checking') : license?.state ?? 'server_error'}</span><h2>{license?.state === 'active' ? (th ? 'License ใช้งานได้' : 'License active') : license?.state === 'offline_grace' ? (th ? 'ใช้งานในช่วง Offline Grace' : 'Offline grace is active') : license?.state === 'expired' ? (th ? 'License หมดอายุ' : 'License expired') : license?.state === 'device_limit' ? (th ? 'ใช้ครบจำนวนเครื่องแล้ว' : 'Device limit reached') : license?.state === 'revoked' ? (th ? 'License ถูกเพิกถอน' : 'License revoked') : (th ? 'ยังยืนยันสิทธิ์ไม่ได้' : 'Entitlement is unverified')}</h2><p>{license?.state === 'active' || license?.state === 'offline_grace' ? (th ? `ฟีเจอร์ที่อนุญาต: ${license.features.join(', ') || '—'}` : `Allowed features: ${license.features.join(', ') || '—'}`) : (th ? 'Capture Studio จะเปิดเมื่อ Main ตรวจลายเซ็นและสถานะจาก License Server แล้วเท่านั้น' : 'Capture Studio opens only after Electron Main verifies the server signed entitlement.')}</p><p className="muted">{th ? `หมดอายุ: ${license?.expiresAt ?? 'ไม่ระบุ'} · ใช้ Offline ถึง: ${license?.offlineUntil ?? '—'}` : `Expires: ${license?.expiresAt ?? 'none'} · Offline until: ${license?.offlineUntil ?? '—'}`}</p></div></section><section className="activate-card"><h2>{th ? 'เปิดใช้ License Key' : 'Activate a license key'}</h2><p>{th ? 'ระบบจะส่ง Key ไปตรวจสอบกับ License Server และรับ entitlement ที่ลงลายเซ็นจาก Server' : 'The key is verified by the License Server, which returns a signed entitlement.'}</p><form onSubmit={event => { event.preventDefault(); void activateLicense(); }}><label>{th ? 'License Key' : 'License key'}<input value={licenseKey} onChange={event => setLicenseKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={256} placeholder="KOKO-XXXX-XXXX-XXXX" /></label><button className="primary" type="submit" disabled={activatingLicense || licenseKey.trim().length < 8}>{activatingLicense ? (th ? 'กำลังตรวจสอบ…' : 'Verifying…') : (th ? 'ตรวจสอบและเปิดใช้' : 'Verify & activate')}</button></form>{licenseError && <p className="activation-error" role="alert">{licenseError}</p>}</section><section className="plan-state"><div><span className="card-icon violet">✦</span><h2>{th ? 'แผนการใช้งาน' : 'Available plans'}</h2><p>{licensePlansLoading ? (th ? 'กำลังโหลดแผนจาก License Server…' : 'Loading plans from License Server…') : licensePlans.length ? (th ? 'ราคาและสิทธิ์ต่ออายุจากการตั้งค่าฝั่ง Server' : 'Plan prices and entitlements are served by the backend.') : (th ? 'ขณะนี้โหลดแผนจาก License Server ไม่ได้' : 'Plans are currently unavailable from the License Server.')}</p>{licensePlans.map(plan => <p className="muted" key={plan.id}>{plan.name} · {(plan.amountMinor / 100).toLocaleString(th ? 'th-TH' : 'en-US', { style: 'currency', currency: plan.currency })} · {plan.deviceLimit} {th ? 'อุปกรณ์' : 'devices'}</p>)}</div><span className={`status-dot ${licensePlans.length ? 'good' : 'neutral'}`}>{licensePlansLoading ? (th ? 'กำลังโหลด' : 'Loading') : licensePlans.length ? (th ? 'จาก Server' : 'Server plans') : (th ? 'ไม่พร้อมใช้งาน' : 'Unavailable')}</span></section><div className="account-links"><button onClick={() => go('help')}>{th ? 'ศูนย์ช่วยเหลือ' : 'Help Center'} <span>→</span></button><button onClick={() => go('gallery')}>{th ? 'คลังภาพและการกู้คืน' : 'Photo access & recovery'} <span>→</span></button>{license?.state === 'active' && <button disabled={deactivatingLicense} onClick={() => void deactivateLicense()}>{deactivatingLicense ? (th ? 'กำลังยกเลิก…' : 'Deactivating…') : (th ? 'ยกเลิกการผูกอุปกรณ์นี้' : 'Deactivate this device')} <span>↗</span></button>}</div></>
        : page === 'help' ? <><p className="eyebrow">KOKO / HELP</p><h1>{th ? 'ศูนย์ช่วยเหลือ' : 'Help Center'}</h1><p className="lead">{th ? 'แนวทางช่วยเหลือในเครื่อง' : 'Local support information.'}</p><section className="account-state"><div className="account-state-icon">?</div><div><h2>{th ? 'ต้องการความช่วยเหลือ?' : 'Need help?'}</h2><p>{th ? 'ตรวจสอบกล้องและพื้นที่จัดเก็บได้ที่ ตั้งค่า > ตรวจสอบอุปกรณ์ และ ตั้งค่าแอป หากมีปัญหาให้บันทึกข้อความผิดพลาดที่เห็นไว้สำหรับทีมสนับสนุน' : 'Check your camera in Settings > Device Diagnostics and review your storage settings. Keep any error message for support.'}</p></div></section></>
        : page === 'gallery' ? <><p className="eyebrow">KOKO / GALLERY</p><div className="gallery-title-row"><div><h1>{th ? 'คลังภาพ' : 'Gallery'}</h1><p className="lead">{th ? 'ภาพที่บันทึกไว้ในเครื่องนี้ ใช้งานได้แม้ไม่มี License หรืออินเทอร์เน็ต' : 'Photos saved on this device remain available without a license or internet connection.'}</p></div><span className="gallery-count">{photos.length}{hasMorePhotos ? '+' : ''} {th ? 'ภาพ' : 'photos'}</span></div>
          <div className="gallery-event-filter"><label>{th ? 'แสดงภาพ' : 'Show photos'}<select value={galleryEventFilter} onChange={event => setGalleryEventFilter(event.target.value)}><option value="all">{th ? 'ทุก Event' : 'All photos'}</option><option value="unassigned">{th ? 'ยังไม่ผูก Event' : 'Unassigned'}</option>{eventData.events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{eventData.activeEventId && <span>{th ? 'Event ที่กำลังถ่าย' : 'Active capture event'}: {eventData.events.find(item => item.id === eventData.activeEventId)?.name}</span>}</div>{(photoStorage?.needsAttention || recoveryIssues.length > 0) && <div className="recovery-banner"><span>!</span><div className="recovery-copy"><strong>{th ? 'ต้องตรวจสอบพื้นที่จัดเก็บ' : 'Storage needs attention'}</strong><small>{th ? `พบรายการตรวจสอบ ${recoveryIssues.length || photoStorage?.pendingRecovery || 0} รายการ ภาพที่สมบูรณ์ยังเปิดและส่งออกได้` : `${recoveryIssues.length || photoStorage?.pendingRecovery || 0} item(s) need review. Verified photos remain available for viewing and export.`}</small>{showRecoveryDetails && <div className="recovery-details" aria-live="polite">{recoveryLoading ? <span>{th ? 'กำลังตรวจสอบ…' : 'Inspecting storage…'}</span> : recoveryIssues.length ? recoveryIssues.slice(0, 20).map((issue, index) => <div key={`${issue.kind}-${issue.id ?? index}`}><strong>{issue.kind === 'orphan-photo' ? (th ? 'พบ JPEG ที่ยังไม่อยู่ในคลัง' : 'Unindexed JPEG found') : issue.kind === 'incomplete-write' ? (th ? 'พบไฟล์เขียนไม่สมบูรณ์' : 'Incomplete photo write') : issue.kind === 'index-temp' ? (th ? 'พบไฟล์ดัชนีชั่วคราว' : 'Temporary index file') : issue.kind === 'missing-photo' ? (th ? 'ไม่พบไฟล์ของภาพในคลัง' : 'Library photo file is missing or has changed') : issue.kind === 'invalid-index' ? (th ? 'ดัชนีคลังภาพเสียหาย' : 'Photo index is invalid') : (th ? 'เปิดพื้นที่จัดเก็บไม่ได้' : 'Storage could not be inspected')}</strong>{issue.id && <code>{issue.id}</code>}{issue.kind === 'orphan-photo' && issue.id && <button type="button" onClick={() => void importRecoveredPhoto(issue.id!)} disabled={recoveringPhotoId === issue.id}>{recoveringPhotoId === issue.id ? (th ? 'กำลังตรวจ…' : 'Checking…') : (th ? 'ตรวจและนำเข้า' : 'Verify & import')}</button>}{(issue.kind === 'incomplete-write' || issue.kind === 'index-temp') && issue.token && <button type="button" onClick={() => void quarantineRecoveryItem(issue.kind as 'incomplete-write' | 'index-temp', issue.token!)} disabled={recoveringPhotoId === issue.token}>{recoveringPhotoId === issue.token ? (th ? 'กำลังย้าย…' : 'Moving…') : (th ? 'ย้ายไปกักกัน' : 'Quarantine')}</button>}{issue.kind === 'invalid-index' && <button type="button" onClick={() => void rebuildPhotoIndex()} disabled={recoveringPhotoId === 'rebuild-index'}>{recoveringPhotoId === 'rebuild-index' ? (th ? 'กำลังสร้าง…' : 'Rebuilding…') : (th ? 'ตรวจและสร้างดัชนีใหม่' : 'Verify & rebuild index')}</button>}</div>) : <span>{th ? 'ไม่พบรายการกู้คืนที่ต้องดำเนินการ' : 'No recovery items were found.'}</span>}{recoveryIssues.length > 20 && <span>{th ? `แสดง 20 จาก ${recoveryIssues.length} รายการ` : `Showing 20 of ${recoveryIssues.length} items`}</span>}<small>{th ? 'ดัชนีเดิมและไฟล์ชั่วคราวจะถูกเก็บใน recovery-quarantine ภาพที่กู้คืนจะไม่ผูก Event' : 'The original index and temporary files are preserved in recovery-quarantine. Rebuilt photos remain unassigned to events.'}</small></div>}</div><button onClick={() => setShowRecoveryDetails(value => !value)}>{showRecoveryDetails ? (th ? 'ซ่อน' : 'Hide') : (th ? 'ตรวจรายการ' : 'Inspect items')} {showRecoveryDetails ? '↑' : '→'}</button></div>}
          {libraryLoading && photos.length === 0 ? <section className="empty-state"><span className="loading-mark">◌</span><h2>{th ? 'กำลังโหลดคลังภาพ' : 'Loading your library'}</h2><p>{th ? 'กำลังตรวจสอบรายการภาพที่บันทึกไว้' : 'Checking your locally saved photos.'}</p></section> : libraryError ? <section className="empty-state error-state"><span>!</span><h2>{th ? 'เปิดคลังภาพไม่ได้' : 'Library unavailable'}</h2><p>{libraryError}</p><button className="camera-secondary" onClick={() => { setLibraryError(''); setPage('dashboard'); setTimeout(() => setPage('gallery'), 0); }}>{th ? 'ลองอีกครั้ง' : 'Try again'}</button></section> : photos.length === 0 ? <section className="empty-state"><span>▧</span><h2>{th ? 'ยังไม่มีภาพที่บันทึกไว้' : 'No saved photos yet'}</h2><p>{photoStorage?.configured ? (th ? 'ภาพที่บันทึกสำเร็จจะแสดงที่นี่ ภาพจะอยู่ในโฟลเดอร์จัดเก็บของคุณ' : 'Photos that are saved successfully will appear here and remain in your selected storage folder.') : (th ? 'เลือกโฟลเดอร์จัดเก็บเพื่อเตรียมพื้นที่สำหรับภาพของคุณ' : 'Choose a storage folder to prepare a place for your photos.')}</p><button className="camera-secondary" onClick={() => go('settings')}>{th ? 'ตั้งค่าพื้นที่จัดเก็บ' : 'Storage settings'} →</button></section> : <><div className="photo-grid">{photos.map(photo => <article className="photo-card" key={photo.id}><button className="photo-thumb" onClick={event => { lastPhotoButton.current = event.currentTarget; setActivePhoto(photo); }} aria-label={th ? 'เปิดดูภาพ' : 'Preview photo'}><PhotoThumb photo={photo} /><small>{photo.width} × {photo.height}</small></button><div className="photo-info"><strong>{new Date(photo.savedAt).toLocaleString(th ? 'th-TH' : 'en-US')}</strong><small>{(photo.byteLength / 1024 / 1024).toFixed(1)} MB · JPEG</small><button className="export-button" onClick={() => void exportPhoto(photo)} disabled={exportingId === photo.id}>{exportingId === photo.id ? (th ? 'กำลังส่งออก…' : 'Exporting…') : (th ? 'ส่งออกภาพ' : 'Export photo')} ↓</button></div></article>)}</div>{hasMorePhotos && <div className="load-more"><button className="camera-secondary" onClick={() => void loadMorePhotos()} disabled={libraryLoading}>{libraryLoading ? (th ? 'กำลังโหลด…' : 'Loading…') : (th ? 'โหลดภาพเพิ่มเติม' : 'Load more photos')}</button></div>}</>}
        </> : page === 'sessions' ? <CaptureSessionsPage sessions={captureSessions} th={th} onOpenPhoto={photo => setActivePhoto(photo)} onLoadMore={() => void loadMoreSessions()} hasMore={sessionsHasMore} loadingMore={sessionsLoadingMore} /> : page === 'events' ? <EventsPage events={eventData.events} activeEventId={eventData.activeEventId} onRefresh={refreshEventData} onMessage={setMessage} th={th} /> : page === 'templates' || page === 'printing' ? <TemplatesPage photos={photos} th={th} onMessage={setMessage} onUseTemplate={setGuestTemplate} printEnabled={page === 'printing'} /> : <><p className="eyebrow">KOKO / {page.toUpperCase()}</p><h1>{th ? 'หน้าจอแขก' : 'Guest preview'}</h1><GuestPreviewPage th={th} active={guestDisplayActive} displays={availableGuestDisplays} selectedDisplayId={selectedGuestDisplayId} onSelectDisplay={setSelectedGuestDisplayId} onOpenDisplay={() => void openGuestDisplay()} onCloseDisplay={() => void window.koko.closeGuestDisplay().then(() => setGuestDisplayActive(false))} onGuestMode={() => void guest()} /></>}
        </main>{activePhoto && <div className="photo-modal-backdrop" role="presentation" onClick={closePhotoPreview}><section className="photo-modal" role="dialog" aria-modal="true" aria-label={th ? 'ตัวอย่างภาพ' : 'Photo preview'} onClick={event => event.stopPropagation()}><button ref={modalCloseButton} className="modal-close" onClick={closePhotoPreview} aria-label={th ? 'ปิด' : 'Close'}>×</button>{previewError ? <div className="modal-error" role="alert">{previewError}</div> : previewUrl ? <img src={previewUrl} alt={th ? 'ภาพที่บันทึกไว้' : 'Saved photo'} /> : <div className="modal-loading">{th ? 'กำลังเปิดภาพ…' : 'Opening photo…'}</div>}<div className="modal-caption"><span>{activePhoto.width} × {activePhoto.height} · {new Date(activePhoto.savedAt).toLocaleString(th ? 'th-TH' : 'en-US')}</span><div className="modal-actions"><button className="camera-secondary" onClick={() => { setActivePhoto(null); go('studio'); }}>{th ? 'ถ่ายใหม่' : 'Retake'}</button><button className="camera-secondary delete-button" onClick={() => void deletePhoto(activePhoto)} disabled={deletingId === activePhoto.id}>{deletingId === activePhoto.id ? (th ? 'กำลังย้าย…' : 'Moving…') : (th ? 'ลบภาพ' : 'Delete')}</button><button className="primary" onClick={() => void exportPhoto(activePhoto)} disabled={deletingId === activePhoto.id || exportingId === activePhoto.id}>{exportingId === activePhoto.id ? (th ? 'กำลังส่งออก…' : 'Exporting…') : (th ? 'ส่งออกภาพ' : 'Export photo')} ↓</button></div></div></section></div>}<footer><span><i className="footer-indicator" />{th ? 'ทำงานในเครื่อง' : 'Running locally'}</span><span>{th ? `กล้อง: ${statusLabel[cameraState]} · v${status?.version ?? '…'}` : `Camera: ${statusLabel[cameraState]} · v${status?.version ?? '…'}`}</span></footer>
      </div>
    </div> : <main className="guest guest-capture"><header className="guest-toolbar"><div className="guest-brand-lockup"><img src="/koko-studio-mark.png" alt="" /><span><span className="brand-wordmark" lang="en">KOKO</span><span className="brand-subtitle">STUDIO / PHOTOBOOTH</span></span></div><button className="camera-secondary" onClick={() => { setMode('operator'); void window.koko.setFullscreen(false); }}>{th ? 'กลับไปหน้าควบคุม' : 'Back to controls'}</button></header><div className="guest-heading"><p className="eyebrow">{th ? 'โหมดถ่ายภาพ' : 'GUEST PHOTO SESSION'}</p><h1>{eventData.events.find(item => item.id === eventData.activeEventId)?.name ?? (th ? 'ช่วงเวลาของคุณ เริ่มที่นี่' : 'Your moment starts here')}</h1><p>{guestTemplate ? `${th ? 'เทมเพลต' : 'Template'}: ${guestTemplate.name} · ${guestTemplate.count} ${th ? 'ภาพต่อรอบ' : guestTemplate.count === 1 ? 'photo per round' : 'photos per round'}` : (th ? 'จัดภาพให้พร้อม แล้วกดถ่ายภาพเมื่อคุณพร้อม' : 'Get into position, then capture when you are ready.')}</p></div><CameraPanel th={th} guestMode guestTemplate={guestTemplate} guestDisplayActive={guestDisplayActive} availableGuestDisplays={availableGuestDisplays} selectedGuestDisplayId={selectedGuestDisplayId} onSelectGuestDisplay={setSelectedGuestDisplayId} onOpenGuestDisplay={() => void openGuestDisplay()} onStatus={setCameraState} onCapture={photo => void handleCaptureSaved(photo)} onVideoCapture={video => void handleVideoSaved(video)} storageReady={Boolean(photoStorage?.configured)} storageName={photoStorage?.directoryName} activeEventName={eventData.events.find(item => item.id === eventData.activeEventId)?.name ?? null} photos={photos} onOpenPhoto={photo => setActivePhoto(photo)} onDeletePhoto={photo => void deletePhoto(photo)} onExportPhoto={photo => void exportPhoto(photo)} onOpenStorage={() => void openPhotoStorageFolder()} onOpenGallery={() => { setMode('operator'); void window.koko.setFullscreen(false); go('gallery'); }} onOpenSettings={() => { setMode('operator'); void window.koko.setFullscreen(false); setDeviceDiagnostics(true); go('settings'); }} /></main>}
    {(message || status?.lastError) && <div className="notice" role="status">{message || status?.lastError}</div>}
  </div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(new URLSearchParams(window.location.search).get('guestDisplay') === '1' ? <GuestDisplay /> : <App />);




