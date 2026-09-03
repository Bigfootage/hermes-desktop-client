import { describe, expect, it, vi } from 'vitest';
import { HermesClient } from '../../src/hermes/client';
import { discoverRelatedSessions } from '../../src/hermes/session-discovery';
import { deriveIntelligenceStatus, fetchEffectiveIntelligence } from '../../src/hermes/intelligence';
import { evaluateParity } from './parity-evaluation';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function clientWith(fetcher: typeof fetch) {
  return new HermesClient({ baseUrl: 'https://hermes.example' }, fetcher);
}

describe('desktop intelligence parity contract', () => {
  it('normalizes behavior-bearing intelligence without exposing payload details', async () => {
    const fetcher = vi.fn(async () => response({
      memory: { enabled: true }, user_profile: { available: true },
      retrieval: { enabled: true, provider: 'superbrain' }, session_search: true,
      tools: { enabled: true, count: 12 }, execution: { location: 'hermes-vm' },
      phase_d: { enabled: false }, secret: 'must not survive',
    })) as unknown as typeof fetch;

    const effective = await fetchEffectiveIntelligence(clientWith(fetcher), { features: {}, raw: {} });
    expect(fetcher).toHaveBeenCalledWith('https://hermes.example/v1/intelligence', expect.anything());
    expect(effective).toEqual(expect.objectContaining({ memory: true, userProfile: true, retrieval: true, sessionSearch: true, tools: true, executionLocation: 'hermes-vm' }));
    expect(effective).not.toHaveProperty('secret');
    expect(deriveIntelligenceStatus(effective).map(({ key, state }) => [key, state])).toEqual([
      ['memory', 'available'], ['profile', 'available'], ['retrieval', 'available'],
      ['session-search', 'available'], ['tools', 'available'], ['execution', 'available'],
    ]);
  });

  it('normalizes the canonical Hermes nested intelligence response', async () => {
    const fetcher = vi.fn(async () => response({
      object: 'hermes.effective_intelligence',
      memory: { enabled: true, user_profile_enabled: true },
      capabilities: {
        skills: { enabled: true, configured: true },
        session_search: { enabled: true, configured: true },
        toolsets: { available: true, enabled: ['skills', 'session_search', 'terminal'] },
      },
      execution: { location: 'api_server_host', terminal_backend: 'local' },
    })) as unknown as typeof fetch;
    const effective = await fetchEffectiveIntelligence(clientWith(fetcher), { features: {}, raw: {} });
    expect(effective).toEqual(expect.objectContaining({
      memory: true,
      userProfile: true,
      retrieval: null,
      sessionSearch: true,
      tools: true,
      toolCount: 3,
      executionLocation: 'api_server_host',
      source: 'intelligence-endpoint',
    }));
  });

  it('requires effective gates and does not treat skills as retrieval', async () => {
    const capabilities = {
      effective_intelligence: {
        memory: { enabled: true, user_profile_enabled: true },
        capabilities: {
          skills: { enabled: true, configured: true },
          session_search: { enabled: true, configured: false },
          cron: { enabled: true, configured: true, runtime_available: false },
          toolsets: { available: false, enabled: [] },
        },
      },
    };
    const effective = await fetchEffectiveIntelligence(clientWith(vi.fn() as unknown as typeof fetch), {
      features: {}, raw: capabilities,
    });
    expect(effective.retrieval).toBeNull();
    expect(effective.sessionSearch).toBe(false);
    expect(effective.tools).toBe(false);
  });

  it('degrades truthfully when the optional endpoint is absent and uses advertised flags', async () => {
    const fetcher = vi.fn(async () => response({ error: 'not found' }, 404)) as unknown as typeof fetch;
    const effective = await fetchEffectiveIntelligence(clientWith(fetcher), {
      features: { memory: true, tools: true, session_search: false },
      raw: { execution_location: 'hermes-vm' },
    });
    expect(effective.source).toBe('capabilities-fallback');
    expect(effective.memory).toBe(true);
    expect(effective.sessionSearch).toBe(false);
    expect(effective.userProfile).toBeNull();
  });

  it('discovers related cross-channel sessions by metadata and never loads or merges messages', () => {
    const sessions = [
      { id: 'desktop', source: 'desktop', title: 'Q3 launch plan', last_active: 30 },
      { id: 'telegram', source: 'telegram', title: 'Launch risks for Q3', last_active: 20 },
      { id: 'whatsapp', source: 'whatsapp', preview: 'Dinner plans', last_active: 40 },
      { id: 'child', source: 'slack', title: 'Q3 launch branch', parent_session_id: 'desktop', last_active: 10 },
    ];
    expect(discoverRelatedSessions(sessions, sessions[0]).map((session) => session.id)).toEqual(['child', 'telegram']);
    expect(sessions.every((session) => !('messages' in session))).toBe(true);
  });

  it('scores parity from completed tools and retrieval hits, never answer wording', () => {
    const scenario = { id: 'cross-channel-recall', require: { tools: ['session_search'], retrieval: true } };
    expect(evaluateParity(scenario, [
      { type: 'tool.completed', tool: 'session_search' },
      { type: 'retrieval.hit', source: 'memory' },
    ])).toEqual({ id: 'cross-channel-recall', passed: true, missing: [] });
    expect(evaluateParity(scenario, [
      { type: 'tool.started', tool: 'session_search' },
    ])).toEqual({ id: 'cross-channel-recall', passed: false, missing: ['tool:session_search', 'retrieval:hit'] });
  });
});
