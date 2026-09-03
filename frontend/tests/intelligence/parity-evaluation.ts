export interface IntelligenceTraceEvent {
  type: 'tool.started' | 'tool.completed' | 'tool.failed' | 'retrieval.hit';
  tool?: string;
  source?: string;
}

export interface ParityScenario {
  id: string;
  require: { tools?: string[]; retrieval?: boolean };
}

export interface ParityResult { id: string; passed: boolean; missing: string[] }

/** Evaluates observable execution evidence only; assistant prose is intentionally absent. */
export function evaluateParity(scenario: ParityScenario, events: IntelligenceTraceEvent[]): ParityResult {
  const completed = new Set(events.filter((event) => event.type === 'tool.completed').map((event) => event.tool));
  const missing = (scenario.require.tools ?? []).filter((tool) => !completed.has(tool)).map((tool) => `tool:${tool}`);
  if (scenario.require.retrieval && !events.some((event) => event.type === 'retrieval.hit')) missing.push('retrieval:hit');
  return { id: scenario.id, passed: missing.length === 0, missing };
}
