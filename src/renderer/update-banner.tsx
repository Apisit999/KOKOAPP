import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../shared/update-contract';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Operator-only notice. It never interrupts a booth session: the guest screen does not render it. */
export function UpdateBanner({ th }: { th: boolean }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const run = () => window.koko.checkForUpdates().then(next => { if (!stopped) setStatus(next); }).catch(() => undefined);
    run();
    const timer = setInterval(run, DAY_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  if (!status || status.state !== 'available' || !status.latest) return null;
  const { latest } = status;
  if (!status.mandatory && dismissed === latest.version) return null;
  return <section className={`update-banner ${status.mandatory ? 'mandatory' : ''}`} role={status.mandatory ? 'alert' : 'status'}>
    <div>
      <strong>{status.mandatory ? (th ? `ต้องอัปเดตเป็นเวอร์ชัน ${latest.version}` : `Update to ${latest.version} is required`) : (th ? `มีเวอร์ชันใหม่ ${latest.version}` : `Version ${latest.version} is available`)}</strong>
      <span>{th ? ` (ตอนนี้ใช้ ${status.currentVersion})` : ` (you have ${status.currentVersion})`}</span>
      {latest.notes.length > 0 && <ul>{latest.notes.slice(0, 3).map(note => <li key={note}>{note}</li>)}</ul>}
      <small>{th ? 'สำรองข้อมูลก่อนติดตั้ง ข้อมูลรูปและเทมเพลตจะยังอยู่ ตรวจ SHA-256 บนหน้าดาวน์โหลดก่อนติดตั้ง' : 'Back up first. Your photos and templates are kept. Verify the SHA-256 on the download page before installing.'}</small>
    </div>
    <div className="update-banner-actions">
      <button className="primary" type="button" onClick={() => void window.koko.openUpdateDownload()}>{th ? 'ดาวน์โหลด' : 'Download'}</button>
      {!status.mandatory && <button type="button" onClick={() => setDismissed(latest.version)}>{th ? 'ไว้ทีหลัง' : 'Later'}</button>}
    </div>
  </section>;
}
