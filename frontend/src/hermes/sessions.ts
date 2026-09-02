import { HermesClient } from './client';
import { parseSse } from './sse';

export interface HermesSession {
  id: string;
  title?: string | null;
  source?: string;
  model?: string | null;
  message_count?: number;
  parent_session_id?: string | null;
  last_active?: number | string | null;
  started_at?: number | string | null;
  preview?: string | null;
  pinned?: boolean;
  archived?: boolean;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface SessionMessage {
  id?: string;
  session_id?: string;
  role: string;
  content: unknown;
  text: string;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface SessionList { data: HermesSession[]; limit: number; offset: number; hasMore: boolean }
export interface SessionMessages { sessionId: string; data: SessionMessage[]; pagination?: { limit: number; offset: number; order: string; returned: number } }
export interface SessionStreamEvent { type: string; delta?: string; content?: string; message?: string; messageId?: string; toolName?: string; preview?: string; raw?: Record<string, unknown> }

function idPath(id: string): string { return encodeURIComponent(id); }
function sessionFrom(body: { session: HermesSession }): HermesSession { return normalizeSession(body.session); }
function normalizeSession(session: HermesSession): HermesSession {
  return { ...session, pinned: Boolean(session.pinned), archived: Boolean(session.archived), hidden: Boolean(session.hidden) };
}

export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const value = part as Record<string, unknown>;
    return typeof value.text === 'string' ? value.text : typeof value.content === 'string' ? value.content : '';
  }).join('');
}

export async function listSessions(client: HermesClient, options: { limit?: number; offset?: number; includeChildren?: boolean } = {}): Promise<SessionList> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 100));
  params.set('offset', String(options.offset ?? 0));
  if (options.includeChildren) params.set('include_children', 'true');
  const body = await client.request<{ data: HermesSession[]; limit: number; offset: number; has_more: boolean }>(`/api/sessions?${params}`);
  return { data: body.data.map(normalizeSession), limit: body.limit, offset: body.offset, hasMore: body.has_more };
}

export async function createSession(client: HermesClient, input: { title?: string; source?: string } = {}): Promise<HermesSession> {
  return sessionFrom(await client.request(`/api/sessions`, { method: 'POST', body: JSON.stringify({ source: 'desktop', ...input }) }));
}
export async function getSession(client: HermesClient, id: string): Promise<HermesSession> {
  return sessionFrom(await client.request(`/api/sessions/${idPath(id)}`));
}
export async function patchSession(client: HermesClient, id: string, patch: { title?: string | null; pinned?: boolean; archived?: boolean }): Promise<HermesSession> {
  return sessionFrom(await client.request(`/api/sessions/${idPath(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }));
}
export async function deleteSession(client: HermesClient, id: string): Promise<{ id: string; deleted: boolean }> {
  const body = await client.request<{ id: string; deleted: boolean }>(`/api/sessions/${idPath(id)}`, { method: 'DELETE' });
  return { id: body.id, deleted: body.deleted };
}
export async function forkSession(client: HermesClient, id: string, input: { title?: string } = {}): Promise<HermesSession> {
  return sessionFrom(await client.request(`/api/sessions/${idPath(id)}/fork`, { method: 'POST', body: JSON.stringify(input) }));
}
export async function getSessionMessages(client: HermesClient, id: string): Promise<SessionMessages> {
  const body = await client.request<{ session_id: string; data: Array<Omit<SessionMessage, 'text'> & { role: string; content: unknown }>; pagination?: SessionMessages['pagination'] }>(`/api/sessions/${idPath(id)}/messages?order=oldest`);
  return { sessionId: body.session_id, data: body.data.map((message) => ({ ...message, text: messageText(message.content) })), pagination: body.pagination };
}

export async function* streamSessionChat(client: HermesClient, id: string, message: string, options: { signal?: AbortSignal } = {}): AsyncGenerator<SessionStreamEvent> {
  const response = await client.stream(`/api/sessions/${idPath(id)}/chat/stream`, { method: 'POST', body: JSON.stringify({ message }), signal: options.signal });
  for await (const frame of parseSse(response, options.signal)) {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(frame.data) as Record<string, unknown>; } catch { raw = { message: frame.data }; }
    const event: SessionStreamEvent = { type: frame.event };
    if (typeof raw.delta === 'string') event.delta = raw.delta;
    if (typeof raw.content === 'string') event.content = raw.content;
    if (typeof raw.message === 'string') event.message = raw.message;
    if (typeof raw.message_id === 'string') event.messageId = raw.message_id;
    if (typeof raw.tool_name === 'string') event.toolName = raw.tool_name;
    if (typeof raw.preview === 'string') event.preview = raw.preview;
    yield event;
  }
}
