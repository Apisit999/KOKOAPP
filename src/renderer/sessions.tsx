import { useEffect, useState } from 'react';
import type { KokoMemorySessionStatus, PhotoRecord } from '../shared/contract';
import { PhotoThumb } from './ui-common';
import { printGuestReceipt } from './receipt';
import { filterSessions } from '../shared/session-search';

export function CaptureSessionsPage({ sessions, th, onOpenPhoto, onLoadMore, hasMore, loadingMore, onRoundsChanged = () => undefined }: { sessions: import('../shared/contract').CaptureSessionRecord[]; th: boolean; onOpenPhoto: (photo: PhotoRecord) => void; onLoadMore: () => void; hasMore: boolean; loadingMore: boolean; onRoundsChanged?: () => void }) {
  const [sessionPhotos, setSessionPhotos] = useState<Record<string, PhotoRecord[]>>({});
  const [cloudShareLinks, setCloudShareLinks] = useState<Record<string, string>>({});
  const [cloudShareRevoked, setCloudShareRevoked] = useState<Record<string, boolean>>({});
  const [cloudShareExpiry, setCloudShareExpiry] = useState<Record<string, string>>({});
  const [copiedShareId, setCopiedShareId] = useState('');
  const [cloudSyncMessages, setCloudSyncMessages] = useState<Record<string, string>>({});
  const [receiptReady, setReceiptReady] = useState(false);
  const [printingId, setPrintingId] = useState('');
  useEffect(() => { void window.koko.getReceiptSettings().then(value => setReceiptReady(value.printer !== null)).catch(() => undefined); }, []);
  const [deletingId, setDeletingId] = useState('');
  /** The confirmation window is shown by the app itself; this only reports what happened. */
  async function deleteRound(sessionId: string) {
    setDeletingId(sessionId);
    try {
      const result = await window.koko.deleteCaptureRound(sessionId);
      if (result.cancelled) return;
      setCloudSyncMessages(current => ({ ...current, [sessionId]: result.done
        ? (th ? `ลบรอบนี้แล้ว (รูป ${result.photos} วิดีโอ ${result.videos}) และปิดลิงก์แล้ว` : `Round deleted (${result.photos} photo(s), ${result.videos} video(s)); the link is cancelled.`)
        : (th ? `ลบได้ไม่ครบ เหลือ ${result.failed} ไฟล์ที่ย้ายไม่ได้ ลองกดลบอีกครั้ง` : `${result.failed} file(s) could not be moved. Try deleting again.`) }));
      onRoundsChanged();
    } catch (error) { setCloudSyncMessages(current => ({ ...current, [sessionId]: error instanceof Error ? error.message : (th ? 'ลบรอบนี้ไม่สำเร็จ' : 'Could not delete the round') })); }
    finally { setDeletingId(''); }
  }
  /** Reprint for a guest who lost their slip: the same link and code, one more copy. */
  async function reprintReceipt(sessionId: string) {
    setPrintingId(sessionId);
    try {
      // A reprint uses the message of the event the round belongs to, not whichever event is open now.
      const session = sessions.find(item => item.id === sessionId);
      const event = session?.eventId ? (await window.koko.listEvents()).events.find(item => item.id === session.eventId) ?? null : null;
      await printGuestReceipt(sessionId, event, th, 1); setCloudSyncMessages(current => ({ ...current, [sessionId]: th ? 'ส่งใบเสร็จไปที่เครื่องพิมพ์แล้ว' : 'Receipt sent to the printer' })); }
    catch (error) { setCloudSyncMessages(current => ({ ...current, [sessionId]: error instanceof Error ? error.message : (th ? 'พิมพ์ใบเสร็จไม่สำเร็จ' : 'Could not print the receipt') })); }
    finally { setPrintingId(''); }
  }
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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [shortCodes, setShortCodes] = useState<Record<string, string | null>>({});
  const [eventNames, setEventNames] = useState<Record<string, string>>({});
  useEffect(() => { void window.koko.listEvents().then(data => setEventNames(Object.fromEntries(data.events.map(item => [item.id, item.name])))).catch(() => undefined); }, []);
  // Short codes are what a guest reads out when the slip is lost, so searching by code must work on every loaded round.
  useEffect(() => {
    let mounted = true;
    void Promise.all(sessions.map(async session => {
      try { return [session.id, (await window.koko.getPhotoCloudShareStatus(session.id)).shortCode ?? null] as const; }
      catch { return [session.id, null] as const; }
    })).then(entries => { if (mounted) setShortCodes(Object.fromEntries(entries)); });
    return () => { mounted = false; };
  }, [sessions]);
  const visibleSessions = filterSessions(sessions, { query, status: statusFilter, shortCodes, eventNames, formatDate: iso => new Date(iso).toLocaleString(th ? 'th-TH' : 'en-US') });
  const filtering = query.trim() !== '' || statusFilter !== 'all';
  const statusLabel: Record<import('../shared/contract').CaptureSessionRecord['status'], string> = {
    capturing: th ? 'กำลังถ่าย' : 'Capturing', review: th ? 'รอตรวจภาพ' : 'Needs review',
    confirmed: th ? 'ยืนยันแล้ว' : 'Confirmed', interrupted: th ? 'หยุดก่อนจบ' : 'Interrupted',
    cancelled: th ? 'ยกเลิก' : 'Cancelled', retaken: th ? 'ถ่ายใหม่' : 'Retaken'
  };
  return <><p className="eyebrow">KOKO / SESSIONS</p><h1>{th ? 'ประวัติรอบถ่าย' : 'Capture sessions'}</h1><p className="lead">{th ? 'รอบถ่ายและภาพต้นฉบับถูกเก็บไว้ในเครื่อง' : 'Capture rounds and their original photos are stored on this device.'}</p>
    {sessions.length > 0 && <div className="session-search" role="search"><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={th ? 'ค้นหา: รหัสสั้นของแขก ชื่องาน เทมเพลต หรือวันที่' : 'Search: guest short code, event, template or date'} aria-label={th ? 'ค้นหารอบถ่าย' : 'Search capture sessions'} /><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label={th ? 'กรองตามสถานะ' : 'Filter by status'}><option value="all">{th ? 'ทุกสถานะ' : 'All statuses'}</option>{(Object.keys(statusLabel) as Array<keyof typeof statusLabel>).map(key => <option key={key} value={key}>{statusLabel[key]}</option>)}</select>{filtering && <small aria-live="polite">{th ? `พบ ${visibleSessions.length} จาก ${sessions.length} รอบ` : `${visibleSessions.length} of ${sessions.length} rounds`}{hasMore ? (th ? ' (ค้นเฉพาะที่โหลดแล้ว กด "โหลดประวัติเพิ่มเติม" เพื่อค้นย้อนหลัง)' : ' (only loaded rounds are searched; load more to go further back)') : ''}</small>}</div>}
    {!sessions.length ? <section className="empty-state"><span>◷</span><h2>{th ? 'ยังไม่มีประวัติรอบถ่าย' : 'No capture sessions yet'}</h2><p>{th ? 'รอบถ่ายที่บันทึกสำเร็จจะแสดงที่นี่' : 'Saved capture rounds will appear here.'}</p></section> : <div className="capture-session-list">{visibleSessions.map(session => <article className="capture-session-card" key={session.id}><div className="capture-session-heading"><div><strong>{session.template?.name || (session.videoIds?.length ? (th ? 'รอบวิดีโอ' : 'Video session') : (th ? 'ถ่ายภาพ' : 'Photo session'))}</strong><small>{new Date(session.createdAt).toLocaleString(th ? 'th-TH' : 'en-US')}{session.eventId ? ` · ${th ? 'มี Event' : 'Event assigned'}` : ''}</small></div><span className={`session-status session-${session.status}`}>{statusLabel[session.status]}</span></div><div className="capture-session-detail">{th ? `${session.photoIds.length} ภาพต้นฉบับ${session.compositionPhotoId ? ' · 1 ภาพประกอบ' : ''} · ${(session.videoIds ?? []).length} คลิป` : `${session.photoIds.length} original photo(s)${session.compositionPhotoId ? ' · 1 composed photo' : ''} · ${(session.videoIds ?? []).length} video(s)`}{session.template?.title ? ` · ${session.template.title}` : ''}</div>{sessionPhotos[session.id]?.length ? <div className="capture-session-photos">{sessionPhotos[session.id].map(photo => <button type="button" key={photo.id} onClick={() => onOpenPhoto(photo)} aria-label={th ? 'เปิดภาพจากรอบนี้' : 'Open a photo from this round'}><PhotoThumb photo={photo} /></button>)}</div> : session.photoIds.length > 0 && <p className="muted">{th ? 'บางภาพไม่อยู่ในคลังแล้ว' : 'บางภาพไม่อยู่ในคลังแล้ว'}</p>}{(session.videoIds ?? []).map(id => <SessionVideo key={id} id={id} th={th} />)}</article>)}</div>}
    {visibleSessions.filter(session => session.photoIds.length > 0 || session.compositionPhotoId || (session.videoIds?.length ?? 0) > 0).map(session => <div className="photo-cloud-share session-share-link" key={`share-${session.id}`} role="status" aria-live="polite"><span>{new Date(session.createdAt).toLocaleString(th ? 'th-TH' : 'en-US')}{cloudSyncMessages[session.id] ? ` · ${cloudSyncMessages[session.id]}` : ''}</span><button type="button" onClick={() => void window.koko.syncPhotoCloudSession(session.id).then(result => { if (result.shareUrl) setCloudShareLinks(current => ({ ...current, [session.id]: result.shareUrl! })); if (result.mediaCount > 0 && result.uploadedCount === result.mediaCount && result.shareUrl) return navigator.clipboard.writeText(result.shareUrl).then(() => { setCopiedShareId(session.id); setCloudSyncMessages(current => ({ ...current, [session.id]: th ? 'อัปโหลดและคัดลอกลิงก์แล้ว' : 'Uploaded and copied the private link' })); }); setCopiedShareId(''); setCloudSyncMessages(current => ({ ...current, [session.id]: th ? `อัปโหลด ${result.uploadedCount}/${result.mediaCount} ไฟล์` : `Uploaded ${result.uploadedCount}/${result.mediaCount} media files` })); }).catch(error => { setCopiedShareId(''); setCloudSyncMessages(current => ({ ...current, [session.id]: error instanceof Error ? error.message : (th ? 'อัปโหลดไม่สำเร็จ' : 'Upload failed') })); })}>{copiedShareId === session.id ? (th ? 'คัดลอกแล้ว' : 'Copied') : cloudShareLinks[session.id] ? (th ? 'อัปโหลดซ้ำและคัดลอกลิงก์' : 'Retry upload & copy link') : (th ? 'อัปโหลดและสร้างลิงก์ส่วนตัว' : 'Upload & create private link')} ↗</button>{receiptReady && cloudShareLinks[session.id] && !cloudShareRevoked[session.id] ? <button type="button" onClick={() => void reprintReceipt(session.id)} disabled={printingId === session.id}>{printingId === session.id ? (th ? 'กำลังพิมพ์…' : 'Printing…') : (th ? 'พิมพ์ใบเสร็จซ้ำ' : 'Reprint receipt')}</button> : null}<button type="button" className="danger-action" onClick={() => void deleteRound(session.id)} disabled={deletingId === session.id || session.status === 'capturing'}>{deletingId === session.id ? (th ? 'กำลังลบ…' : 'Deleting…') : (th ? 'ลบรอบนี้' : 'Delete round')}</button>{cloudShareExpiry[session.id] && !cloudShareRevoked[session.id] ? <small>{th ? "หมดอายุ " : "Expires "}{new Date(cloudShareExpiry[session.id]).toLocaleDateString(th ? "th-TH" : "en-US")}</small> : null}{cloudShareRevoked[session.id] ? <span className="muted">{th ? "ลิงก์ถูกปิดแล้ว" : "Link revoked"}</span> : cloudShareLinks[session.id] ? <button type="button" onClick={() => { if (!window.confirm(th ? "ปิดลิงก์อัลบั้มนี้ใช่ไหม ลูกค้าจะเปิดหรือดาวน์โหลดรูปจากลิงก์นี้ไม่ได้อีก" : "Revoke this album link? Customers will no longer be able to view or download its files.")) return; void window.koko.revokePhotoCloudShare(session.id).then(ok => { if (ok) { setCloudShareRevoked(current => ({ ...current, [session.id]: true })); setCloudShareLinks(current => { const next = { ...current }; delete next[session.id]; return next; }); setCloudSyncMessages(current => ({ ...current, [session.id]: th ? "ปิดลิงก์อัลบั้มแล้ว" : "Album link revoked" })); } }).catch(error => setCloudSyncMessages(current => ({ ...current, [session.id]: error instanceof Error ? error.message : "Revoke failed" }))); }}>{th ? "ปิดลิงก์" : "Revoke link"}</button> : null}</div>)}
    {visibleSessions.map(session => <KokoMemorySessionAction key={`kokomemory-${session.id}`} session={session} th={th} />)}\n    {hasMore && <div className="load-more"><button className="camera-secondary" type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? (th ? 'กำลังโหลด…' : 'Loading…') : (th ? 'โหลดประวัติเพิ่มเติม' : 'Load more sessions')}</button></div>}
  </>;
}

