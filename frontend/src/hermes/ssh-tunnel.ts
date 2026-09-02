import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from './auth';

export interface SshTunnelProfile {
  username: string;
  host: string;
  privateKeyPath: string;
  port: number;
}

export type TunnelPhase = 'unsupported' | 'unconfigured' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface TunnelStatus {
  supported: boolean;
  configured: boolean;
  phase: TunnelPhase;
  endpoint: string;
  attempt: number;
  errorCode?: string;
  message?: string;
  profile?: SshTunnelProfile;
}

export function shouldShowTunnelSetup(status: TunnelStatus | null, desktop = isTauriRuntime()): boolean {
  return desktop && !!status?.supported && !status.configured;
}

export function tunnelStatusLabel(status: TunnelStatus): string {
  switch (status.phase) {
    case 'connected': return 'Secure tunnel connected';
    case 'connecting': return 'Starting secure tunnel…';
    case 'reconnecting': return `Reconnecting secure tunnel${status.attempt ? ` (attempt ${status.attempt})` : ''}…`;
    case 'error': return 'Secure tunnel needs attention';
    case 'disconnected': return 'Secure tunnel disconnected';
    case 'unconfigured': return 'Secure tunnel not configured';
    default: return 'Managed tunnel unavailable';
  }
}

export async function getTunnelStatus(): Promise<TunnelStatus | null> {
  if (!isTauriRuntime()) return null;
  return invoke<TunnelStatus>('ssh_tunnel_status');
}

export async function setupTunnel(profile: SshTunnelProfile): Promise<TunnelStatus> {
  return invoke<TunnelStatus>('ssh_tunnel_setup', { profile });
}

export async function retryTunnel(): Promise<TunnelStatus> {
  return invoke<TunnelStatus>('ssh_tunnel_retry');
}

export async function disconnectTunnel(): Promise<void> {
  return invoke('ssh_tunnel_disconnect');
}

export async function clearTunnel(): Promise<void> {
  return invoke('ssh_tunnel_clear');
}

export async function choosePrivateKey(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false, title: 'Select SSH private key' });
  return typeof selected === 'string' ? selected : null;
}

export async function getAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>('ssh_autostart_status');
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  return invoke<boolean>('ssh_set_autostart', { enabled });
}
