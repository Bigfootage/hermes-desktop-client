export interface SseEvent { event: string; data: string; id?: string; retry?: number }
export class SseParser {
  private buffer = '';
  push(chunk: string, flush = false): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const events: SseEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n\n')) >= 0) { const frame = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 2); const parsed = this.parse(frame); if (parsed) events.push(parsed); }
    if (flush && this.buffer) { const parsed = this.parse(this.buffer); this.buffer = ''; if (parsed) events.push(parsed); }
    return events;
  }
  private parse(frame: string): SseEvent | null {
    let event = 'message', id: string | undefined, retry: number | undefined; const data: string[] = [];
    for (const line of frame.split('\n')) { if (!line || line.startsWith(':')) continue; const colon = line.indexOf(':'); const field = colon < 0 ? line : line.slice(0, colon); let value = colon < 0 ? '' : line.slice(colon + 1); if (value.startsWith(' ')) value = value.slice(1); if (field === 'event') event = value; else if (field === 'data') data.push(value); else if (field === 'id' && !value.includes('\0')) id = value; else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value); }
    return data.length ? { event, data: data.join('\n'), id, retry } : null;
  }
}
export async function* parseSse(response: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  if (!response.body) throw new Error('Hermes returned an empty event stream'); const reader = response.body.getReader(); const decoder = new TextDecoder(); const parser = new SseParser();
  try { while (true) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); const { done, value } = await reader.read(); if (done) break; for (const event of parser.push(decoder.decode(value, { stream: true }))) yield event; } for (const event of parser.push(decoder.decode(), true)) yield event; } finally { reader.releaseLock(); }
}
