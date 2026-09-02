import { describe, expect, it } from 'vitest';
import { shouldShowTunnelSetup, tunnelStatusLabel, type TunnelStatus } from './ssh-tunnel';

function status(overrides: Partial<TunnelStatus> = {}): TunnelStatus {
  return { supported: true, configured: false, phase: 'unconfigured', endpoint: 'http://127.0.0.1:8642', attempt: 0, ...overrides };
}

describe('SSH tunnel UI logic', () => {
  it('shows first-run setup only for a supported desktop without a profile', () => {
    expect(shouldShowTunnelSetup(status(), true)).toBe(true);
    expect(shouldShowTunnelSetup(status({ configured: true }), true)).toBe(false);
    expect(shouldShowTunnelSetup(status(), false)).toBe(false);
    expect(shouldShowTunnelSetup(status({ supported: false }), true)).toBe(false);
  });

  it('describes reconnect attempts and errors clearly', () => {
    expect(tunnelStatusLabel(status({ configured: true, phase: 'connected' }))).toBe('Secure tunnel connected');
    expect(tunnelStatusLabel(status({ configured: true, phase: 'reconnecting', attempt: 3 }))).toContain('attempt 3');
    expect(tunnelStatusLabel(status({ configured: true, phase: 'error' }))).toContain('needs attention');
  });
});
