import { useEffect, useState } from 'react';
import type { CameraFolderWatchStatus, CameraUsbStatus, KokoMemoryStatus } from '../shared/contract';

export function CameraUsbSettings({ th, storageReady, onMessage }: { th: boolean; storageReady: boolean; onMessage: (value: string) => void }) {
  const [usb, setUsb] = useState<CameraUsbStatus>({ enabled: false, camera: null, state: 'off', importedCount: 0, lastError: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.koko.getCameraUsbStatus().then(setUsb).catch(() => undefined); }, []);
  useEffect(() => {
    if (!usb.enabled) return;
    const timer = window.setInterval(() => { void window.koko.getCameraUsbStatus().then(setUsb).catch(() => undefined); }, 2000);
    return () => window.clearInterval(timer);
  }, [usb.enabled]);
  async function toggle() {
    setBusy(true);
    try { setUsb(usb.enabled ? await window.koko.stopCameraUsb() : await window.koko.startCameraUsb()); }
    catch (error) { onMessage(error instanceof Error ? error.message : (th ? 'เปิดการดึงภาพผ่าน USB ไม่สำเร็จ' : 'Could not start USB photo import.')); }
    finally { setBusy(false); }
  }
  const stateText = usb.state === 'ready' ? (th ? `พบกล้อง: ${usb.camera ?? ''}` : `Camera found: ${usb.camera ?? ''}`)
    : usb.state === 'busy' ? (th ? 'พบกล้องแต่เข้าถึงรูปไม่ได้ ปิดโปรแกรมอื่นที่ใช้กล้องอยู่ (เช่น EOS Webcam Utility) หรือปิดแล้วเปิดกล้องใหม่' : 'Camera found but its photos are not reachable. Close other programs using it (e.g. EOS Webcam Utility) or power-cycle the camera.')
    : usb.state === 'searching' ? (th ? 'กำลังหากล้องที่เสียบสาย USB…' : 'Looking for a USB camera…')
    : usb.state === 'error' ? (th ? 'หยุดทำงาน' : 'Stopped') : '';
  return <section className="storage-settings"><div><strong>{th ? 'ดึงภาพจากกล้องผ่าน USB' : 'USB camera photo import'}</strong><p>{th ? 'เสียบสาย USB แล้วกดชัตเตอร์ที่ตัวกล้อง ภาพเต็มความละเอียดจะเข้าคลังเอง ไม่ต้องลงโปรแกรมเพิ่ม (Windows)' : 'Plug the camera in by USB and press its shutter. Full-resolution photos arrive on their own, no extra software (Windows).'}</p>{usb.enabled && stateText && <small className={usb.state === 'busy' ? 'storage-warning' : undefined}>{stateText}</small>}{usb.enabled && <small>{th ? `นำเข้าแล้ว ${usb.importedCount} ภาพ · ภาพที่มีอยู่ในกล้องก่อนเริ่มจะไม่ถูกดึง` : `${usb.importedCount} photo(s) imported · photos already on the card are skipped`}</small>}{usb.lastError && <small className="storage-warning">{usb.lastError}</small>}</div><button className="camera-secondary" onClick={() => void toggle()} disabled={busy || (!storageReady && !usb.enabled)}>{busy ? (th ? 'กำลังตั้งค่า…' : 'Working…') : usb.enabled ? (th ? 'หยุด' : 'Stop') : (th ? 'เริ่มดึงภาพผ่าน USB' : 'Start USB import')}</button></section>;
}

