import type { HermesSession } from './sessions';

function words(session: HermesSession): Set<string> {
  const text = `${session.title ?? ''} ${session.preview ?? ''}`.toLowerCase();
  return new Set((text.match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 3));
}

function timestamp(value: HermesSession['last_active']): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

/** Metadata-only discovery. Message histories remain isolated until a session is opened. */
export function discoverRelatedSessions(sessions: HermesSession[], active: HermesSession, limit = 5): HermesSession[] {
  const activeWords = words(active);
  return sessions
    .filter((candidate) => candidate.id !== active.id && !candidate.hidden && !candidate.archived)
    .map((candidate) => {
      const overlap = [...words(candidate)].filter((word) => activeWords.has(word)).length;
      const relatedBranch = candidate.parent_session_id === active.id || active.parent_session_id === candidate.id;
      const crossChannel = Boolean(candidate.source && candidate.source !== active.source);
      return { candidate, score: overlap * 3 + (relatedBranch ? 5 : 0) + (crossChannel && overlap > 0 ? 1 : 0) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || timestamp(b.candidate.last_active) - timestamp(a.candidate.last_active) || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

export function filterSessions(sessions: HermesSession[], query: string): HermesSession[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => [session.title, session.preview, session.source].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle)));
}
