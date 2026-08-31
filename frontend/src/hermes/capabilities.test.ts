import { describe, expect, it } from 'vitest';
import { normalizeCapabilities, supportsResponses } from './capabilities';

describe('normalizeCapabilities', () => {
  it('normalizes minimum payload', () => {
    expect(normalizeCapabilities({})).toMatchObject({ features: {} });
  });

  it('uses explicit nested enabled flags and preserves future data', () => {
    const value = normalizeCapabilities({
      version: '1',
      profile: 'default',
      features: {
        responses_api: true,
        jobs: false,
        runs: { enabled: true },
        disabled_object: { enabled: false },
      },
      future: 3,
    });
    expect(value.features).toEqual({
      responses_api: true,
      jobs: false,
      runs: true,
      disabled_object: false,
    });
    expect(value.raw.future).toBe(3);
    expect(supportsResponses(value)).toBe(true);
  });

  it('rejects malformed data', () => {
    expect(() => normalizeCapabilities(null)).toThrow(/Malformed/);
  });
});