export function CameraFolderWatchSettings({ th, storageReady, onMessage }: { th: boolean; storageReady: boolean; onMessage: (value: string) => void }) {
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

export function KokoMemorySettings({ th, onMessage }: { th: boolean; onMessage: (value: string) => void }) {
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

export function ReportProblem({ th }: { th: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const send = async () => {
    setBusy(true); setResult('');
    try {
      const { body, opened } = await window.koko.reportProblem(text);
      await navigator.clipboard.writeText(body).catch(() => undefined);
      setResult(opened ? (th ? 'เปิดอีเมลแล้ว และคัดลอกข้อความไว้ให้ ถ้าไม่มีโปรแกรมอีเมล ให้วางข้อความส่งไปที่ kokomemory@gmail.com' : 'Opened your email app and copied the text. If you have no email app, paste it into an email to kokomemory@gmail.com') : (th ? 'คัดลอกข้อความแล้ว วางส่งอีเมลไปที่ kokomemory@gmail.com' : 'Copied. Paste it into an email to kokomemory@gmail.com'));
    } catch (error) { setResult(error instanceof Error ? error.message : (th ? 'ทำรายการไม่สำเร็จ' : 'Could not prepare the report')); }
    finally { setBusy(false); }
  };
  return <section className="account-state"><div><h2>{th ? 'แจ้งปัญหา' : 'Report a problem'}</h2>
    <p>{th ? 'บอกว่าเกิดอะไรขึ้น ระบบจะแนบเฉพาะเวอร์ชันแอป ระบบปฏิบัติการ และสถานะ License ไม่แนบรูปภาพ รหัส License หรือรหัสเครื่อง' : 'Tell us what happened. Only the app version, operating system and license state are added. No photos, license key or device ID.'}</p>
    <textarea rows={4} maxLength={1000} value={text} onChange={e => setText(e.target.value)} aria-label={th ? 'รายละเอียดปัญหา' : 'Problem details'} style={{ width: '100%' }} />
    <button className="primary" type="button" disabled={busy} onClick={() => void send()}>{th ? 'เตรียมอีเมลแจ้งปัญหา' : 'Prepare problem report'}</button>
    {result && <p role="status">{result}</p>}
  </div></section>;
}

export function GuestExitPinSettings({ th, configured, onConfigured, onMessage }: { th: boolean; configured: boolean; onConfigured: (value: boolean) => void; onMessage: (value: string) => void }) {
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(remove = false) {
    setError('');
    if (!remove && nextPin !== confirmPin) { setError(th ? 'PIN ใหม่ไม่ตรงกัน' : 'The new PINs do not match.'); return; }
    if (!remove && !/^\d{4,12}$/.test(nextPin)) { setError(th ? 'PIN ต้องเป็นตัวเลข 4–12 หลัก' : 'PIN must contain 4 to 12 digits.'); return; }
    setBusy(true);
    try {
      const saved = await window.koko.setGuestExitPin(configured ? currentPin : null, remove ? null : nextPin);
      if (!saved) { setError(th ? 'PIN ปัจจุบันไม่ถูกต้อง หรือถูกพักชั่วคราว' : 'Current PIN is incorrect or temporarily locked.'); return; }
      onConfigured(!remove);
      setCurrentPin(''); setNextPin(''); setConfirmPin('');
      onMessage(remove ? (th ? 'ลบ PIN แล้ว จะเริ่มโหมดแขกไม่ได้จนกว่าจะตั้ง PIN ใหม่' : 'PIN removed. Set a new PIN before starting Guest mode.') : (th ? 'บันทึก PIN สำหรับออกจากโหมดแขกแล้ว' : 'Guest exit PIN saved.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : (th ? 'บันทึก PIN ไม่สำเร็จ' : 'Could not save PIN.')); }
    finally { setBusy(false); }
  }
  return <section className="storage-settings guest-pin-settings"><div><strong>{th ? 'PIN ออกจากโหมดแขก' : 'Guest mode exit PIN'}</strong><p>{configured ? (th ? 'ตั้ง PIN แล้ว ต้องใส่ PIN เพื่อกลับไปหน้าควบคุม' : 'A PIN is set. Operators must enter it to leave Guest mode.') : (th ? 'ตั้ง PIN ก่อนเปิดโหมดแขก เพื่อป้องกันแขกกลับไปหน้าควบคุม' : 'Set a PIN before Guest mode to prevent guests from returning to operator controls.')}</p><small>{th ? 'เก็บเฉพาะค่า hash ในเครื่อง และจำกัดการลอง PIN ผิด' : 'Only a salted hash is stored on this computer. Failed attempts are rate limited.'}</small>{configured && <label>{th ? 'PIN ปัจจุบัน' : 'Current PIN'}<input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={currentPin} onChange={event => setCurrentPin(event.target.value.replace(/\D/g, ''))} /></label>}{!configured && <label>{th ? 'PIN ใหม่ (4–12 หลัก)' : 'New PIN (4–12 digits)'}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={nextPin} onChange={event => setNextPin(event.target.value.replace(/\D/g, ''))} /></label>}{configured && <label>{th ? 'PIN ใหม่ (4–12 หลัก)' : 'New PIN (4–12 digits)'}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={nextPin} onChange={event => setNextPin(event.target.value.replace(/\D/g, ''))} placeholder={th ? 'เว้นว่างไม่ได้ หากต้องการเปลี่ยน PIN' : 'Enter a new PIN to change it'} /></label>}{nextPin && <label>{th ? 'ยืนยัน PIN ใหม่' : 'Confirm new PIN'}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={confirmPin} onChange={event => setConfirmPin(event.target.value.replace(/\D/g, ''))} /></label>}{error && <small className="storage-warning" role="alert">{error}</small>}</div><div className="guest-pin-actions"><button className="camera-secondary" type="button" disabled={busy || (configured ? currentPin.length < 4 || nextPin.length < 4 || confirmPin.length < 4 : nextPin.length < 4)} onClick={() => void save()}>{busy ? (th ? 'กำลังบันทึก…' : 'Saving…') : configured ? (th ? 'เปลี่ยน PIN' : 'Change PIN') : (th ? 'ตั้ง PIN' : 'Set PIN')}</button>{configured && <button className="camera-secondary" type="button" disabled={busy || currentPin.length < 4} onClick={() => void save(true)}>{th ? 'ลบ PIN' : 'Remove PIN'}</button>}</div></section>;
}

