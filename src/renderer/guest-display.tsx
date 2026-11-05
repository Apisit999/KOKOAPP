import { useEffect, useState } from 'react';
import type { GuestDisplayPayload } from '../shared/contract';

export function GuestDisplay() {
  const [payload, setPayload] = useState<GuestDisplayPayload>({ language: 'th', eventName: '', status: 'connecting', mediaMode: 'photo', countdown: null, resultCount: 0, previewDataUrl: '', qrDataUrl: '', message: 'กำลังเชื่อมต่อหน้าจอเจ้าหน้าที่' });
  const th = payload.language === 'th';
  useEffect(() => window.koko.onGuestDisplayUpdate(setPayload), []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') void window.koko.closeGuestDisplay(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  return <main className="guest-display" lang={payload.language}>
    <header className="koko-header-brand"><img src="./koko-studio-mark.png" alt="" /><div><span className="brand-wordmark" lang="en">KOKO</span><span className="brand-subtitle">STUDIO / PHOTOBOOTH</span></div><span className="guest-display-event">{payload.eventName}</span></header>
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

