import { invoke } from '@tauri-apps/api/core';
import type { HermesConnectionProfile } from './types';

const KEY = 'hermes-desktop-connection';
let memory: HermesConnectionProfile | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function validateConnection(profile: HermesConnectionProfile): Promise<HermesConnectionProfile> {
  if (isTauriRuntime()) return invoke<HermesConnectionProfile>('hermes_validate_connection', { profile });
  return { ...profile };
}

export async function saveConnection(profile: HermesConnectionProfile): Promise<HermesConnectionProfile> {
  if (isTauriRuntime()) {
    const saved = await invoke<HermesConnectionProfile>('hermes_save_connection', { profile });
    memory = { ...saved };
    return { ...saved };
  }
  memory = { ...profile };
  sessionStorage.setItem(KEY, JSON.stringify(profile));
  return { ...profile };
}

export async function loadConnection(): Promise<HermesConnectionProfile | null> {
  if (memory) return { ...memory };
  if (isTauriRuntime()) {
    memory = await invoke<HermesConnectionProfile | null>('hermes_load_connection');
    return memory ? { ...memory } : null;
  }
  try {
    const raw = sessionStorage.getItem(KEY);
    memory = raw ? JSON.parse(raw) : null;
    return memory ? { ...memory } : null;
  } catch { return null; }
}

export async function clearConnection(): Promise<void> {
  memory = null;
  if (isTauriRuntime()) await invoke('hermes_clear_connection');
  else sessionStorage.removeItem(KEY);
}
