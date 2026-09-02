import { useEffect, useState } from 'react';
import { Check, ChevronDown, Edit3, Loader, Mic, MicOff, Unplug, VolumeX, Wifi, WifiOff, X } from 'lucide-react';
import { clearConnection, isTauriRuntime, loadConnection } from '../../hermes/auth';
import { HermesClient } from '../../hermes/client';
import type { HermesConnectionProfile } from '../../hermes/types';

export type EndpointStatus = 'idle' | 'checking' | 'reachable' | 'unreachable' | 'degraded';

interface EndpointHealth { baseUrl: string; status: EndpointStatus; error?: string; checkedAt?: number }

export function ConnectionStatus() {
  const [expanded, setExpanded] = useState(false);
  const [profile, setProfile] = useState<{ baseUrl: string } | null>(null);
  const [health, setHealth] = useState<EndpointHealth | null>(null);
  const storage = isTauriRuntime() ? 'Windows Credential Manager' : 'this browser session';

  useEffect(() => {
    let active = true;
    void loadConnection().then((saved) => {
      if (!active) return;
      if (!saved) { setProfile(null); setHealth(null); return; }
      setProfile(saved);
      void (async () => {
        try {
          const client = new HermesClient({ baseUrl: saved.baseUrl });
          await client.health();
          if (active) setHealth({ baseUrl: saved.baseUrl, status: 'reachable', checkedAt: Date.now() });
        } catch (error) {
          if (active) setHealth({ baseUrl: saved.baseUrl, status: 'unreachable', error: error instanceof Error ? error.message : String(error), checkedAt: Date.now() });
        }
      })();
    });
    return () => { active = false; };
  }, []);

  if (!profile) return null;

  const color = health?.status === 'reachable' ? 'var(--color-success)' : health?.status === 'checking' ? 'var(--color-warning)' : 'var(--color-error)';
  const label = health?.status === 'reachable' ? 'Connected' : health?.status === 'checking' ? 'Checking' : health?.status === 'unreachable' ? 'Unreachable' : 'Degraded';

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
      <button onClick={() => setExpanded((open) => !open)} className="flex w-full items-center justify-between gap-2 text-left cursor-pointer">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <div>
            <div className="text-xs font-medium">{label}</div>
            {health?.status !== 'checking' && (
              <div className="truncate text-[10px] max-w-[170px]" title={health?.baseUrl} style={{ color: 'var(--color-text-tertiary)' }}>
                {health?.baseUrl}
              </div>
            )}
          </div>
        </div>
        <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
          <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <strong>Endpoint:</strong> {profile.baseUrl}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <strong>Credentials:</strong> Stored in {storage}
          </div>
          {health && (
            <div className="flex items-center gap-2 text-[11px]">
              {health.status === 'reachable' ? <Wifi size={13} style={{ color: 'var(--color-success)' }} /> : health.status === 'checking' ? <Loader size={13} className="animate-spin" /> : <WifiOff size={13} style={{ color: 'var(--color-error)' }} />}
              <span>
                {health.status === 'reachable'
                  ? 'Hermes VM is responding'
                  : health.status === 'checking'
                  ? 'Verifying'
                  : health.status === 'unreachable'
                  ? `Cannot reach Hermes VM — ${health.error || 'connection failed'}`
                  : 'Degraded'}
              </span>
            </div>
          )}
          {health?.status === 'unreachable' && (
            <button onClick={() => {
              setHealth((current) => current ? { ...current, status: 'checking', checkedAt: Date.now() } : null);
              void (async () => {
                try {
                  const client = new HermesClient({ baseUrl: profile.baseUrl });
                  await client.health();
                  setHealth({ baseUrl: profile.baseUrl, status: 'reachable', checkedAt: Date.now() });
                } catch (error) {
                  setHealth({ baseUrl: profile.baseUrl, status: 'unreachable', error: error instanceof Error ? error.message : String(error), checkedAt: Date.now() });
                }
              })();
            }} className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--color-accent)' }}>
              <Wifi size={12} /> Retry connection
            </button>
          )}
          {health?.checkedAt && (
            <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Last checked: {new Date(health.checkedAt).toLocaleTimeString()}
            </div>
          )}
          <button onClick={() => { void clearConnection(); window.location.reload(); }} className="mt-2 flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}><Unplug size={11} />Disconnect</button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Voice capture with editable transcript
