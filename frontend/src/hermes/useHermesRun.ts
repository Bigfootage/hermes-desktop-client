import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HermesClient } from './client';
import { applyRunEvent, createRunView, isRunTerminal, reconcileRun, type RunView } from './run-state';
import { HermesRunsClient } from './runs';
import type { HermesConnectionProfile, HermesRun } from './types';

const storageKey = (profile: HermesConnectionProfile) => `hermes.desktop.active-run:${profile.baseUrl}`;

export interface UseHermesRun {
  run: RunView | null;
  busy: boolean;
  error: string;
  launch(input: string): Promise<void>;
  attach(id: string): Promise<void>;
  stop(): Promise<void>;
  steer(input: string): Promise<void>;
  clear(): void;
}

export function useHermesRun(profile: HermesConnectionProfile): UseHermesRun {
  const api = useMemo(() => new HermesRunsClient(new HermesClient(profile)), [profile]);
  const [run, setRun] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | undefined>(undefined);

  const observe = useCallback(async (initial: HermesRun) => {
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setRun((current) => current?.id === initial.id ? reconcileRun(current, initial) : createRunView(initial));
    localStorage.setItem(storageKey(profile), initial.id);
    if (isRunTerminal(initial.status)) return;
    try {
      for await (const event of api.events(initial.id, controller.signal)) setRun((current) => current && current.id === initial.id ? applyRunEvent(current, event) : current);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setRun((current) => current && current.id === initial.id ? { ...current, connected: false } : current);
    }
    // The gateway's event queue is single-subscriber and may be gone after a
    // transport disconnect. Polling is the durable reconnect path.
    while (!controller.signal.aborted) {
      try {
        const status = await api.get(initial.id);
        setRun((current) => current && current.id === initial.id ? reconcileRun(current, status) : current);
        setError('');
        if (isRunTerminal(status.status)) return;
      } catch (caught) {
        setRun((current) => current && current.id === initial.id ? { ...current, connected: false } : current);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      await new Promise<void>((resolve) => { const timer = window.setTimeout(resolve, 2000); controller.signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve(); }, { once: true }); });
    }
  }, [api, profile]);

  const attach = useCallback(async (id: string) => {
    const clean = id.trim(); if (!clean) return;
    setBusy(true); setError('');
    try { void observe(await api.get(clean)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, [api, observe]);

  useEffect(() => {
    const remembered = localStorage.getItem(storageKey(profile));
    if (remembered) void attach(remembered);
    return () => abortRef.current?.abort();
  }, [attach, profile]);

  const launch = useCallback(async (input: string) => {
    const clean = input.trim(); if (!clean) return;
    setBusy(true); setError('');
    try { void observe(await api.create(clean)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, [api, observe]);

  const stop = useCallback(async () => {
    if (!run) return; setBusy(true); setError('');
    try { const next = await api.stop(run.id); setRun((current) => current ? reconcileRun(current, { ...next, id: run.id }) : current); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, [api, run]);

  const steer = useCallback(async (input: string) => {
    if (!run || !input.trim()) return; setBusy(true); setError('');
    try { await api.steer(run.id, input.trim()); setRun((current) => current ? { ...current, lastSteerAccepted: true } : current); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, [api, run]);

  const clear = useCallback(() => { abortRef.current?.abort(); localStorage.removeItem(storageKey(profile)); setRun(null); setError(''); }, [profile]);
  return { run, busy, error, launch, attach, stop, steer, clear };
}
