import React, { useEffect, useRef, useState } from 'react';
import { printGuestReceipt } from './receipt';
import QRCode from 'qrcode';
import { MIN_FREE_PHOTO_STORAGE_BYTES } from '../shared/contract';
import type { PhotoRecord, SavedPhoto, SavedVideo, Settings, GuestDisplayPayload } from '../shared/contract';
import { CameraError, type CameraDevice, type CameraStatus } from './camera/camera-adapter';
import { waitForCaptureDelay } from './camera/capture-delay';
import { Icon } from './icons';
import { drawComposition } from './templates';
import { friendlyErrorText } from './error-text';
import { type GuestTemplate } from './templates';
import { normalizedRectToPixels } from './template-layout';
import { drawImageLayers, drawTextLayers, loadImageLayers } from './template-layers';
import { ensureFonts, fontStack } from './fonts';
import { cameraManager, hasLowPhotoStorage, formatStorageSpace, PhotoThumb } from './ui-common';

export function CameraPanel({ th, onStatus, onCapture, onVideoCapture, storageReady = false, storageAvailableBytes = null, photos = [], onOpenPhoto, onDeletePhoto, onExportPhoto, onOpenStorage, onOpenGallery, onOpenSettings, onOpenPrint, onOpenGuestDisplay, guestDisplayActive = false, availableGuestDisplays = [], selectedGuestDisplayId = null, onSelectGuestDisplay, storageName = null, activeEventName = null, guestMode = false, guestTemplate = null }: {
  th: boolean; onStatus?: (status: CameraStatus) => void; onCapture?: (photo: SavedPhoto) => void | Promise<void>; onVideoCapture?: (video: SavedVideo) => void | Promise<void>; storageReady?: boolean;
  storageAvailableBytes?: number | null;
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
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>(() => guestMode && guestTemplate?.mediaMode === 'video' ? 'video' : 'photo');
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
  const [roundIncomplete, setRoundIncomplete] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [roundPhotoIds, setRoundPhotoIds] = useState<string[]>([]);
  const [roundSessionId, setRoundSessionId] = useState('');
  const roundSessionIdRef = useRef('');
  const [roundShareUrl, setRoundShareUrl] = useState('');
  const [receiptSettings, setReceiptSettings] = useState<{ ready: boolean; auto: boolean }>({ ready: false, auto: false });
  const [receiptCopies, setReceiptCopies] = useState(1);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const receiptPrintedRef = useRef(new Set<string>());
  useEffect(() => { void window.koko.getReceiptSettings().then(value => { setReceiptSettings({ ready: value.printer !== null, auto: value.autoPrint }); setReceiptCopies(value.copies); }).catch(() => undefined); }, [reviewing]);
  /** Prints the guest slip once per round; later calls for the same round do nothing unless the operator asks again. */
  async function printReceipt(sessionId: string, manual: boolean) {
    if (!manual && receiptPrintedRef.current.has(sessionId)) return;
    receiptPrintedRef.current.add(sessionId);
    setReceiptBusy(true);
    try { await printGuestReceipt(sessionId, activeEventName, th, manual ? receiptCopies : undefined); if (manual) setCaptureNotice(th ? 'ส่งใบเสร็จไปที่เครื่องพิมพ์แล้ว' : 'Receipt sent to the printer'); }
    catch (error) { receiptPrintedRef.current.delete(sessionId); setCaptureNotice(error instanceof Error ? error.message : (th ? 'พิมพ์ใบเสร็จไม่สำเร็จ' : 'Could not print the receipt')); }
    finally { setReceiptBusy(false); }
  }
  const [roundCloudUploaded, setRoundCloudUploaded] = useState(false);
  const [cloudUnavailable, setCloudUnavailable] = useState(false);
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
  useEffect(() => { if (guestMode) { setPhotoCount(guestTemplate?.count ?? 1); setCaptureMode(guestTemplate?.mediaMode === 'video' ? 'video' : 'photo'); setVideoDuration(guestTemplate?.mediaMode === 'video' ? guestTemplate.videoSeconds ?? 10 : 10); } }, [guestMode, guestTemplate]);
  // Guests should never have to find a "start camera" button: open the preview as soon as a camera is found.
  useEffect(() => { if (guestMode && cameraState === 'detected' && !stream) void connect(selectedIdRef.current || undefined); }, [guestMode, cameraState, stream]);
  useEffect(() => {
    const status: GuestDisplayPayload['status'] = reviewing ? 'review' : countdownValue !== null ? 'countdown' : capturing || recordingVideo ? 'capturing' : cameraState === 'ready' ? 'ready' : cameraState === 'connecting' || cameraState === 'searching' ? 'connecting' : 'disconnected';
    const message = reviewing
      ? roundCloudUploaded && roundShareUrl ? (th ? 'สแกน QR เพื่อรับภาพและวิดีโอ' : 'Scan the QR to receive your photos and videos') : (th ? 'กำลังเตรียมผลงาน กรุณารอสักครู่' : 'Preparing your captures. Please wait.')
      : cameraState === 'ready' ? (th ? 'พร้อมแล้ว เริ่มถ่ายได้เลย' : 'Ready when you are') : (th ? 'กรุณารอเจ้าหน้าที่ตรวจสอบกล้อง' : 'Please wait while the attendant checks the camera');
    guestDisplayPayloadRef.current = {
      language: th ? 'th' : 'en', eventName: activeEventName ?? '', status, mediaMode: captureMode,
      countdown: countdownValue, resultCount: reviewing ? reviewCount : roundPhotoIds.length + (roundVideoId ? 1 : 0),
      previewDataUrl: guestDisplayPayloadRef.current.previewDataUrl,
      qrDataUrl: reviewing && roundShareUrl ? shareQrDataUrl : '', message
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
    if (!storageReady || storageSpaceLow) {
      setCaptureError(storageSpaceLow
        ? (th ? `พื้นที่ว่างน้อยกว่า ${formatStorageSpace(MIN_FREE_PHOTO_STORAGE_BYTES)} กรุณาเพิ่มพื้นที่ก่อนเริ่มถ่าย` : `Free space is below ${formatStorageSpace(MIN_FREE_PHOTO_STORAGE_BYTES)}. Make more room before capturing.`)
        : (th ? 'เลือกโฟลเดอร์เก็บภาพก่อนเริ่มถ่าย' : 'Choose a photo storage folder before capturing.'));
      return;
    }
    capturingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setCapturing(true);
    setCaptureError('');
    setCaptureNotice('');
    setRoundIncomplete(false);
    setRoundShareUrl('');
    setRoundCloudUploaded(false);
    setCloudUnavailable(false);
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
          await ensureFonts((guestTemplate.videoTextLayers ?? []).map(layer => layer.fontId));
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
            drawTextLayers(context, guestTemplate?.videoTextLayers, outputWidth, outputHeight, fontStack);
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
        setCloudUnavailable(result.cloudAvailable === false);
        if (result.shareUrl) void window.koko.getReceiptSettings().then(value => { if (value.autoPrint) void printReceipt(sessionId, false); }).catch(() => undefined);
      }).catch(() => undefined);
    } catch (error) {
      const reason = controller.signal.aborted
        ? (th ? 'ยกเลิกรอบถ่ายแล้ว' : 'Capture session canceled')
        : (error instanceof Error ? friendlyErrorText(error.message, th) : (th ? 'ถ่ายไม่สำเร็จ' : 'Capture could not be completed'));
      if ((savedPhotoIds.length || savedVideoId) && sessionId) {
        try { await window.koko.completeCaptureSession(sessionId, 'review'); sessionFinished = true; } catch { /* Keep the saved photos accessible even if session bookkeeping fails. */ }
        setReviewCount(savedPhotoIds.length + (savedVideoId ? 1 : 0));
        setRoundIncomplete(!controller.signal.aborted);
        setReviewing(true);
        void window.koko.syncPhotoCloudSession(sessionId).then(result => {
          if (roundSessionIdRef.current !== sessionId) return;
          setRoundShareUrl(result.shareUrl ?? '');
          setRoundCloudUploaded(result.mediaCount > 0 && result.uploadedCount === result.mediaCount);
          setCloudUnavailable(result.cloudAvailable === false);
          if (result.shareUrl) void window.koko.getReceiptSettings().then(value => { if (value.autoPrint) void printReceipt(sessionId, false); }).catch(() => undefined);
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
      setCloudUnavailable(result.cloudAvailable === false);
      setCaptureNotice(complete
        ? (th ? 'อัปโหลดภาพและวิดีโอทั้งหมดแล้ว' : 'All photos and videos uploaded')
        : (th ? `อัปโหลดแล้ว ${result.uploadedCount}/${result.mediaCount} ไฟล์` : `Uploaded ${result.uploadedCount}/${result.mediaCount} media files`));
    } catch (error) {
      setCaptureNotice(error instanceof Error ? friendlyErrorText(error.message, th) : (th ? 'อัปโหลดภาพไม่สำเร็จ' : 'Photo upload failed'));
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
    if (guestMode) {
      // Hand the booth to the next guest with a clean screen instead of the previous guest's photos.
      setRoundPhotoIds([]);
      setRoundVideoId('');
      setRoundVideoUrl('');
      setGuestCompositionUrl('');
    }
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

  const storageSpaceLow = hasLowPhotoStorage(storageAvailableBytes);
  const captureDisabled = capturing || !storageReady || storageSpaceLow || cameraState !== 'ready';
  const roundPhotos = roundPhotoIds.map(id => photos.find(photo => photo.id === id)).filter((photo): photo is PhotoRecord => Boolean(photo));
  async function runSamplePhotoSession() {
    if (capturingRef.current || captureMode !== 'photo') return;
    if (!storageReady) { setCaptureError(th ? 'เลือกโฟลเดอร์เก็บภาพก่อนเริ่มโหมดทดลอง' : 'Choose a photo storage folder before starting the sample session.'); return; }
    if (storageSpaceLow) { setCaptureError(th ? `พื้นที่ว่างน้อยกว่า ${formatStorageSpace(MIN_FREE_PHOTO_STORAGE_BYTES)} กรุณาเพิ่มพื้นที่ก่อนเริ่มถ่าย` : `Free space is below ${formatStorageSpace(MIN_FREE_PHOTO_STORAGE_BYTES)}. Make more room before capturing.`); return; }
    capturingRef.current = true;
    setCapturing(true); setCaptureError(''); setCaptureNotice(''); setRoundIncomplete(false); setRoundShareUrl(''); setCloudUnavailable(false); setRoundCloudUploaded(false);
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
        const response = await fetch(new URL(`./demo/portrait-${['one', 'two', 'three', 'four'][index]}.svg`, window.location.href));
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
        setRoundShareUrl(result.shareUrl ?? ''); setRoundCloudUploaded(result.mediaCount > 0 && result.uploadedCount === result.mediaCount); setCloudUnavailable(result.cloudAvailable === false);
      }).catch(() => undefined);
      setCaptureNotice(th ? 'โหมดทดลองใช้ภาพตัวอย่าง ระบบบันทึกภาพลงคลังแล้ว' : 'Sample session complete. The images were saved to your library.');
    } catch (error) {
      const message = error instanceof Error ? friendlyErrorText(error.message, th) : (th ? 'โหมดทดลองทำงานไม่สำเร็จ' : 'Sample session could not be completed.');
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
  return <section className={`camera-panel ${onCapture ? 'studio-layout' : 'diagnostics-layout'} ${guestMode ? 'guest-camera-panel' : ''} ${guestMode && reviewing ? 'guest-reviewing' : ''}`} aria-label={th ? 'กล้อง' : 'Camera'}>
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
      {onCapture && !stream && captureMode === 'photo' && <section className="sample-session-card"><div><strong>{th ? 'ทดลองโดยไม่ใช้กล้อง' : 'Try a sample session'}</strong><small>{th ? 'ใช้ภาพตัวอย่างในแอป เพื่อทดสอบการบันทึก เทมเพลต คลังภาพ และอัลบั้ม' : 'Use built-in sample portraits to try saving, templates, the library, and private albums.'}</small></div><button className="camera-secondary" type="button" onClick={() => void runSamplePhotoSession()} disabled={!storageReady || storageSpaceLow || capturing || reviewing}>{capturing ? (th ? 'กำลังบันทึกตัวอย่าง…' : 'Saving samples…') : (th ? `เริ่มตัวอย่าง ${guestMode && guestTemplate ? guestTemplate.count : photoCount} ภาพ` : `Preview ${guestMode && guestTemplate ? guestTemplate.count : photoCount} sample photo(s)`)}</button></section>}
      {onCapture && <>
        {guestMode && reviewing && guestCompositionUrl && <section className="guest-composition"><img src={guestCompositionUrl} alt={th ? 'ภาพประกอบจากเทมเพลต' : 'Composed template image'} /><button type="button" className="camera-secondary" onClick={downloadComposition}>{th ? 'ดาวน์โหลดภาพประกอบ' : 'Download composed image'}</button></section>}
        <div className="capture-strip">
          <div className="strip-main"><div className="strip-heading"><span className="panel-kicker">{guestMode ? (th ? 'ภาพในรอบนี้' : 'THIS ROUND') : 'CAPTURE STRIP'}</span><small>{guestMode ? `${roundPhotos.length} ${th ? 'ภาพ' : roundPhotos.length === 1 ? 'photo' : 'photos'}` : photos.length ? `${photos.length} ${th ? 'ภาพล่าสุด' : 'recent photos'}` : (th ? 'ยังไม่มีภาพที่บันทึก' : 'No saved photos yet')}</small></div>
            {guestMode ? roundPhotos.length ? <div className="guest-round-grid">{roundPhotos.map(photo => <button className="guest-round-photo" key={photo.id} onClick={() => onOpenPhoto?.(photo)} aria-label={th ? 'ดูภาพที่ถ่ายในรอบนี้' : 'View a photo from this round'}><PhotoThumb photo={photo} /></button>)}</div> : <div className="strip-empty">{th ? 'ภาพที่ถ่ายในรอบนี้จะแสดงที่นี่' : 'Photos from this round will appear here.'}</div> : photos.length ? <div className="strip-photos">{photos.slice(0, 4).map(photo => <div className="strip-photo" key={photo.id}><button className="strip-thumb" onClick={() => onOpenPhoto?.(photo)} aria-label={th ? 'เปิดดูภาพ' : 'Preview photo'}><PhotoThumb photo={photo} /></button><div className="strip-photo-actions"><button onClick={() => onExportPhoto?.(photo)} title={th ? 'ส่งออกภาพ' : 'Export photo'} aria-label={th ? 'ส่งออกภาพ' : 'Export photo'}><Icon name="download" size={14} /></button><button onClick={() => onDeletePhoto?.(photo)} title={th ? 'ลบภาพ' : 'Delete photo'} aria-label={th ? 'ลบภาพ' : 'Delete photo'}><Icon name="close" size={14} /></button></div></div>)}</div> : <div className="strip-empty">{th ? 'ภาพที่ถ่ายสำเร็จจะแสดงที่นี่' : 'Photos from this session will appear here.'}</div>}
          </div>
          <div className="capture-actions"><button className={`capture-disc ${recordingVideo ? 'is-recording' : ''}`} onClick={activateCapture} disabled={(captureDisabled && !recordingVideo) || reviewing} aria-label={recordingVideo ? (th ? 'หยุดอัดวิดีโอ' : 'Stop video') : (captureMode === 'video' ? (th ? 'เริ่มอัดวิดีโอ' : 'Record video') : (th ? 'ถ่ายภาพ' : 'Capture'))}><span>{recordingVideo ? <i className="recording-mark" /> : capturing ? <span className="loading-mark">◌</span> : <Icon name="camera" size={27} />}</span></button><span className="capture-caption">{recordingVideo ? (th ? 'กำลังอัด · แตะเพื่อหยุด' : 'RECORDING · TAP TO STOP') : capturing ? (captureMode === 'photo' ? (th ? `${captureProgress || 1}/${photoCount} กำลังบันทึก` : `${captureProgress || 1}/${photoCount} SAVING`) : (th ? 'กำลังเตรียมวิดีโอ…' : 'PREPARING VIDEO…')) : captureMode === 'video' ? (th ? 'อัดวิดีโอ' : 'RECORD VIDEO') : (th ? 'ถ่ายภาพ' : 'CAPTURE')}</span>{!guestMode && <button className="export-latest" onClick={() => photos[0] && onExportPhoto?.(photos[0])} disabled={!photos.length}>{th ? 'ส่งออกล่าสุด' : 'Export latest'}</button>}</div>
        </div>
        {guestMode && reviewing && roundVideoUrl && <section className="guest-composition"><video controls playsInline src={roundVideoUrl} aria-label={th ? 'คลิปวิดีโอของคุณ' : 'Your recorded clip'} /><button type="button" className="camera-secondary" onClick={() => roundVideoId && void window.koko.exportVideo(roundVideoId)}>{th ? 'ส่งออกคลิปวิดีโอ' : 'Export video clip'} ↓</button></section>}
        {reviewing ? <div className="capture-feedback review-feedback" role="status"><div><strong>{guestMode ? (th ? 'ชอบภาพนี้ไหม' : 'Happy with it?') : (th ? 'ตรวจสอบผลงานของคุณ' : 'Review your capture')}</strong><span>{guestMode ? (th ? 'เลือก “ยืนยันจบรอบ” เพื่อเก็บภาพ หรือ “ถ่ายใหม่” เพื่อลองอีกครั้ง' : 'Tap Finish round to keep it, or Retake to try again.') : (th ? `บันทึกแล้ว ${reviewCount} รายการ · ไฟล์ต้นฉบับยังอยู่ในคลัง` : `${reviewCount} item(s) saved · original files stay in the library`)}</span></div>{guestMode && roundIncomplete && <span className="guest-review-warning" role="alert">{th ? 'ถ่ายได้ไม่ครบตามที่ตั้งไว้ กรุณาเลือก “ถ่ายใหม่” หรือแจ้งเจ้าหน้าที่' : 'Not every photo could be taken. Tap Retake to try again, or ask the staff.'}</span>}<div className="review-actions">{roundPhotos[0] && <button type="button" onClick={() => onOpenPhoto?.(roundPhotos[0])}>{th ? 'ดูภาพ' : 'View photo'}</button>}{roundVideoId && <button type="button" onClick={() => void window.koko.exportVideo(roundVideoId)}>{th ? 'บันทึกคลิป' : 'Save clip'}</button>}<button type="button" onClick={() => void retakeRound()}>{captureMode === 'video' ? (th ? 'อัดใหม่' : 'Record again') : (th ? 'ถ่ายใหม่' : 'Retake')}</button><button type="button" className="review-confirm" onClick={() => void confirmRound()}>{th ? 'ยืนยันจบรอบ' : 'Finish round'}</button></div></div> : (captureError || captureNotice || !storageReady) && <div className={`capture-feedback ${captureError ? 'has-error' : ''}`} role={captureError ? 'alert' : 'status'}>{captureError || captureNotice || (th ? 'เลือกโฟลเดอร์จัดเก็บใน Settings ก่อนเริ่ม' : 'Choose a storage folder in Settings before capturing.')}</div>}
        {reviewing && (roundPhotoIds.length > 0 || roundVideoId) && (!guestMode || roundShareUrl) && <div className="photo-cloud-share" role="status">{roundShareUrl ? <><span>{roundCloudUploaded ? (th ? 'อัปโหลดผลงานรอบนี้ไปยังอัลบั้มส่วนตัวแล้ว' : 'This session is uploaded to its private album.') : (th ? 'สแกนได้เลย — รูปกำลังอัปโหลดและจะขึ้นในหน้าเองเมื่อเน็ตพร้อม' : 'Scan now: photos are uploading and appear on the page by themselves.')}</span>{!roundCloudUploaded && !guestMode && <button type="button" onClick={() => void retryCloudUpload()} disabled={cloudSyncing}>{cloudSyncing ? (th ? 'กำลังอัปโหลด…' : 'Uploading…') : (th ? 'ลองอัปโหลดอีกครั้ง' : 'Retry upload')}</button>}<button type="button" onClick={() => void copyShareLink()}>{th ? 'คัดลอกลิงก์อัลบั้ม' : 'Copy private album link'} ↗</button>{receiptSettings.ready && !guestMode && <span className="receipt-print-controls"><button type="button" onClick={() => void printReceipt(roundSessionId, true)} disabled={receiptBusy}>{receiptBusy ? (th ? 'กำลังพิมพ์…' : 'Printing…') : (th ? `พิมพ์ใบเสร็จ QR × ${receiptCopies}` : `Print QR receipt × ${receiptCopies}`)}</button><button type="button" aria-label={th ? 'ลดจำนวนใบ' : 'Fewer slips'} onClick={() => setReceiptCopies(count => Math.max(1, count - 1))}>−</button><button type="button" aria-label={th ? 'เพิ่มจำนวนใบ' : 'More slips'} onClick={() => setReceiptCopies(count => Math.min(10, count + 1))}>+</button></span>}{shareQrDataUrl && <div className="private-album-qr"><img src={shareQrDataUrl} alt={th ? 'QR สำหรับเปิดอัลบั้มส่วนตัว' : 'QR code for this private album'} /><small>{th ? 'สแกนเพื่อดูและดาวน์โหลดภาพ/วิดีโอ' : 'Scan to view and download this session'}</small></div>}</> : cloudUnavailable ? <span>{th ? 'บันทึกในเครื่องแล้ว — แผนของคุณไม่รวมอัลบั้มออนไลน์' : 'Saved on this computer. Your plan does not include online albums.'}</span> : <><span>{th ? 'ผลงานอยู่ในเครื่องแล้ว — ยังอัปโหลดไม่ครบ' : 'Media is saved locally; cloud upload is incomplete.'}</span><button type="button" onClick={() => void retryCloudUpload()} disabled={cloudSyncing}>{cloudSyncing ? (th ? 'กำลังอัปโหลด…' : 'Uploading…') : (th ? 'ลองอัปโหลดอีกครั้ง' : 'Retry upload')}</button></>}{captureNotice && <span>{captureNotice}</span>}</div>}
          <div className="event-session-panel"><span className="event-icon"><Icon name="calendar" /></span><div className="event-copy"><span className="panel-kicker">EVENT SESSION</span><strong>{activeEventName || (th ? 'เซสชันในเครื่อง' : 'Local photo session')}</strong><small>{storageReady ? (th ? `โฟลเดอร์: ${storageName}` : `Folder: ${storageName}`) : (th ? 'ยังไม่ได้เลือกโฟลเดอร์จัดเก็บ' : 'No photo folder selected')}</small></div><button className="icon-button folder-action" onClick={storageReady ? onOpenStorage : onOpenSettings} title={storageReady ? (th ? 'เปิดโฟลเดอร์ภาพ' : 'Open photo folder') : (th ? 'เลือกโฟลเดอร์ภาพ' : 'Choose a photo folder')} aria-label={storageReady ? (th ? 'เปิดโฟลเดอร์ภาพ' : 'Open photo folder') : (th ? 'เลือกโฟลเดอร์ภาพ' : 'Choose a photo folder')}><Icon name={storageReady ? 'folder' : 'settings'} /></button><span className={`storage-ready ${storageReady ? 'is-ready' : ''}`}><i />{storageReady ? (th ? 'บันทึกพร้อม' : 'READY TO SAVE') : (th ? 'ตั้งค่าพื้นที่' : 'SET STORAGE')}</span></div>
      </>}
    </div>
    {onCapture && <aside className="studio-right">
      <section className="control-section capture-settings"><div className="section-heading"><span className="panel-kicker">CAPTURE SETTINGS</span><span className="control-mark"><Icon name="settings" size={15} /></span></div>
        <div className="setting-row"><span>{th ? 'ชนิดสื่อ' : 'Capture mode'}</span><div className="segmented-control" role="group" aria-label={th ? 'เลือกถ่ายภาพหรือวิดีโอ' : 'Choose photo or video'}>{(['photo', 'video'] as const).map(value => <button key={value} type="button" className={captureMode === value ? 'selected' : ''} aria-pressed={captureMode === value} disabled={capturing || reviewing} onClick={() => setCaptureMode(value)}>{value === 'photo' ? (th ? 'ภาพถ่าย' : 'Photo') : (th ? 'วิดีโอ' : 'Video')}</button>)}</div></div>
        {captureMode === 'photo' && <div className="setting-row"><span>{th ? 'จำนวนภาพ' : 'Photo count'}</span><div className="segmented-control" role="group" aria-label={th ? 'จำนวนภาพต่อชุด' : 'Photos per session'}>{[1, 2, 3, 4].map(count => <button key={count} type="button" className={photoCount === count ? 'selected' : ''} aria-pressed={photoCount === count} disabled={capturing} onClick={() => setPhotoCount(count)}>{count}<small>{th ? 'ภาพ' : count === 1 ? 'photo' : 'photos'}</small></button>)}</div></div>}
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
