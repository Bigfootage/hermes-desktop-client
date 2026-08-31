import type { HermesConnectionProfile } from './types';
const KEY = 'hermes-desktop-connection';
let memory: HermesConnectionProfile | null = null;
export function saveConnection(profile: HermesConnectionProfile) { memory = { ...profile }; sessionStorage.setItem(KEY, JSON.stringify(profile)); }
export function loadConnection(): HermesConnectionProfile | null {
  if (memory) return { ...memory };
  try { const raw = sessionStorage.getItem(KEY); memory = raw ? JSON.parse(raw) : null; return memory ? { ...memory } : null; } catch { return null; }
}
export function clearConnection() { memory = null; sessionStorage.removeItem(KEY); }
