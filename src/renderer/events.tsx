import React, { useState } from 'react';
import type { PhotoboothEvent } from '../shared/contract';
import { summarizeEvent, type EventSummary } from './event-summary';

type EventListItem = PhotoboothEvent & { photoCount: number };
const blank = { name: '', date: '', notes: '', receiptMessage: '' };

export function EventsPage({ events, activeEventId, onRefresh, onMessage, th }: {
  events: EventListItem[]; activeEventId: string | null; onRefresh: () => Promise<void>; onMessage: (value: string) => void; th: boolean;
}) {
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [summaries, setSummaries] = useState<Record<string, EventSummary>>({});
  async function showSummary(id: string) {
    setError('');
    try {
      const all: import('../shared/contract').CaptureSessionRecord[] = [];
      for (let offset = 0; ; offset += 100) { const page = await window.koko.listCaptureSessions(100, offset); all.push(...page); if (page.length < 100) break; }
      setSummaries(current => ({ ...current, [id]: summarizeEvent(all, id) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not build the summary.'); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const value = { ...form, date: form.date || null };
      if (editingId) await window.koko.updateEvent(editingId, value);
      else await window.koko.createEvent(value);
      await onRefresh(); setForm(blank); setEditingId('');
      onMessage(th ? 'บันทึก Event แล้ว' : 'Event saved.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this event.'); }
    finally { setSaving(false); }
  }
  async function activate(id: string | null) {
    setError('');
    try { await window.koko.setActiveEvent(id); await onRefresh(); onMessage(id ? (th ? 'เริ่ม Event แล้ว ภาพถัดไปจะถูกจัดเก็บใน Event นี้' : 'Event session started. New captures will be assigned to it.') : (th ? 'จบ Event แล้ว ภาพถัดไปจะยังไม่ผูกกับ Event' : 'Event session ended. New captures will be unassigned.')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change the active event.'); }
  }
  async function remove(item: EventListItem) {
    setError('');
    try { await window.koko.deleteEvent(item.id); await onRefresh(); if (editingId === item.id) { setEditingId(''); setForm(blank); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this event.'); }
  }
  function edit(item: EventListItem) { setEditingId(item.id); setForm({ name: item.name, date: item.date ?? '', notes: item.notes, receiptMessage: item.receiptMessage ?? '' }); }

  return <>
    <p className="eyebrow">KOKO / EVENTS</p>
    <h1>{th ? 'จัดการ Event' : 'Events'}</h1>
    <p className="lead">{th ? 'สร้าง Event และเริ่มเซสชันเพื่อจัดกลุ่มภาพที่ถ่ายต่อจากนี้ ภาพเดิมจะไม่ถูกย้ายหรือเปลี่ยนแปลง' : 'Create an event and start its session to group future captures. Existing photo files stay untouched.'}</p>
    {activeEventId && <div className="active-event-banner"><span>●</span><div><strong>{th ? 'กำลังใช้งาน Event' : 'Active event session'}</strong><small>{events.find(item => item.id === activeEventId)?.name ?? ''}</small></div><button className="camera-secondary" onClick={() => void activate(null)}>{th ? 'จบเซสชัน' : 'End session'}</button></div>}
    <div className="event-page-layout">
      <form className="event-form" onSubmit={event => void save(event)}>
        <h2>{editingId ? (th ? 'แก้ไข Event' : 'Edit event') : (th ? 'สร้าง Event' : 'Create an event')}</h2>
        <label>{th ? 'ชื่อ Event' : 'Event name'}<input required maxLength={80} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder={th ? 'เช่น งานเลี้ยงบริษัท' : 'e.g. Company celebration'} /></label>
        <label>{th ? 'วันที่' : 'Date'}<input type="date" value={form.date} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} /></label>
        <label>{th ? 'ข้อความท้ายใบเสร็จ (ไม่บังคับ)' : 'Receipt message (optional)'}<input maxLength={80} value={form.receiptMessage} placeholder={th ? 'เช่น ขอบคุณที่มาร่วมงานกับเรา' : 'e.g. Thank you for celebrating with us'} onChange={event => setForm(current => ({ ...current, receiptMessage: event.target.value }))} /><small>{th ? 'พิมพ์ท้ายใบเสร็จของงานนี้ สั้น ๆ บรรทัดเดียว (ไม่เกิน 80 ตัวอักษร) และไม่ควรใส่ชื่อลูกค้า' : 'Printed at the bottom of this event\'s receipt: one short line (80 characters at most). Avoid customers\' names.'}</small></label>
        <label>{th ? 'บันทึกเพิ่มเติม' : 'Notes'}<textarea maxLength={500} rows={4} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} /></label>
        {error && <p className="event-error" role="alert">{error}</p>}
        <div className="event-form-actions"><button className="primary" type="submit" disabled={saving}>{saving ? (th ? 'กำลังบันทึก…' : 'Saving…') : editingId ? (th ? 'บันทึกการแก้ไข' : 'Save changes') : (th ? 'สร้าง Event' : 'Create event')}</button>{editingId && <button type="button" className="camera-secondary" onClick={() => { setEditingId(''); setForm(blank); setError(''); }}>{th ? 'ยกเลิก' : 'Cancel'}</button>}</div>
      </form>
      <section className="event-list"><h2>{th ? 'Event ในเครื่องนี้' : 'Events on this device'}</h2>{events.length ? events.map(item => <article className={`event-card ${item.id === activeEventId ? 'is-active' : ''}`} key={item.id}>
        <div className="event-card-heading"><div><h3>{item.name}</h3><small>{item.date || (th ? 'ไม่ระบุวันที่' : 'No date set')} · {item.photoCount} {th ? 'ภาพ' : item.photoCount === 1 ? 'photo' : 'photos'}</small></div>{item.id === activeEventId && <span className="event-active-tag">{th ? 'กำลังใช้งาน' : 'ACTIVE'}</span>}</div>
        {item.notes && <p>{item.notes}</p>}
        <div className="event-card-actions">{item.id === activeEventId ? <button className="camera-secondary" onClick={() => void activate(null)}>{th ? 'จบเซสชัน' : 'End session'}</button> : <button className="primary" onClick={() => void activate(item.id)}>{th ? 'เริ่มเซสชัน' : 'Start session'}</button>}<button className="camera-secondary" onClick={() => void showSummary(item.id)}>{th ? 'สรุปงาน' : 'Summary'}</button><button className="camera-secondary" onClick={() => edit(item)}>{th ? 'แก้ไข' : 'Edit'}</button><button className="event-delete" disabled={item.photoCount > 0 || item.id === activeEventId} title={item.photoCount ? (th ? 'Event ที่มีภาพจะลบไม่ได้' : 'Events with photos cannot be deleted') : ''} onClick={() => void remove(item)}>{th ? 'ลบ' : 'Delete'}</button></div>
        {summaries[item.id] && <SummaryBlock value={summaries[item.id]} th={th} />}
      </article>) : <div className="event-empty">{th ? 'ยังไม่มี Event สร้าง Event เพื่อเริ่มจัดกลุ่มภาพ' : 'No events yet. Create one to organize upcoming captures.'}</div>}</section>
    </div>
  </>;
}

function SummaryBlock({ value, th }: { value: EventSummary; th: boolean }) {
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(th ? 'th-TH' : 'en-US') : '-';
  return <dl className="event-summary">
    <div><dt>{th ? 'รอบที่ถ่ายสำเร็จ' : 'Completed rounds'}</dt><dd>{value.confirmed} / {value.rounds}</dd></div>
    <div><dt>{th ? 'ภาพ / คลิป' : 'Photos / clips'}</dt><dd>{value.photos} / {value.videos}</dd></div>
    <div><dt>{th ? 'ถ่ายใหม่ / ยกเลิก / ค้าง' : 'Retaken / cancelled / unfinished'}</dt><dd>{value.retaken} / {value.cancelled} / {value.unfinished}</dd></div>
    <div><dt>{th ? 'ช่วงที่คนมาถ่ายมากสุด' : 'Busiest hour'}</dt><dd>{value.busiestHour === null ? '-' : `${String(value.busiestHour).padStart(2, '0')}:00`}</dd></div>
    <div><dt>{th ? 'ช่วงเวลา' : 'Time span'}</dt><dd>{fmt(value.firstAt)} → {fmt(value.lastAt)}</dd></div>
    {value.templates.length > 0 && <div><dt>{th ? 'เทมเพลตยอดนิยม' : 'Top templates'}</dt><dd>{value.templates.map(item => `${item.name} (${item.count})`).join(', ')}</dd></div>}
  </dl>;
}
