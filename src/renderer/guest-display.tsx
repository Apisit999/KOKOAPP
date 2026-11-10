import { useEffect, useRef, useState } from 'react';
import type { GuestDisplayPayload } from '../shared/contract';
import { advanceSlideshow, DEFAULT_SLIDESHOW, slideshowShouldRun, type SlideshowState } from '../shared/slideshow';

export function GuestDisplay() {
  const [payload, setPayload] = useState<GuestDisplayPayload>({ language: 'th', eventName: '', status: 'connecting', mediaMode: 'photo', countdown: null, resultCount: 0, previewDataUrl: '', qrDataUrl: '', message: 'กำลังเชื่อมต่อหน้าจอเจ้าหน้าที่' });
  const th = payload.language === 'th';
  useEffect(() => window.koko.onGuestDisplayUpdate(setPayload), []);
  // Live slideshow: while nobody uses the booth the screen shows the latest finished pictures of this event.
  const [slideshow, setSlideshow] = useState<{ settings: typeof DEFAULT_SLIDESHOW; ids: string[] }>({ settings: DEFAULT_SLIDESHOW, ids: [] });
  const [slide, setSlide] = useState<{ id: string; url: string; latest: boolean } | null>(null);
  const boothBusy = payload.status === 'countdown' || payload.status === 'capturing' || payload.status === 'review';
  const lastActivity = useRef(Date.now());
  const slideState = useRef<SlideshowState>({ index: 0, shownAt: 0, lastActivityAt: 0, ids: [] });
  const urlCache = useRef(new Map<string, string>());
  if (boothBusy) lastActivity.current = Date.now();
  useEffect(() => {
    let alive = true;
    const poll = () => window.koko.getSlideshowPhotoIds().then(value => { if (alive) setSlideshow(value); }).catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      const now = Date.now();
      if (!slideshowShouldRun(slideshow.settings, boothBusy, now, lastActivity.current, slideshow.ids.length > 0)) { if (slide) setSlide(null); return; }
      const step = advanceSlideshow(slideState.current, slideshow.ids, slideshow.settings, now);
      slideState.current = step.state;
      const id = step.state.ids[step.state.index];
      if (!id || (slide && slide.id === id && !step.changed)) return;
      const cached = urlCache.current.get(id);
      const show = (url: string) => { if (alive) setSlide({ id, url, latest: id === slideshow.ids[0] }); };
      if (cached) { show(cached); return; }
      void window.koko.readSlideshowPhoto(id).then(url => {
        urlCache.current.set(id, url);
        if (urlCache.current.size > 5) urlCache.current.delete(urlCache.current.keys().next().value as string);
        show(url);
      }).catch(() => { slideState.current = { ...slideState.current, shownAt: 0 }; });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [slideshow, boothBusy, slide]);
  const slideshowOn = !boothBusy && slide !== null;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') void window.koko.closeGuestDisplay(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  return <main className={`guest-display${slideshowOn ? ' guest-display-slideshow' : ''}`} lang={payload.language}>
    <header className="koko-header-brand"><img src="./koko-studio-mark.png" alt="" /><div><span className="brand-wordmark" lang="en">KOKO</span><span className="brand-subtitle">STUDIO / PHOTOBOOTH</span></div><span className="guest-display-event">{payload.eventName}</span></header>
    {slideshowOn && slide && <section className="guest-display-slides" aria-live="off"><img key={slide.id} className="guest-display-slide" src={slide.url} alt="" />{slide.latest && <span className="guest-display-latest">{th ? 'ภาพล่าสุด' : 'Latest'}</span>}</section>}
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

