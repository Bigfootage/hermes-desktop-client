import { describe, expect, it } from 'vitest';
import { applyResponseEvent, createResponseActivity } from './activity';
import type { ResponseStreamEvent } from './responses';

function event(type: string, raw: Record<string, unknown> = {}): ResponseStreamEvent {
  return { type, raw };
}

describe('response activity view model', () => {
  it('tracks the response lifecycle without inventing activity', () => {
    let state = createResponseActivity();
    state = applyResponseEvent(state, event('response.created', { response: { id: 'resp-1' } }));
    expect(state.status).toBe('running');
    expect(state.items).toEqual([]);

    state = applyResponseEvent(state, event('response.completed', { response: { id: 'resp-1' } }));
    expect(state.status).toBe('completed');
  });

  it('maps output item events into stable tool timeline entries', () => {
    let state = createResponseActivity();
    state = applyResponseEvent(state, {
      ...event('response.output_item.added'),
      item: { id: 'call-1', type: 'function_call', name: 'web_search', arguments: '{"query":"Hermes"}' },
    });
    expect(state.items).toEqual([
      expect.objectContaining({ id: 'call-1', kind: 'tool', label: 'web_search', status: 'running' }),
    ]);

    state = applyResponseEvent(state, {
      ...event('response.output_item.done'),
      item: { id: 'call-1', type: 'function_call', name: 'web_search', output: { count: 3 } },
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(expect.objectContaining({ status: 'completed', detail: '3 results' }));
  });

  it('tracks named tool call lifecycle events when no output item is included', () => {
    let state = createResponseActivity();
    state = applyResponseEvent(state, event('response.web_search_call.in_progress', { item_id: 'search-7' }));
    state = applyResponseEvent(state, event('response.web_search_call.completed', { item_id: 'search-7' }));
    expect(state.items).toEqual([
      expect.objectContaining({ id: 'search-7', kind: 'tool', label: 'Web search', status: 'completed' }),
    ]);
  });

  it('records response errors and preserves unknown events as a count, not fake steps', () => {
    let state = createResponseActivity();
    state = applyResponseEvent(state, event('response.unknown.future_event'));
    state = applyResponseEvent(state, { ...event('error'), error: { message: 'tool failed' } });
    expect(state.unknownEventCount).toBe(1);
    expect(state.status).toBe('failed');
    expect(state.error).toBe('tool failed');
    expect(state.items).toEqual([]);
  });
});
