import { createResponseActivity, type ActivityItemStatus, type ResponseActivity, type ResponseActivityItem } from './activity';
import type { HermesRun, HermesRunEvent } from './types';

export type RunStatus = 'started' | 'queued' | 'running' | 'waiting_for_approval' | 'stopping' | 'completed' | 'failed' | 'cancelled' | string;
export interface RunView {
  id: string;
  status: RunStatus;
  output: string;
  activity: ResponseActivity;
  connected: boolean;
  pendingSteer?: string;
  lastSteerAccepted?: boolean;
  error?: string;
  seenEventKeys: string[];
}

const terminal = new Set(['completed', 'failed', 'cancelled']);
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
const number = (value: unknown) => typeof value === 'number' ? value : undefined;

export function runEventKey(event: HermesRunEvent): string {
  if (event.id) return event.id;
  return [event.type, event.timestamp, event.tool_call_id, event.subagent_id, event.tool, event.delta, event.output].map((value) => String(value ?? '')).join('|');
}

export function createRunView(run: HermesRun): RunView {
  const status = run.status || 'started';
  return {
    id: run.id,
    status,
    output: text(run.output) ?? '',
    activity: { ...createResponseActivity(), status: terminal.has(status) ? (status === 'completed' ? 'completed' : 'failed') : 'running' },
    connected: false,
    pendingSteer: text(run.pending_steer),
    error: text(run.error),
    seenEventKeys: [],
  };
}

function upsert(items: ResponseActivityItem[], item: ResponseActivityItem): ResponseActivityItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  return index < 0 ? [...items, item] : items.map((candidate, i) => i === index ? { ...candidate, ...item, detail: item.detail ?? candidate.detail } : candidate);
}

function activityStatus(status: string): ResponseActivity['status'] {
  return status === 'completed' ? 'completed' : status === 'failed' || status === 'cancelled' ? 'failed' : 'running';
}

export function reconcileRun(state: RunView, run: HermesRun): RunView {
  const status = run.status || state.status;
  return {
    ...state,
    id: run.id || state.id,
    status,
    output: text(run.output) ?? state.output,
    pendingSteer: text(run.pending_steer) ?? state.pendingSteer,
    error: text(run.error) ?? state.error,
    connected: true,
    activity: { ...state.activity, status: activityStatus(status), error: text(run.error) ?? state.activity.error },
  };
}

export function applyRunEvent(state: RunView, event: HermesRunEvent): RunView {
  const key = runEventKey(event);
  if (state.seenEventKeys.includes(key)) return state;
  const next = { ...state, connected: true, seenEventKeys: [...state.seenEventKeys, key].slice(-1000) };
  if (event.type === 'message.delta') return { ...next, output: next.output + (text(event.delta) ?? '') };
  if (event.type === 'run.completed') return { ...next, status: 'completed', output: text(event.output) ?? next.output, pendingSteer: text(event.pending_steer), activity: { ...next.activity, status: 'completed' } };
  if (event.type === 'run.failed') { const error = text(event.error) ?? 'Run failed'; return { ...next, status: 'failed', error, activity: { ...next.activity, status: 'failed', error } }; }
  if (event.type === 'run.cancelled') return { ...next, status: 'cancelled', activity: { ...next.activity, status: 'failed' } };
  if (event.type === 'run.stopping') return { ...next, status: 'stopping', activity: { ...next.activity, status: 'running' } };
  if (event.type === 'run.steered') return { ...next, lastSteerAccepted: event.accepted !== false };
  if (event.type === 'reasoning.available') {
    const id = `reasoning-${event.timestamp ?? next.activity.items.length}`;
    return { ...next, activity: { ...next.activity, status: 'running', items: upsert(next.activity.items, { id, kind: 'reasoning', label: 'Reasoning', detail: text(event.text), status: 'completed' }) } };
  }
  const toolMatch = event.type.match(/^tool\.(started|completed|failed)$/);
  if (toolMatch) {
    const name = text(event.tool_name) ?? text(event.tool) ?? 'Tool';
    const running = [...next.activity.items].reverse().find((item) => item.kind === 'tool' && item.label === name && item.status === 'running');
    const id = text(event.tool_call_id) ?? (toolMatch[1] === 'started' ? `tool-${name}-${event.timestamp ?? next.activity.items.length}` : running?.id ?? `tool-${name}-${event.timestamp ?? next.activity.items.length}`);
    const status: ActivityItemStatus = toolMatch[1] === 'started' ? 'running' : (toolMatch[1] === 'failed' || event.error === true) ? 'failed' : 'completed';
    const duration = number(event.duration);
    const detail = text(event.preview) ?? (duration !== undefined ? `${duration.toFixed(1)}s` : undefined);
    return { ...next, activity: { ...next.activity, status: 'running', items: upsert(next.activity.items, { id, kind: 'tool', label: name, detail, status }) } };
  }
  const subagentMatch = event.type.match(/^(?:subagent\.(start|complete)|delegation\.(started|completed|failed))$/);
  if (subagentMatch) {
    const done = event.type.endsWith('complete') || event.type.endsWith('completed');
    const failed = event.type.endsWith('failed') || event.status === 'failed';
    const id = text(event.subagent_id) ?? text(event.task_id) ?? `subagent-${event.task_index ?? next.activity.items.length}`;
    const detail = text(event.summary) ?? text(event.result) ?? text(event.goal) ?? text(event.prompt) ?? text(event.preview);
    return { ...next, activity: { ...next.activity, status: 'running', items: upsert(next.activity.items, { id, kind: 'reasoning', label: 'Subagent', detail, status: failed ? 'failed' : done ? 'completed' : 'running' }) } };
  }
  return next;
}

export function isRunTerminal(status: string): boolean { return terminal.has(status); }
export function isRunSteerable(status: string): boolean { return status === 'running'; }
export function isRunStoppable(status: string): boolean { return ['started', 'queued', 'running', 'waiting_for_approval'].includes(status); }