export function SessionVideo({ id, th }: { id: string; th: boolean }) {
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

export function KokoMemorySessionAction({ session, th }: { session: import('../shared/contract').CaptureSessionRecord; th: boolean }) {
  const [status, setStatus] = useState<KokoMemorySessionStatus>({ state: 'idle', total: 0, uploadedCount: 0, lastError: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.koko.getKokoMemorySessionStatus(session.id).then(setStatus).catch(() => undefined); }, [session.id]);
  if (session.status !== 'confirmed' || (!session.compositionPhotoId && !session.photoIds.length)) return null;
  const labels = { idle: th ? 'ยังไม่ได้ส่ง' : 'Not uploaded', pending: th ? 'รอส่ง' : 'Queued', uploading: th ? 'กำลังอัปโหลด' : 'Uploading', uploaded: th ? 'อัปโหลดครบแล้ว' : 'Uploaded', 'needs-attention': th ? 'ต้องตรวจสอบ' : 'Needs attention' };
  return <div className="photo-cloud-share session-share-link"><span>{labels[status.state]} · {status.uploadedCount}/{status.total}{status.lastError ? ` · ${status.lastError}` : ''}</span><button type="button" disabled={busy} onClick={() => { setBusy(true); void window.koko.syncKokoMemorySession(session.id).then(setStatus).catch(error => setStatus(current => ({ ...current, lastError: error instanceof Error ? error.message : 'Upload failed' }))).finally(() => setBusy(false)); }}>{busy ? (th ? 'กำลังอัปโหลด…' : 'Uploading…') : status.state === 'uploaded' ? (th ? 'ตรวจสอบ/ส่งซ้ำ' : 'Check / retry') : (th ? 'ส่งไป KOKOMEMORY' : 'Upload to KOKOMEMORY')}</button></div>;
}