// ────────────────────────────────────────────────────────

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'review' | 'error';
interface VoiceError { message: string; isPermission: boolean }

export function VoiceCapture({
  profile,
  disabled,
  onTranscript,
}: {
  profile: HermesConnectionProfile | null;
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<VoiceError | null>(null);
  const [draft, setDraft] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

  useEffect(() => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) setUnsupported(true);
  }, []);

  const reportError = (message: string, isPermission: boolean) => {
    setError({ message, isPermission });
    setState('error');
  };

  const start = async () => {
    if (unsupported) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      mr.onerror = () => {
        reportError('The microphone device encountered an error. Try reconnecting your audio device.', false);
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState('transcribing');
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (!profile) { reportError('Your Hermes connection is not available.', false); return; }
        try {
          const { transcribeHermesAudio } = await import('../../hermes/speech');
          const transcript = await transcribeHermesAudio(profile, blob);
          setDraft(transcript);
          setState('review');
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Voice transcription failed';
          reportError(message, false);
        }
      };
      mr.start();
      setRecorder(mr);
      setState('recording');
    } catch (cause) {
      const isPermission = cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
      if (isPermission) {
        reportError(
          'Microphone access was denied. In Windows, go to Settings → Privacy & security → Microphone and allow this app to use your microphone.',
          true,
        );
      } else {
        const { microphoneErrorMessage } = await import('../../hermes/speech');
        reportError(microphoneErrorMessage(cause), false);
      }
    }
  };

  const stop = () => { recorder?.stop(); setRecorder(null); };

  const confirm = () => {
    if (draft.trim()) onTranscript(draft.trim());
    setDraft(''); setState('idle');
  };

  const dismiss = () => { setDraft(''); setState('idle'); setError(null); };

  if (unsupported) {
    return (
      <button disabled className="grid h-8 w-8 place-items-center rounded-lg cursor-default" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} title="Voice input is not supported in this browser">
        <VolumeX size={14} />
      </button>
    );
  }

  if (state === 'idle') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={start}
        className="grid h-8 w-8 place-items-center rounded-lg cursor-pointer disabled:opacity-30"
        style={{ color: 'var(--color-text-secondary)' }}
        title={disabled ? 'Voice capture is unavailable' : 'Start recording'}
      >
        <Mic size={14} />
      </button>
    );
  }

  if (state === 'recording') {
    return (
      <button
        type="button"
        onClick={stop}
        className="grid h-8 w-8 place-items-center rounded-lg cursor-pointer animate-pulse"
        style={{ background: 'var(--color-error)', color: 'white' }}
        title="Stop recording"
      >
        <MicOff size={14} />
      </button>
    );
  }

  if (state === 'transcribing') {
    return (
      <button type="button" disabled className="grid h-8 w-8 place-items-center rounded-lg cursor-default" title="Transcribing your audio">
        <Loader size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </button>
    );
  }

  if (state === 'review') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', maxWidth: 200 }}>
          <textarea
            aria-label="Review transcript before sending"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            className="min-w-0 flex-1 resize-none bg-transparent text-xs outline-none"
            style={{ color: 'var(--color-accent)', minWidth: 60 }}
          />
          <Edit3 size={10} className="shrink-0" />
        </div>
        <button type="button" onClick={confirm} className="grid h-6 w-6 place-items-center rounded-full cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }} title="Add transcript to input"><Check size={11} /></button>
        <button type="button" onClick={dismiss} className="grid h-6 w-6 place-items-center rounded-full cursor-pointer" style={{ color: 'var(--color-text-secondary)' }} title="Discard"><X size={11} /></button>
      </div>
    );
  }

  // Error state
  return (
    <div className="relative">
      <button type="button" disabled className="grid h-8 w-8 place-items-center rounded-lg cursor-default" style={{ color: 'var(--color-error)', opacity: 0.5 }} title={error?.message}>
        <Mic size={14} />
      </button>
      {error && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg p-3 text-[11px] leading-snug z-20" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>{error.message}</p>
          <div className="mt-2 flex gap-2">
            {error.isPermission && (
              <a href="ms-settings:privacy-microphone" className="text-xs underline" style={{ color: 'var(--color-accent)' }}>Open microphone settings</a>
            )}
            <button onClick={dismiss} className="text-xs underline cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}