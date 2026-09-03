import { describe, expect, it, vi } from 'vitest';
import { HermesClient } from './client';
import { createSession, deleteSession, forkSession, getSessionMessages, listAllSessions, listSessions, patchSession, streamSessionChat } from './sessions';

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function clientWith(fetcher: typeof fetch) {
  return new HermesClient({ baseUrl: 'https://hermes.example', apiKey: 'secret' }, fetcher);
}

describe('canonical sessions API', () => {
  it('lists and unwraps canonical sessions', async () => {
    const fetcher = vi.fn(async () => response({ object: 'list', data: [{ id: 's1', title: 'First', pinned: 0 }], has_more: false })) as unknown as typeof fetch;
    const result = await listSessions(clientWith(fetcher), { limit: 20, offset: 0, includeChildren: true });
    expect(result.data[0]).toMatchObject({ id: 's1', title: 'First', pinned: false });
    expect(fetcher).toHaveBeenCalledWith('https://hermes.example/api/sessions?limit=20&offset=0&include_children=true', expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it('paginates the complete cross-channel session catalogue', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ data: [{ id: 'new' }, { id: 'pinned', pinned: true }], limit: 100, offset: 0, has_more: true }))
      .mockResolvedValueOnce(response({ data: [{ id: 'old' }, { id: 'pinned', pinned: true }], limit: 100, offset: 100, has_more: false }));
    const result = await listAllSessions(clientWith(fetcher as unknown as typeof fetch));
    expect(result.map((session) => session.id)).toEqual(['new', 'pinned', 'old']);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://hermes.example/api/sessions?limit=100&offset=0&include_children=true',
      'https://hermes.example/api/sessions?limit=100&offset=100&include_children=true',
    ]);
  });

  it('creates, renames, forks and deletes through exact routes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ object: 'hermes.session', session: { id: 's1', source: 'desktop' } }, 201))
      .mockResolvedValueOnce(response({ object: 'hermes.session', session: { id: 's1', title: 'Renamed' } }))
      .mockResolvedValueOnce(response({ object: 'hermes.session', session: { id: 's2', parent_session_id: 's1' } }, 201))
      .mockResolvedValueOnce(response({ object: 'hermes.session.deleted', id: 's1', deleted: true }));
    const client = clientWith(fetcher as unknown as typeof fetch);
    await createSession(client, { source: 'desktop' });
    await patchSession(client, 's1', { title: 'Renamed' });
    await forkSession(client, 's1', { title: 'Branch' });
    expect(await deleteSession(client, 's1')).toEqual({ id: 's1', deleted: true });
    expect(fetcher.mock.calls.map(([url, init]) => [url, (init as RequestInit).method, (init as RequestInit).body])).toEqual([
      ['https://hermes.example/api/sessions', 'POST', JSON.stringify({ source: 'desktop' })],
      ['https://hermes.example/api/sessions/s1', 'PATCH', JSON.stringify({ title: 'Renamed' })],
      ['https://hermes.example/api/sessions/s1/fork', 'POST', JSON.stringify({ title: 'Branch' })],
      ['https://hermes.example/api/sessions/s1', 'DELETE', undefined],
    ]);
  });

  it('loads latest messages and normalizes text content', async () => {
    const fetcher = vi.fn(async () => response({ object: 'list', session_id: 's1', data: [
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ], pagination: { limit: 500, offset: 0, order: 'latest', returned: 2 } })) as unknown as typeof fetch;
    const result = await getSessionMessages(clientWith(fetcher), 's1');
    expect(result.data.map((message) => message.text)).toEqual(['hello', 'world']);
    expect(fetcher).toHaveBeenCalledWith('https://hermes.example/api/sessions/s1/messages?order=oldest', expect.anything());
  });

  it('streams named session events from the canonical chat stream', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: assistant.delta\ndata: {"delta":"Hi"}\n\nevent: done\ndata: {}\n\n')); controller.close(); } });
    const fetcher = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    const events = [];
    for await (const event of streamSessionChat(clientWith(fetcher), 's1', 'Hello')) events.push(event);
    expect(events).toEqual([{ type: 'assistant.delta', delta: 'Hi' }, { type: 'done' }]);
    expect(fetcher).toHaveBeenCalledWith('https://hermes.example/api/sessions/s1/chat/stream', expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'Hello' }) }));
  });
});
