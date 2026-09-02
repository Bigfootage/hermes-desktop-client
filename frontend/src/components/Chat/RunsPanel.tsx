import { FormEvent, useState } from 'react';
import { Activity, CircleAlert, Link, Send, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { isRunSteerable, isRunStoppable } from '../../hermes/run-state';
import type { HermesConnectionProfile } from '../../hermes/types';
import { useHermesRun } from '../../hermes/useHermesRun';
import { ResponseActivityTimeline } from './ResponseActivityTimeline';

export function RunsPanel({ profile, onClose }: { profile: HermesConnectionProfile; onClose(): void }) {
  const vm = useHermesRun(profile);
  const [prompt, setPrompt] = useState('');
  const [attachId, setAttachId] = useState('');
  const [steer, setSteer] = useState('');
  const submitRun = (event: FormEvent) => { event.preventDefault(); if (!prompt.trim()) return; void vm.launch(prompt); setPrompt(''); };
  const submitAttach = (event: FormEvent) => { event.preventDefault(); void vm.attach(attachId); };
  const submitSteer = (event: FormEvent) => { event.preventDefault(); if (!steer.trim()) return; void vm.steer(steer); setSteer(''); };
  const displayActivity = vm.run ? {
    ...vm.run.activity,
    items: vm.run.activity.items.map((item) => item.detail?.trim() === vm.run?.output.trim() ? { ...item, detail: undefined } : item),
  } : null;

  return <aside aria-label="Long-running tasks" className="relative z-10 flex w-[360px] shrink-0 flex-col border-l" style={{ borderColor: 'var(--color-border)', background: 'var(--color-sidebar)' }}>
    <header className="flex h-14 items-center gap-2 border-b px-4" style={{ borderColor: 'var(--color-border)' }}><Activity size={16} style={{ color: 'var(--color-accent)' }} /><h2 className="flex-1 text-sm font-semibold">Long task</h2><button aria-label="Close long task panel" onClick={onClose} className="cursor-pointer rounded-lg p-1.5"><X size={16} /></button></header>
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {!vm.run ? <>
        <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>Run work independently from this conversation. You can close or reload the app and attach again with the run ID.</p>
        <form onSubmit={submitRun} className="space-y-2"><textarea aria-label="Long task instructions" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} placeholder="Describe a long-running task…" className="w-full resize-y rounded-xl border bg-transparent p-3 text-sm outline-none" style={{ borderColor: 'var(--color-input-border)' }} /><button disabled={vm.busy || !prompt.trim()} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}><Send size={13} />Start run</button></form>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}><span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />or attach<span className="h-px flex-1" style={{ background: 'var(--color-border)' }} /></div>
        <form onSubmit={submitAttach} className="flex gap-2"><input aria-label="Run ID" value={attachId} onChange={(event) => setAttachId(event.target.value)} placeholder="run_…" className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-xs outline-none" style={{ borderColor: 'var(--color-input-border)' }} /><button disabled={vm.busy || !attachId.trim()} aria-label="Attach to run" className="cursor-pointer rounded-lg border px-3 disabled:opacity-40" style={{ borderColor: 'var(--color-border)' }}><Link size={14} /></button></form>
      </> : <>
        <section className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${!['completed','failed','cancelled'].includes(vm.run.status) ? 'animate-pulse' : ''}`} style={{ background: vm.run.status === 'completed' ? 'var(--color-success)' : vm.run.status === 'failed' || vm.run.status === 'cancelled' ? 'var(--color-error)' : 'var(--color-accent)' }} /><strong className="text-xs capitalize">{vm.run.status.replace(/_/g, ' ')}</strong><span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{vm.run.connected ? 'Connected' : 'Reconnecting…'}</span></div>
          <button onClick={() => navigator.clipboard.writeText(vm.run!.id)} title="Copy run ID" className="mt-2 max-w-full cursor-pointer truncate font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{vm.run.id}</button>
        </section>
        {displayActivity && <ResponseActivityTimeline activity={displayActivity} />}
        {vm.run.output && <div className="prose max-w-none text-sm"><ReactMarkdown>{vm.run.output}</ReactMarkdown></div>}
        {vm.run.pendingSteer && <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--color-accent-subtle)' }}><strong>Guidance arrived after completion</strong><p className="mt-1 whitespace-pre-wrap">{vm.run.pendingSteer}</p><p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Copy this into a new run to continue.</p></div>}
        {isRunSteerable(vm.run.status) && <form onSubmit={submitSteer} className="space-y-2"><label className="text-xs font-medium">Steer this run</label><div className="flex gap-2"><input aria-label="Steer run" value={steer} onChange={(event) => setSteer(event.target.value)} placeholder="Add guidance…" className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-xs outline-none" style={{ borderColor: 'var(--color-input-border)' }} /><button disabled={vm.busy || !steer.trim()} aria-label="Send guidance" className="cursor-pointer rounded-lg px-3 disabled:opacity-40" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}><Send size={13} /></button></div>{vm.run.lastSteerAccepted && <p className="text-[10px]" style={{ color: 'var(--color-success)' }}>Guidance accepted</p>}</form>}
        <div className="flex gap-2">{isRunStoppable(vm.run.status) && <button disabled={vm.busy} onClick={() => void vm.stop()} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-40" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}><Square size={11} fill="currentColor" />Stop run</button>}<button onClick={vm.clear} className="flex-1 cursor-pointer rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--color-border)' }}>Detach</button></div>
      </>}
      {vm.error && <div role="alert" className="flex items-start gap-2 rounded-lg p-2 text-xs" style={{ background: 'color-mix(in srgb, var(--color-error) 9%, transparent)', color: 'var(--color-error)' }}><CircleAlert size={13} className="shrink-0" />{vm.error}</div>}
    </div>
  </aside>;
}
