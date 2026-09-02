import { HermesClient } from './client'; import { parseSse } from './sse'; import type { HermesRun, HermesRunEvent } from './types';
export class HermesRunsClient {
  constructor(private client: HermesClient) {}
  async create(input: string, extra: Record<string, unknown> = {}) { return normalizeRun(await this.client.request<HermesRun>('/v1/runs', { method: 'POST', body: JSON.stringify({ input, ...extra }) })); }
  async get(id: string) { return normalizeRun(await this.client.request<HermesRun>(`/v1/runs/${encodeURIComponent(id)}`)); }
  stop(id: string) { return this.client.request<HermesRun>(`/v1/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' }); }
  steer(id: string, input: string) { return this.client.request<HermesRun>(`/v1/runs/${encodeURIComponent(id)}/steer`, { method: 'POST', body: JSON.stringify({ input }) }); }
  async *events(id: string, signal?: AbortSignal, lastEventId?: string): AsyncGenerator<HermesRunEvent> { const response = await this.client.stream(`/v1/runs/${encodeURIComponent(id)}/events`, { headers: lastEventId ? { 'Last-Event-ID': lastEventId } : undefined, signal }); const seen = new Set<string>(); for await (const frame of parseSse(response, signal)) { if (frame.data === '[DONE]') return; let data: Record<string, unknown>; try { data = JSON.parse(frame.data); } catch { continue; } const eventId = frame.id ?? (typeof data.id === 'string' ? data.id : undefined); if (eventId && seen.has(eventId)) continue; if (eventId) seen.add(eventId); const type = typeof data.type === 'string' ? data.type : typeof data.event === 'string' ? data.event : frame.event; if (!type) continue; yield { ...data, id: eventId, type }; } }
}

function normalizeRun(run: HermesRun): HermesRun {
  const id = typeof run.id === 'string' ? run.id : typeof run.run_id === 'string' ? run.run_id : '';
  if (!id) throw new Error('Hermes returned a run without a run_id');
  return { ...run, id };
}
