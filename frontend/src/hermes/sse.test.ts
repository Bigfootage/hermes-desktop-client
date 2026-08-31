import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

describe('SseParser', () => {
  it('handles arbitrary fragmentation and multiline data', () => {
    const p = new SseParser();
    expect(p.push('id: 1\nevent: response.output_')).toEqual([]);
    expect(p.push('text.delta\ndata: {"delta":\ndata: "hi"}\n\n')).toEqual([
      { id: '1', event: 'response.output_text.delta', data: '{"delta":\n"hi"}', retry: undefined },
    ]);
  });

  it('handles CRLF, comments, and trailing frame', () => {
    const p = new SseParser();
    expect(p.push(': ping\r\nevent: done\r\ndata: {}', true)).toEqual([
      { event: 'done', data: '{}', id: undefined, retry: undefined },
    ]);
  });

  it('does not invent a boundary when CRLF is split across chunks', () => {
    const p = new SseParser();
    expect(p.push('event: message\r')).toEqual([]);
    expect(p.push('\ndata: first\r')).toEqual([]);
    expect(p.push('\n\r')).toEqual([]);
    expect(p.push('\n')).toEqual([
      { event: 'message', data: 'first', id: undefined, retry: undefined },
    ]);
  });

  it('returns multiple frames and ignores empty events', () => {
    const p = new SseParser();
    expect(p.push('data: one\n\ndata: two\n\n\n\n').map((x) => x.data)).toEqual(['one', 'two']);
  });
});
