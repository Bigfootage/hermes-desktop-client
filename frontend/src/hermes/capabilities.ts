import type { HermesCapabilities } from './types';

export function normalizeCapabilities(value: unknown): HermesCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Malformed Hermes capabilities response');
  const raw = value as Record<string, unknown>;
  const source = raw.features ?? raw.capabilities ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Malformed Hermes capability flags');
  const features: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(source)) features[key] = enabled === true || (typeof enabled === 'object' && enabled !== null);
  return {
    version: typeof raw.version === 'string' ? raw.version : undefined,
    profile: typeof raw.profile === 'string' ? raw.profile : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    features,
    raw,
  };
}
