import { describe, expect, it } from 'vitest';
import { applyRunEvent, createRunView, reconcileRun, runEventKey } from './run-state';
import type { HermesRunEvent } from './types';

const event = (type: string, extra: Record<string, unknown> = {}): HermesRunEvent => ({ type, ...extra });

describe('run lifecycle view model', () => {
  it('deduplicates replayed events while retaining text and terminal output', () => {
    let state = createRunView({ id: 'run_1', status: 'started' });
    const delta = event('message.delta', { id: 'e1', delta: 'Hello' });
    state = applyRunEvent(state, delta);
    state = applyRunEvent(state, delta);
    state = applyRunEvent(state, event('run.completed', { id: 'e2', output: 'Hello world' }));
    expect(state.output).toBe('Hello world');
    expect(state.status).toBe('completed');
    expect(state.seenEventKeys).toEqual([runEventKey(delta), 'e2']);
  });

  it('tracks tool and subagent lifecycle by stable identifiers', () => {
    let state = createRunView({ id: 'run_1', status: 'running' });
    state = applyRunEvent(state, event('tool.started', { tool_name: 'terminal', tool_call_id: 'tool-1' }));
    state = applyRunEvent(state, event('tool.completed', { tool_name: 'terminal', tool_call_id: 'tool-1', preview: 'ok' }));
    state = applyRunEvent(state, event('delegation.started', { task_id: 'agent-1', prompt: 'Research' }));
    state = applyRunEvent(state, event('delegation.completed', { task_id: 'agent-1', result: 'Done' }));
    expect(state.activity.items).toEqual([
      expect.objectContaining({ id: 'tool-1', kind: 'tool', label: 'terminal', status: 'completed', detail: 'ok' }),
      expect.objectContaining({ id: 'agent-1', kind: 'reasoning', label: 'Subagent', status: 'completed', detail: 'Done' }),
    ]);
  });

  it('reconciles after reconnect and preserves pending steer for replay', () => {
    const state = reconcileRun(createRunView({ id: 'run_1', status: 'running' }), {
      id: 'run_1', status: 'completed', output: 'Finished', pending_steer: 'Do the next thing', last_event: 'run.completed',
    });
    expect(state).toMatchObject({ status: 'completed', output: 'Finished', pendingSteer: 'Do the next thing', connected: true });
    expect(state.activity.status).toBe('completed');
  });

  it('reflects accepted steer and stopping controls without claiming completion', () => {
    let state = applyRunEvent(createRunView({ id: 'run_1', status: 'running' }), event('run.steered', { accepted: true }));
    expect(state.lastSteerAccepted).toBe(true);
    state = reconcileRun(state, { id: 'run_1', status: 'stopping' });
    expect(state.status).toBe('stopping');
    expect(state.activity.status).toBe('running');
  });
});
