import React, { useState } from 'react';
import type { PhotoboothEvent } from '../shared/contract';

type EventListItem = PhotoboothEvent & { photoCount: number };
const blank = { name: '', date: '', notes: '' };

export function EventsPage({ events, activeEventId, onRefresh, onMessage, th }: {
  events: EventListItem[]; activeEventId: string | null; onRefresh: () => Promise<void>; onMessage: (value: string) => void; th: boolean;
}) {
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
  function edit(item: EventListItem) { setEditingId(item.id); setForm({ name: item.name, date: item.date ?? '', notes: item.notes }); }

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
        <label>{th ? 'บันทึกเพิ่มเติม' : 'Notes'}<textarea maxLength={500} rows={4} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} /></label>
        {error && <p className="event-error" role="alert">{error}</p>}
        <div className="event-form-actions"><button className="primary" type="submit" disabled={saving}>{saving ? (th ? 'กำลังบันทึก…' : 'Saving…') : editingId ? (th ? 'บันทึกการแก้ไข' : 'Save changes') : (th ? 'สร้าง Event' : 'Create event')}</button>{editingId && <button type="button" className="camera-secondary" onClick={() => { setEditingId(''); setForm(blank); setError(''); }}>{th ? 'ยกเลิก' : 'Cancel'}</button>}</div>
      </form>
      <section className="event-list"><h2>{th ? 'Event ในเครื่องนี้' : 'Events on this device'}</h2>{events.length ? events.map(item => <article className={`event-card ${item.id === activeEventId ? 'is-active' : ''}`} key={item.id}>
        <div className="event-card-heading"><div><h3>{item.name}</h3><small>{item.date || (th ? 'ไม่ระบุวันที่' : 'No date set')} · {item.photoCount} {th ? 'ภาพ' : item.photoCount === 1 ? 'photo' : 'photos'}</small></div>{item.id === activeEventId && <span className="event-active-tag">{th ? 'กำลังใช้งาน' : 'ACTIVE'}</span>}</div>
        {item.notes && <p>{item.notes}</p>}
        <div className="event-card-actions">{item.id === activeEventId ? <button className="camera-secondary" onClick={() => void activate(null)}>{th ? 'จบเซสชัน' : 'End session'}</button> : <button className="primary" onClick={() => void activate(item.id)}>{th ? 'เริ่มเซสชัน' : 'Start session'}</button>}<button className="camera-secondary" onClick={() => edit(item)}>{th ? 'แก้ไข' : 'Edit'}</button><button className="event-delete" disabled={item.photoCount > 0 || item.id === activeEventId} title={item.photoCount ? (th ? 'Event ที่มีภาพจะลบไม่ได้' : 'Events with photos cannot be deleted') : ''} onClick={() => void remove(item)}>{th ? 'ลบ' : 'Delete'}</button></div>
      </article>) : <div className="event-empty">{th ? 'ยังไม่มี Event สร้าง Event เพื่อเริ่มจัดกลุ่มภาพ' : 'No events yet. Create one to organize upcoming captures.'}</div>}</section>
    </div>
  </>;
}
