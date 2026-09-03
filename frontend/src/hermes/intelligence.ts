import type { HermesClient } from './client';
import type { HermesCapabilities } from './types';
import { HermesApiError } from './errors';

export type Availability = boolean | null;
export type IntelligenceSource = 'intelligence-endpoint' | 'capabilities-embedded' | 'capabilities-fallback';

export interface EffectiveIntelligence {
  memory: Availability;
  userProfile: Availability;
  retrieval: Availability;
  retrievalLabel: 'Superbrain' | 'Retrieval';
  sessionSearch: Availability;
  tools: Availability;
  toolCount?: number;
  executionLocation?: string;
  source: IntelligenceSource;
}

export interface IntelligenceStatusItem {
  key: 'memory' | 'profile' | 'retrieval' | 'session-search' | 'tools' | 'execution';
  label: string;
  state: 'available' | 'unavailable' | 'unknown';
  detail?: string;
}

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;

function availability(value: unknown): Availability {
  if (typeof value === 'boolean') return value;
  const item = record(value);
  if (!item) return null;
  const gates = ['enabled', 'available', 'active', 'configured', 'runtime_available']
    .map((key) => item[key])
    .filter((gate): gate is boolean => typeof gate === 'boolean');
  if (gates.length === 0) return null;
  return gates.every(Boolean);
}

function flag(raw: UnknownRecord, names: string[]): Availability {
  for (const name of names) if (name in raw) return availability(raw[name]);
  return null;
}

function normalize(raw: UnknownRecord, source: IntelligenceSource): EffectiveIntelligence {
  const capabilities = record(raw.capabilities);
  const memory = record(raw.memory);
  const normalized = capabilities ? { ...raw, ...capabilities } : raw;
  const retrievalValue = namespaced(normalized, ['superbrain', 'retrieval', 'context_engine']);
  const retrievalRecord = record(retrievalValue);
  const provider = typeof retrievalRecord?.provider === 'string' ? retrievalRecord.provider.toLowerCase() : '';
  const toolsValue = namespaced(normalized, ['tools', 'tool_execution', 'toolsets']);
  const toolsRecord = record(toolsValue);
  const execution = record(namespaced(raw, ['execution', 'runtime']));
  const locationValue = execution?.location ?? execution?.host ?? raw.execution_location;
  return {
    memory: memory ? availability(memory) : flag(normalized, ['memory', 'memory_enabled']),
    userProfile: memory && typeof memory.user_profile_enabled === 'boolean'
      ? memory.user_profile_enabled
      : flag(normalized, ['user_profile', 'profile_memory', 'userProfile']),
    retrieval: availability(retrievalValue),
    retrievalLabel: ('superbrain' in raw || provider.includes('superbrain')) ? 'Superbrain' : 'Retrieval',
    sessionSearch: flag(normalized, ['session_search', 'sessionSearch']),
    tools: availability(toolsValue),
    toolCount: typeof toolsRecord?.count === 'number' && Number.isFinite(toolsRecord.count)
      ? toolsRecord.count
      : Array.isArray(toolsRecord?.enabled) ? toolsRecord.enabled.length : undefined,
    executionLocation: typeof locationValue === 'string' ? locationValue : undefined,
    source,
  };
}

function namespaced(raw: UnknownRecord, names: string[]): unknown {
  for (const name of names) if (name in raw) return raw[name];
  return undefined;
}

function fromCapabilities(capabilities: HermesCapabilities, source: IntelligenceSource): EffectiveIntelligence {
  const flags: UnknownRecord = { ...capabilities.features };
  if (typeof capabilities.raw.execution_location === 'string') flags.execution_location = capabilities.raw.execution_location;
  return normalize(flags, source);
}

export async function fetchEffectiveIntelligence(client: HermesClient, capabilities: HermesCapabilities): Promise<EffectiveIntelligence> {
  const embedded = record(capabilities.raw.effective_intelligence) ?? record(capabilities.raw.intelligence);
  if (embedded) return normalize(embedded, 'capabilities-embedded');
  try {
    const payload = await client.request<unknown>('/v1/intelligence');
    const raw = record(payload);
    if (!raw) throw new TypeError('Malformed effective intelligence response');
    return normalize(record(raw.effective_intelligence) ?? raw, 'intelligence-endpoint');
  } catch (error) {
    if (error instanceof HermesApiError && (error.status === 404 || error.status === 405 || error.status === 501)) {
      return fromCapabilities(capabilities, 'capabilities-fallback');
    }
    throw error;
  }
}

function state(value: Availability | string | undefined): IntelligenceStatusItem['state'] {
  return value === true || (typeof value === 'string' && value.length > 0) ? 'available' : value === false ? 'unavailable' : 'unknown';
}

export function deriveIntelligenceStatus(value: EffectiveIntelligence): IntelligenceStatusItem[] {
  return [
    { key: 'memory', label: 'Memory', state: state(value.memory) },
    { key: 'profile', label: 'User profile', state: state(value.userProfile) },
    { key: 'retrieval', label: value.retrievalLabel, state: state(value.retrieval) },
    { key: 'session-search', label: 'Session search', state: state(value.sessionSearch) },
    { key: 'tools', label: 'Tools', state: state(value.tools), detail: value.toolCount === undefined ? undefined : `${value.toolCount}` },
    { key: 'execution', label: 'Execution', state: state(value.executionLocation), detail: value.executionLocation },
  ];
}
