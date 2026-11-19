// Finding a capture round again: by the short code a guest reads out, by event, template, date or status. Pure logic, no UI.

type SearchableSession = {
  id: string;
  eventId: string | null;
  status: string;
  createdAt: string;
  template?: { name: string } | null;
};

export type SessionSearch = {
  query: string;
  /** "all" or one session status such as "confirmed". */
  status: string;
  /** Short codes the booth knows for its rounds, keyed by session id. */
  shortCodes: Record<string, string | null | undefined>;
  eventNames: Record<string, string | undefined>;
  /** How the app writes a date for people; searched together with the plain YYYY-MM-DD form. */
  formatDate: (iso: string) => string;
};

/** Codes are read aloud or typed with spaces or dashes ("K7QM 4XPA"); ignore both and the case. */
const compact = (value: string) => value.toLowerCase().replace(/[\s-]+/g, '');

export function filterSessions<T extends SearchableSession>(sessions: T[], search: SessionSearch): T[] {
  const words = search.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter(session => {
    if (search.status !== 'all' && session.status !== search.status) return false;
    if (!words.length) return true;
    const code = compact(search.shortCodes[session.id] ?? '');
    const text = [
      session.template?.name ?? '',
      session.eventId ? search.eventNames[session.eventId] ?? '' : '',
      search.formatDate(session.createdAt),
      session.createdAt.slice(0, 10),
      session.id.slice(0, 8)
    ].join(' ').toLowerCase();
    // Every word must match something: the code (also as one compact piece) or any text field.
    return words.every(word => text.includes(word) || (code.length > 0 && code.includes(compact(word))));
  });
}
