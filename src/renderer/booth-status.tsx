import { useEffect, useState } from 'react';
import type { BoothStatus } from '../shared/contract';

/**
 * What staff need during an event, in one glance: is the internet up, are photos waiting to reach the cloud,
 * is the camera folder importing, is a receipt printer set up. Refreshes by itself.
 */
export function BoothStatusCard({ th, onOpenSettings }: { th: boolean; onOpenSettings: () => void }) {
  const [status, setStatus] = useState<BoothStatus | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => { void window.koko.getBoothStatus().then(value => { if (active) setStatus(value); }).catch(() => undefined); };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (!status) return null;
  const { cloud } = status;
  const waiting = cloud.waitingPhotos > 0 || cloud.unregisteredLinks > 0;
  const rows: Array<{ ok: boolean; label: string; value: string }> = [
    { ok: status.online, label: th ? 'อินเทอร์เน็ต' : 'Internet', value: status.online ? (th ? 'เชื่อมต่ออยู่' : 'Connected') : (th ? 'ออฟไลน์ — ถ่ายและพิมพ์ใบเสร็จต่อได้ รูปจะอัปโหลดเองเมื่อเน็ตกลับมา' : 'Offline. You can keep shooting and printing; photos upload by themselves when it is back.') },
  ];
  if (cloud.used) {
    rows.push({
      ok: !waiting && !cloud.lastError,
      label: th ? 'อัปโหลดขึ้นคลาวด์' : 'Cloud upload',
      value: waiting
        ? (th ? `รออัปโหลด ${cloud.waitingPhotos} รูปจาก ${cloud.waitingSessions} รอบ${cloud.lastError ? ` · ล่าสุดผิดพลาด: ${cloud.lastError}` : ''}` : `${cloud.waitingPhotos} photo(s) from ${cloud.waitingSessions} round(s) waiting${cloud.lastError ? ` · last error: ${cloud.lastError}` : ''}`)
        : (th ? 'ครบทุกรอบ' : 'Everything is uploaded') + (cloud.lastUploadAt ? (th ? ` · ล่าสุด ${new Date(cloud.lastUploadAt).toLocaleTimeString('th-TH')}` : ` · last ${new Date(cloud.lastUploadAt).toLocaleTimeString('en-GB')}`) : '')
    });
  }
  rows.push({ ok: !status.cameraFolder.lastError, label: th ? 'โฟลเดอร์ภาพจากกล้อง' : 'Camera folder', value: status.cameraFolder.lastError ?? (status.cameraFolder.enabled ? (th ? `กำลังนำเข้า · นำเข้าแล้ว ${status.cameraFolder.importedCount} ภาพ` : `Importing · ${status.cameraFolder.importedCount} photo(s) so far`) : (th ? 'ไม่ได้ใช้' : 'Not in use')) });
  rows.push({ ok: status.receiptPrinter.configured, label: th ? 'เครื่องพิมพ์ใบเสร็จ' : 'Receipt printer', value: status.receiptPrinter.configured ? (th ? 'ตั้งค่าแล้ว (ตรวจสถานะได้ใน ตั้งค่า)' : 'Set up (check its status in Settings)') : (th ? 'ยังไม่ได้ตั้งค่า — ใช้ QR บนหน้าจอแทนได้' : 'Not set up. The QR on the screen works instead.') });
  return <article className="summary-card booth-status" aria-live="polite">
    <div className="card-heading"><div><span className="card-icon blue">◉</span><span><small>{th ? 'สถานะบูธตอนนี้' : 'BOOTH STATUS'}</small><h2>{th ? 'พร้อมใช้งานหรือไม่' : 'Is everything working?'}</h2></span></div>
      <span className={`status-dot ${rows.every(row => row.ok || row.label.includes('ใบเสร็จ') || row.label.includes('Receipt')) ? 'good' : 'neutral'}`}>{status.online && !waiting ? (th ? 'ปกติ' : 'OK') : (th ? 'ดูรายละเอียด' : 'Check details')}</span></div>
    <ul className="booth-status-list">{rows.map(row => <li key={row.label}><strong>{row.ok ? '✓' : '!'} {row.label}</strong><span>{row.value}</span></li>)}</ul>
    <button type="button" className="camera-secondary" onClick={onOpenSettings}>{th ? 'ไปที่ตั้งค่า' : 'Open settings'}</button>
  </article>;
}
