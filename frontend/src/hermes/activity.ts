import type { ResponseStreamEvent } from './responses';

export type ActivityStatus = 'idle' | 'running' | 'completed' | 'failed';
export type ActivityItemStatus = 'running' | 'completed' | 'failed';

export interface ResponseActivityItem {
  id: string;
  kind: 'tool' | 'reasoning';
  label: string;
  detail?: string;
  status: ActivityItemStatus;
}

export interface ResponseActivity {
  status: ActivityStatus;
  items: ResponseActivityItem[];
  error?: string;
  unknownEventCount: number;
}

export function createResponseActivity(): ResponseActivity {
  return { status: 'idle', items: [], unknownEventCount: 0 };
}

function titleCase(value: string): string {
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function itemLabel(type: string, name?: string): string {
  if (name) return name;
  return titleCase(type.replace(/_call$/, ''));
}

function outputDetail(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const record = output as Record<string, unknown>;
  const count = typeof record.count === 'number' ? record.count : Array.isArray(record.results) ? record.results.length : undefined;
  if (count !== undefined) return `${count} ${count === 1 ? 'result' : 'results'}`;
  if (typeof record.status === 'string') return record.status;
  return undefined;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
    return (error as Record<string, unknown>).message as string;
  }
  return 'Hermes response failed';
}

function upsert(items: ResponseActivityItem[], next: ResponseActivityItem): ResponseActivityItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  return items.map((item, itemIndex) => itemIndex === index ? { ...item, ...next, detail: next.detail ?? item.detail } : item);
}

const lifecycleTypes = new Set([
  'response.created',
  'response.in_progress',
  'response.queued',
  'response.completed',
  'response.failed',
  'response.cancelled',
  'response.incomplete',
  'response.output_text.delta',
  'response.output_text.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
]);

export function applyResponseEvent(state: ResponseActivity, event: ResponseStreamEvent): ResponseActivity {
  if (event.type === 'error' || event.type === 'response.failed') {
    return { ...state, status: 'failed', error: errorMessage(event.error ?? event.raw.error) };
  }
  if (event.type === 'response.completed') return { ...state, status: 'completed' };
  if (event.type === 'response.cancelled' || event.type === 'response.incomplete') return { ...state, status: 'failed' };
  if (event.type === 'response.created' || event.type === 'response.in_progress' || event.type === 'response.queued') {
    return { ...state, status: 'running' };
  }

  if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
    const item = event.item;
    if (!item || item.type === 'message') return state;
    const id = item.id ?? `output-${state.items.length + 1}`;
    const done = event.type.endsWith('.done');
    const kind = item.type === 'reasoning' ? 'reasoning' : 'tool';
    const next: ResponseActivityItem = {
      id,
      kind,
      label: kind === 'reasoning' ? 'Reasoning' : itemLabel(item.type, item.name),
      detail: outputDetail(item.output),
      status: done ? 'completed' : 'running',
    };
    return { ...state, status: state.status === 'idle' ? 'running' : state.status, items: upsert(state.items, next) };
  }

  const callMatch = event.type.match(/^response\.([a-z0-9_]+_call)\.(in_progress|searching|completed|failed)$/);
  if (callMatch) {
    const [, callType, phase] = callMatch;
    const rawId = event.raw.item_id ?? event.raw.call_id ?? event.raw.id;
    const id = typeof rawId === 'string' ? rawId : `${callType}-${state.items.length + 1}`;
    const status: ActivityItemStatus = phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : 'running';
    return {
      ...state,
      status: state.status === 'idle' ? 'running' : state.status,
      items: upsert(state.items, { id, kind: 'tool', label: itemLabel(callType), status }),
    };
  }

  if (lifecycleTypes.has(event.type)) return state;
  return { ...state, unknownEventCount: state.unknownEventCount + 1 };
}
