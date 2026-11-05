import { type CameraStatus } from './camera/camera-adapter';
import { Icon } from './icons';

export function cameraReadinessText(status: CameraStatus, th: boolean) {
  if (status === 'ready') return th ? 'กล้องพร้อมใช้งาน' : 'Camera is ready.';
  if (status === 'permission-denied') return th ? 'อนุญาตให้ KOKO ใช้กล้อง' : 'Allow KOKO to use the camera.';
  if (status === 'not-found') return th ? 'ไม่พบกล้องที่เชื่อมต่อ' : 'No camera was found.';
  if (status === 'busy') return th ? 'กล้องกำลังใช้งานโดยโปรแกรมอื่น' : 'Another app is using the camera.';
  if (status === 'disconnected') return th ? 'กล้องหลุดการเชื่อมต่อ' : 'Camera disconnected.';
  return th ? 'เปิดภาพตัวอย่างเพื่อตรวจสอบกล้อง' : 'Start the preview to check the camera.';
}

export type ReadinessItem = { title: string; detail: string; state: 'ready' | 'todo' | 'optional'; action: string; onClick: () => void };

export function ReadinessChecklist({ items, th }: { items: ReadinessItem[]; th: boolean }) {
  const required = items.filter(item => item.state !== 'optional');
  const ready = required.filter(item => item.state === 'ready').length;
  const next = required.find(item => item.state === 'todo');
  return <section className="readiness-section" aria-labelledby="readiness-title">
    <div className="section-heading"><div><p className="eyebrow">KOKO / EVENT SETUP</p><h2 id="readiness-title">{th ? 'เตรียมงานให้พร้อม' : 'Get your event ready'}</h2><p>{th ? `พร้อมแล้ว ${ready} จาก ${required.length} ขั้นตอนหลัก · หน้าจอแขกเป็นตัวเลือกเสริม` : `${ready} of ${required.length} essentials ready · The guest display is optional.`}</p></div></div>
    <div className={`next-step ${next ? '' : 'all-ready'}`} role="status">
      <span className="next-step-label">{next ? (th ? 'ขั้นถัดไป' : 'NEXT STEP') : (th ? 'พร้อมแล้ว' : 'ALL SET')}</span>
      <strong>{next ? `${next.title} — ${next.detail}` : (th ? 'ทุกขั้นตอนหลักพร้อมแล้ว เริ่มเซสชันได้เลย' : 'Every essential step is ready. You can start a session.')}</strong>
      {next && <button type="button" className="primary" onClick={next.onClick}>{next.action} <span>→</span></button>}
    </div>
    <div className="readiness-grid">{items.map((item, index) => <article className={`readiness-card readiness-${item.state}`} key={item.title}>
      <span className="readiness-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="readiness-indicator" aria-label={item.state === 'ready' ? (th ? 'พร้อม' : 'Ready') : item.state === 'optional' ? (th ? 'ตัวเลือก' : 'Optional') : (th ? 'ต้องตั้งค่า' : 'Needs setup')}>{item.state === 'ready' ? '✓' : item.state === 'optional' ? '○' : '·'}</span>
      <div className="readiness-copy"><strong>{item.title}</strong><small>{item.detail}</small></div>
      <button type="button" className="text-link" onClick={item.onClick}>{item.action} <span>→</span></button>
    </article>)}</div>
  </section>;
}

export function GuestPreviewPage({ th, active, displays, selectedDisplayId, onSelectDisplay, onOpenDisplay, onCloseDisplay, onGuestMode }: {
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
    <section className="guest-preview-stage"><img src="./demo/portrait-one.svg" alt=""/><div className="guest-preview-copy"><img src="./koko-studio-mark.png" alt=""/><span className="brand-wordmark">KOKO</span><small>YOUR MOMENT STARTS HERE</small></div><div className="guest-preview-badge"><i/> {th ? 'ตัวอย่างหน้าจอแขก' : 'GUEST DISPLAY PREVIEW'}</div></section>
    <section className="guest-preview-controls"><span className="panel-kicker">DISPLAY SETUP</span><h2>{th ? 'หน้าจอที่สอง' : 'Second display'}</h2><p>{active ? (th ? 'กำลังเปิดหน้าจอแขกบนจอที่สอง' : 'The guest display is open on your second screen.') : displays.length ? (th ? 'เลือกจอแล้วเปิดหน้าจอแขกได้' : 'Choose a display and open the guest screen.') : (th ? 'ยังไม่พบจอที่สอง แต่ดูตัวอย่างหน้าจอนี้และทดลองโหมดแขกได้' : 'No second display detected. You can still preview this screen and try Guest mode.')}</p><label className="guest-display-target"><span>{th ? 'เลือกจอ' : 'Choose display'}</span><select value={selectedDisplayId ?? ''} onChange={event => onSelectDisplay(Number(event.target.value))} disabled={!displays.length}>{displays.length ? displays.map(display => <option key={display.id} value={display.id}>{display.label} · {display.width}×{display.height}</option>) : <option value="">{th ? 'ยังไม่พบจอที่สอง' : 'No second display found'}</option>}</select></label><button className="primary" type="button" onClick={onOpenDisplay} disabled={active || !displays.length}>{th ? 'เปิดบนจอที่สอง' : 'Open on second display'} <Icon name="arrow" size={15}/></button>{active && <button className="camera-secondary" type="button" onClick={onCloseDisplay}>{th ? 'ปิดจอแขก' : 'Close guest display'}</button>}<hr/><h2>{th ? 'ทดลองโหมดแขก' : 'Try Guest mode'}</h2><p>{th ? 'ไม่มีกล้องก็ใช้ภาพตัวอย่างทดสอบเทมเพลต คลังภาพ และอัลบั้มได้' : 'Use built-in sample photos to try templates, the library, and private albums without a camera.'}</p><button className="camera-secondary" type="button" onClick={onGuestMode}>{th ? 'เปิดโหมดแขกแบบเต็มจอ' : 'Open full-screen Guest mode'} <Icon name="arrow" size={15}/></button></section>
  </div>;
}

