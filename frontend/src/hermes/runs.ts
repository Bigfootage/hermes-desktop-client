import { HermesClient } from './client'; import { parseSse } from './sse'; import type { HermesRun, HermesRunEvent } from './types';
export class HermesRunsClient {
  constructor(private client: HermesClient) {}
  create(input: string, extra: Record<string, unknown> = {}) { return this.client.request<HermesRun>('/v1/runs', { method: 'POST', body: JSON.stringify({ input, ...extra }) }); }
  get(id: string) { return this.client.request<HermesRun>(`/v1/runs/${encodeURIComponent(id)}`); }
  stop(id: string) { return this.client.request<HermesRun>(`/v1/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' }); }
  steer(id: string, input: string) { return this.client.request<HermesRun>(`/v1/runs/${encodeURIComponent(id)}/steer`, { method: 'POST', body: JSON.stringify({ input }) }); }
  async *events(id: string, signal?: AbortSignal, lastEventId?: string): AsyncGenerator<HermesRunEvent> { const response = await this.client.stream(`/v1/runs/${encodeURIComponent(id)}/events`, { headers: lastEventId ? { 'Last-Event-ID': lastEventId } : undefined, signal }); const seen = new Set<string>(); for await (const frame of parseSse(response, signal)) { if (frame.data === '[DONE]') return; let data: Record<string, unknown>; try { data = JSON.parse(frame.data); } catch { continue; } const eventId = frame.id ?? (typeof data.id === 'string' ? data.id : undefined); if (eventId && seen.has(eventId)) continue; if (eventId) seen.add(eventId); yield { ...data, id: eventId, type: typeof data.type === 'string' ? data.type : frame.event }; } }
}
