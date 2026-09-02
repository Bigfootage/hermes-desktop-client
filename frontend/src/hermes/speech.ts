import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './auth';
import { HermesApiError, redactSecrets } from './errors';
import type { HermesConnectionProfile } from './types';

export type SpeechAvailability = 'checking' | 'available' | 'unavailable' | 'unsupported';

export function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied. Allow microphone access in Windows privacy settings, then try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect or enable a microphone, then try again.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is busy or unavailable. Close other apps using it, then try again.';
  return 'Could not start the microphone. Check your audio device and try again.';
}

export function mergeTranscript(current: string, transcript: string): string {
  const clean = transcript.trim();
  if (!clean) return current;
  if (!current.trim()) return clean;
  return `${current.replace(/\s+$/, '')} ${clean}`;
}

async function browserResponse(profile: HermesConnectionProfile, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${profile.apiKey ?? ''}`);
  const response = await fetch(`${profile.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers });
  if (!response.ok) throw new HermesApiError(`Hermes speech service returned HTTP ${response.status}`, response.status);
  return response;
}

export async function checkSpeech(profile: HermesConnectionProfile): Promise<boolean> {
  try {
    if (isTauriRuntime()) return await invoke<boolean>('hermes_speech_health');
    const response = await browserResponse(profile, '/v1/speech/health');
    const body = await response.json() as { available?: boolean; status?: string };
    return body.available === true || body.status === 'ok' || body.status === 'healthy';
  } catch { return false; }
}

export async function transcribeHermesAudio(profile: HermesConnectionProfile, blob: Blob): Promise<string> {
  try {
    let body: unknown;
    if (isTauriRuntime()) {
      body = await invoke('hermes_transcribe_audio', { audioData: [...new Uint8Array(await blob.arrayBuffer())], mimeType: blob.type || 'audio/webm' });
    } else {
      const form = new FormData();
      form.append('file', blob, blob.type.includes('ogg') ? 'recording.ogg' : 'recording.webm');
      body = await (await browserResponse(profile, '/v1/speech/transcribe', { method: 'POST', body: form })).json();
    }
    const result = body as { text?: unknown; transcript?: unknown };
    const text = typeof result.text === 'string' ? result.text : typeof result.transcript === 'string' ? result.transcript : '';
    if (!text.trim()) throw new Error('Hermes returned an empty transcript');
    return text.trim();
  } catch (error) {
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error), [profile.apiKey]));
  }
}
