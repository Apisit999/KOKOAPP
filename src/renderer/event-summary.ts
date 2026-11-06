import type { CaptureSessionRecord } from '../shared/contract';

export type EventSummary = {
  rounds: number; confirmed: number; retaken: number; cancelled: number; unfinished: number;
  photos: number; videos: number; busiestHour: number | null; firstAt: string | null; lastAt: string | null;
  templates: { name: string; count: number }[];
};

export function summarizeEvent(sessions: CaptureSessionRecord[], eventId: string): EventSummary {
  const own = sessions.filter(session => session.eventId === eventId);
  const hours = new Map<number, number>();
  const templates = new Map<string, number>();
  const summary: EventSummary = { rounds: own.length, confirmed: 0, retaken: 0, cancelled: 0, unfinished: 0, photos: 0, videos: 0, busiestHour: null, firstAt: null, lastAt: null, templates: [] };
  for (const session of own) {
    if (session.status === 'confirmed') {
      summary.confirmed += 1;
      summary.photos += session.photoIds.length;
      summary.videos += session.videoIds?.length ?? 0;
      const name = session.template?.name;
      if (name) templates.set(name, (templates.get(name) ?? 0) + 1);
      const hour = new Date(session.createdAt).getHours();
      hours.set(hour, (hours.get(hour) ?? 0) + 1);
    } else if (session.status === 'retaken') summary.retaken += 1;
    else if (session.status === 'cancelled') summary.cancelled += 1;
    else summary.unfinished += 1;
    if (!summary.firstAt || session.createdAt < summary.firstAt) summary.firstAt = session.createdAt;
    if (!summary.lastAt || session.createdAt > summary.lastAt) summary.lastAt = session.createdAt;
  }
  let best = 0;
  for (const [hour, count] of hours) if (count > best) { best = count; summary.busiestHour = hour; }
  summary.templates = [...templates].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3);
  return summary;
}
