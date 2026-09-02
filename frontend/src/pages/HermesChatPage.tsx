import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bot, Cable, ChevronLeft, CircleAlert, Copy, Eye, EyeOff, HelpCircle, Key, Menu, MessageSquarePlus, PanelLeftClose, Pencil, Send, Square, Trash2, Unplug, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ResponseActivityTimeline } from '../components/Chat/ResponseActivityTimeline';
import { ConnectionStatus, VoiceCapture } from '../components/Chat/ConnectionStatus';
import { RunsPanel } from '../components/Chat/RunsPanel';
import { createResponseActivity, type ResponseActivity } from '../hermes/activity';
import { clearConnection, isTauriRuntime, loadConnection, saveConnection, validateConnection } from '../hermes/auth';
import { HermesClient } from '../hermes/client';
import { supportsResponses } from '../hermes/capabilities';
import { createSession, deleteSession, forkSession, getSessionMessages, listSessions, patchSession, streamSessionChat, type HermesSession, type SessionStreamEvent } from '../hermes/sessions';
import type { HermesCapabilities, HermesConnectionProfile, HermesClarifyRequest } from '../hermes/types';

type Message = { id: string; role: 'user' | 'assistant'; text: string; activity?: ResponseActivity };
type ConnectionState = 'checking' | 'connected' | 'streaming' | 'error';

function sessionActivityLabel(toolName?: string): { label: string; kind: 'tool' | 'reasoning' } {
  if (!toolName || toolName === '_thinking') return { label: toolName === '_thinking' ? 'Reasoning' : 'Tool', kind: toolName === '_thinking' ? 'reasoning' : 'tool' };
  return { label: toolName, kind: 'tool' };
}

export function applySessionActivity(state: ResponseActivity, event: SessionStreamEvent): ResponseActivity {
  if (event.type === 'run.started' || event.type === 'message.started') return { ...state, status: 'running' };
  if (event.type === 'run.completed' || event.type === 'assistant.completed' || event.type === 'done') {
    return { ...state, status: 'completed', items: state.items.map((item) => item.status === 'running' ? { ...item, status: 'completed' } : item) };
  }
  if (event.type === 'error' || event.type === 'run.failed') return { ...state, status: 'failed', error: event.message || 'Hermes response failed' };
  if (event.type.startsWith('tool.')) {
    const presentation = sessionActivityLabel(event.toolName);
    const id = `${event.toolName || 'tool'}-${state.items.length}`;
    const status: 'failed' | 'completed' | 'running' = event.type === 'tool.failed' ? 'failed' : event.type === 'tool.completed' ? 'completed' : 'running';
    const index = state.items.findIndex((item) => item.label === presentation.label && item.status === 'running');
    const item = { id: index >= 0 ? state.items[index].id : id, kind: presentation.kind, label: presentation.label, detail: event.preview, status };
    return { ...state, status: 'running', items: index >= 0 ? state.items.map((current, currentIndex) => currentIndex === index ? item : current) : [...state.items, item] };
  }
  return state;
}

export function HermesChatPage() {
  const [profile, setProfile] = useState<HermesConnectionProfile | null>(null);
  const [url, setUrl] = useState('https://');
  const [key, setKey] = useState('');

  const [capabilities, setCapabilities] = useState<HermesCapabilities | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [runsOpen, setRunsOpen] = useState(false);
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [activeSession, setActiveSession] = useState<HermesSession | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [pendingClarify, setPendingClarify] = useState<HermesClarifyRequest | null>(null);
  const [secretValue, setSecretValue] = useState('');
  const [secretVisible, setSecretVisible] = useState(false);
  const previousId = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const endRef = useRef<HTMLDivElement | null>(null);
  const client = useMemo(() => profile ? new HermesClient(profile) : null, [profile]);

  useEffect(() => {
    let active = true;
    void loadConnection().then((saved) => {
      if (!active) return;
      if (saved) { setProfile(saved); setUrl(saved.baseUrl); }
      else setConnectionState('error');
    }).catch((err) => { if (active) { setConnectionState('error'); setError(err instanceof Error ? err.message : String(err)); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!client) return;
    let active = true;
    setConnectionState('checking');
    Promise.all([client.health(), client.fetchCapabilities()])
      .then(([, caps]) => {
        if (!supportsResponses(caps)) throw new Error('This Hermes server does not advertise the Responses API required by this client');
        if (active) { setCapabilities(caps); setConnectionState('connected'); setError(''); void refreshSessions(); }
      })
      .catch((err) => {
        if (active) { setConnectionState('error'); setError(err instanceof Error ? err.message : String(err)); }
      });
    return () => { active = false; };
  }, [client]);

  async function refreshSessions(selectId?: string) {
    if (!client) return;
    setSessionsLoading(true);
    try {
      const result = await listSessions(client, { limit: 100, includeChildren: true });
      setSessions(result.data);
      if (selectId) setActiveSession(result.data.find((session) => session.id === selectId) ?? null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSessionsLoading(false); }
  }

  async function resumeSession(session: HermesSession) {
    if (!client || streaming) return;
    setError('');
    try {
      const history = await getSessionMessages(client, session.id);
      setMessages(history.data.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => ({ id: message.id ?? crypto.randomUUID(), role: message.role as 'user' | 'assistant', text: message.text })));
      setActiveSession(session); previousId.current = undefined;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function createConversation() {
    if (!client) return;
    if (streaming) abort.current?.abort();
    try {
      const session = await createSession(client, { source: 'desktop' });
      setSessions((current) => [session, ...current]); setActiveSession(session); setMessages([]); setInput(''); setError(''); setPendingClarify(null); setSecretValue(''); previousId.current = undefined;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function renameConversation(session: HermesSession) {
    if (!client) return;
    const title = window.prompt('Rename conversation', session.title || '');
    if (title === null || !title.trim()) return;
    try { const updated = await patchSession(client, session.id, { title: title.trim() }); setSessions((items) => items.map((item) => item.id === updated.id ? updated : item)); if (activeSession?.id === updated.id) setActiveSession(updated); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function forkConversation(session: HermesSession) {
    if (!client) return;
    try { const fork = await forkSession(client, session.id); setSessions((items) => [fork, ...items]); await resumeSession(fork); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function removeConversation(session: HermesSession) {
    if (!client || !window.confirm(`Delete “${session.title || 'Untitled conversation'}”? This permanently removes its messages.`)) return;
    try { await deleteSession(client, session.id); setSessions((items) => items.filter((item) => item.id !== session.id)); if (activeSession?.id === session.id) { setActiveSession(null); setMessages([]); } }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function connect(e: FormEvent) {
    e.preventDefault(); setConnecting(true); setError('');
    try {
      const next = { baseUrl: url, apiKey: key };
      let saved: HermesConnectionProfile;
      let caps: HermesCapabilities;
      if (isTauriRuntime()) {
        await validateConnection(next);
        saved = await saveConnection(next);
        const candidate = new HermesClient(saved);
        await candidate.health();
        caps = await candidate.fetchCapabilities();
      } else {
        const candidate = new HermesClient(next);
        await candidate.health();
        caps = await candidate.fetchCapabilities();
        saved = await saveConnection(next);
      }
      if (!supportsResponses(caps)) throw new Error('This Hermes server does not advertise the Responses API required by this client');
      setKey('');
      setProfile(saved); setCapabilities(caps); setConnectionState('connected');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setConnecting(false); }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!client || !text || streaming || connectionState !== 'connected') return;
    const assistantId = crypto.randomUUID();
    setInput('');
    setPendingClarify(null); setSecretValue('');
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text }, { id: assistantId, role: 'assistant', text: '', activity: createResponseActivity() }]);
    setStreaming(true); setConnectionState('streaming'); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      let session = activeSession;
      if (!session) {
        session = await createSession(client, { source: 'desktop' });
        setActiveSession(session); setSessions((current) => [session!, ...current]);
      }
      for await (const event of streamSessionChat(client, session.id, text, { signal: controller.signal })) {
        setMessages((current) => current.map((message) => message.id === assistantId ? {
          ...message,
          text: event.delta ? message.text + event.delta : event.type === 'assistant.completed' && event.content ? event.content : message.text,
          activity: applySessionActivity(message.activity ?? createResponseActivity(), event),
        } : message));
        if (event.type === 'error') throw new Error(event.message || 'Hermes response failed');
        if (event.type === 'tool.started' && (event.toolName === 'clarify' || event.toolName === 'secret-input')) {
          setPendingClarify({ question: event.toolInput ?? 'Hermes needs more information', inputType: event.toolName === 'secret-input' ? 'secret' : 'text' });
        }
      }
      void refreshSessions(session.id);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) { setError(err instanceof Error ? err.message : String(err)); setConnectionState('error'); }
    } finally {
      setStreaming(false); abort.current = undefined;
      setConnectionState((state) => state === 'error' ? state : 'connected');
    }
  }


  async function disconnect() {
    if (streaming) abort.current?.abort();
    try { await clearConnection(); } catch { /* credential storage best-effort */ }
    setProfile(null); setCapabilities(null); setMessages([]); setSessions([]); setActiveSession(null); previousId.current = undefined;
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  }

  if (!profile) return <ConnectionScreen url={url} apiKey={key} connecting={connecting} error={error} onUrl={setUrl} onKey={setKey} onConnect={connect} />;

  const statusLabel = connectionState === 'checking' ? 'Checking connection' : connectionState === 'streaming' ? 'Hermes is working' : connectionState === 'error' ? 'Connection issue' : 'Connected';
  const canSend = input.trim().length > 0 && !streaming && connectionState === 'connected';
  const isSecret = pendingClarify?.inputType === 'secret';
  const canSubmitSecret = isSecret && secretValue.trim().length > 0 && !streaming;

  const submitSecretAnswer = () => {
    if (!canSubmitSecret) return;
    setInput(secretValue);
    setSecretValue('');
    const form = document.querySelector('form[aria-label="Chat form"]') as HTMLFormElement | null;
    form?.requestSubmit();
  };

  return (
    <main className="relative flex h-full w-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="hud-backdrop" aria-hidden="true" />
      <aside className={`${sidebarOpen ? 'w-[260px]' : 'w-0'} relative z-10 flex shrink-0 flex-col overflow-hidden transition-[width] duration-200`} style={{ background: 'var(--color-sidebar)', borderRight: sidebarOpen ? '1px solid var(--color-border)' : 'none', backdropFilter: 'blur(20px)' }}>
        <div className="flex h-full w-[260px] flex-col p-3">
          <div className="mb-5 flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}><Bot size={18} /></span><div><div className="text-sm font-semibold">Hermes</div><div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>Desktop</div></div></div>
            <button className="rounded-lg p-2 cursor-pointer hover:bg-black/5" onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar"><PanelLeftClose size={17} /></button>
          </div>
          <button onClick={() => void createConversation()} className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}><MessageSquarePlus size={16} />New conversation</button>
          <nav aria-label="Hermes sessions" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{sessionsLoading ? 'Loading sessions…' : 'Sessions'}</div>
            {sessions.map((session) => <div key={session.id} className="group flex items-center rounded-lg" style={{ background: activeSession?.id === session.id ? 'var(--color-accent-subtle)' : undefined }}><button onClick={() => void resumeSession(session)} className="min-w-0 flex-1 truncate px-2 py-2 text-left text-xs cursor-pointer" title={session.title || session.preview || session.id}>{session.title || session.preview || 'Untitled conversation'}</button><div className="hidden shrink-0 items-center pr-1 group-hover:flex"><button aria-label="Rename session" title="Rename" onClick={() => void renameConversation(session)} className="p-1 cursor-pointer"><Pencil size={12} /></button><button aria-label="Fork session" title="Fork" onClick={() => void forkConversation(session)} className="p-1 cursor-pointer"><Copy size={12} /></button><button aria-label="Delete session" title="Delete" onClick={() => void removeConversation(session)} className="p-1 cursor-pointer" style={{ color: 'var(--color-error)' }}><Trash2 size={12} /></button></div></div>)}
          </nav>
          <div className="mt-auto rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            <ConnectionStatus />
          </div>
        </div>
      </aside>

      <section className="relative z-[2] flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4" style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-bg) 85%, transparent)', backdropFilter: 'blur(16px)' }}>
          {!sidebarOpen && <button className="rounded-lg p-2 cursor-pointer" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={18} /></button>}
          <div className="min-w-0"><h1 className="truncate text-sm font-semibold">{activeSession?.title || 'Hermes conversation'}</h1><p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{statusLabel}</p></div>
          <button onClick={() => setRunsOpen((open) => !open)} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer" style={{ color: runsOpen ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: runsOpen ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)' }} aria-expanded={runsOpen}><Activity size={13} />Long task</button>
        </header>

        <div className="flex-1 overflow-y-auto px-4">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col py-8">
            {messages.length === 0 ? <EmptyConversation checking={connectionState === 'checking'} /> : messages.map((message) => <MessageView key={message.id} message={message} streaming={streaming && message.id === messages[messages.length - 1]?.id} />)}
            <div ref={endRef} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2">
          {pendingClarify && (
            <div className="mx-auto mb-3 max-w-3xl rounded-xl border p-3" style={{ borderColor: isSecret ? 'var(--color-warning)' : 'var(--color-accent)', background: isSecret ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)' : 'color-mix(in srgb, var(--color-accent) 6%, transparent)' }} aria-label={isSecret ? 'Secret input required' : 'Clarification needed'}>
              <div className="flex items-start gap-2">
                {isSecret ? <Key size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--color-warning)' }} /> : <HelpCircle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />}
                <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{pendingClarify.question}</p>
              </div>
              {isSecret ? (
                <div className="mt-2 flex gap-2">
                  <div className="relative flex-1">
                    <input type={secretVisible ? 'text' : 'password'} value={secretValue} onChange={(e) => setSecretValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitSecretAnswer(); } }} placeholder="Enter secret value…" className="w-full rounded-lg border bg-transparent py-1.5 pl-2.5 pr-8 text-xs outline-none" style={{ borderColor: 'var(--color-input-border)' }} autoComplete="off" />
                    <button type="button" onClick={() => setSecretVisible((v) => !v)} className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5" aria-label={secretVisible ? 'Hide secret' : 'Show secret'}>{secretVisible ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                  </div>
                  <button disabled={!canSubmitSecret} onClick={submitSecretAnswer} aria-label="Submit secret" className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}><Send size={13} /></button>
                </div>
              ) : (
                <p className="mt-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Type your answer below and press Send.</p>
              )}
            </div>
          )}
          {error && <div role="alert" className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--color-error) 9%, transparent)', color: 'var(--color-error)' }}><CircleAlert size={14} className="mt-0.5 shrink-0" /><span className="flex-1">{error}</span>{connectionState === 'error' && <button onClick={disconnect} className="shrink-0 underline cursor-pointer">Reconnect</button>}</div>}
          <form onSubmit={send} className="mx-auto max-w-3xl rounded-2xl border p-2 shadow-sm" style={{ borderColor: 'var(--color-input-border)', background: 'var(--color-input-bg)' }} aria-label="Chat form">
            <textarea aria-label="Message Hermes" rows={2} placeholder={connectionState === 'checking' ? 'Checking Hermes…' : pendingClarify && !isSecret ? 'Answer the question…' : 'Message Hermes…'} className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onComposerKeyDown} disabled={connectionState === 'checking'} />
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1">
                <VoiceCapture profile={profile} disabled={!canSend} onTranscript={(text) => setInput((current) => `${current}${current ? ' ' : ''}${text}`)} />
                <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Enter to send · Shift+Enter for a new line</span>
              </div>
              <button type={streaming ? 'button' : 'submit'} onClick={streaming ? () => abort.current?.abort() : undefined} disabled={!streaming && !canSend} aria-label={streaming ? 'Stop response' : 'Send message'} className="grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40 cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{streaming ? <Square size={13} fill="currentColor" /> : <Send size={14} />}</button></div>
          </form>
        </div>
      </section>
      {runsOpen && <RunsPanel profile={profile} onClose={() => setRunsOpen(false)} />}
    </main>
  );
}

function MessageView({ message, streaming }: { message: Message; streaming: boolean }) {
  if (message.role === 'user') return <article className="mb-7 ml-auto flex max-w-[85%] items-start gap-3"><div className="rounded-2xl rounded-tr-md px-4 py-2.5 text-sm whitespace-pre-wrap" style={{ background: 'var(--color-user-bubble)', color: 'var(--color-user-bubble-text)' }}>{message.text}</div><span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}><User size={14} /></span></article>;
  return <article className="mb-8 flex items-start gap-3"><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}><Bot size={16} /></span><div className="min-w-0 flex-1"><div className="mb-2 text-xs font-semibold">Hermes</div>{message.activity && <ResponseActivityTimeline activity={message.activity} />}{message.text ? <div className="prose max-w-none text-sm"><ReactMarkdown>{message.text}</ReactMarkdown></div> : streaming ? <div className="flex items-center gap-1 py-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--color-accent)' }} /><span className="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" style={{ background: 'var(--color-accent)' }} /><span className="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" style={{ background: 'var(--color-accent)' }} /></div> : null}</div></article>;
}

function EmptyConversation({ checking }: { checking: boolean }) {
  return <div className="flex flex-1 items-center justify-center py-16"><div className="max-w-md text-center"><span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', boxShadow: '0 0 30px var(--color-accent-glow)' }}><Bot size={27} /></span><h2 className="text-xl font-semibold tracking-tight">What can Hermes help with?</h2><p className="mt-2 text-sm leading-6" style={{ color: 'var(--color-text-secondary)' }}>{checking ? 'Verifying your Hermes connection…' : 'Responses stream directly from your Hermes VM. Tool and reasoning activity will appear alongside the answer as Hermes reports it.'}</p></div></div>;
}

interface ConnectionScreenProps { url: string; apiKey: string; connecting: boolean; error: string; onUrl: (value: string) => void; onKey: (value: string) => void; onConnect: (event: FormEvent) => void }
function ConnectionScreen(props: ConnectionScreenProps) {
  return <main className="relative grid h-full place-items-center overflow-auto p-6" style={{ background: 'var(--color-bg)' }}><div className="hud-backdrop" aria-hidden="true" /><div className="relative z-10 w-full max-w-md rounded-2xl border p-7 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><span className="mb-5 grid h-11 w-11 place-items-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}><Cable size={21} /></span><h1 className="text-2xl font-semibold tracking-tight">Connect to Hermes</h1><p className="mt-2 text-sm leading-6" style={{ color: 'var(--color-text-secondary)' }}>Use your existing Hermes API. Desktop builds store the key in your operating system's credential vault; browser development keeps it only for the current tab.</p><form onSubmit={props.onConnect} className="mt-6 space-y-4"><label className="block text-xs font-medium">API base URL<input className="mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ borderColor: 'var(--color-input-border)' }} value={props.url} onChange={(e) => props.onUrl(e.target.value)} placeholder="https://your-hermes-vm" /></label><label className="block text-xs font-medium">API key<input type="password" className="mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ borderColor: 'var(--color-input-border)' }} value={props.apiKey} onChange={(e) => props.onKey(e.target.value)} autoComplete="off" /></label>{props.error && <p role="alert" className="flex items-start gap-2 rounded-lg p-2.5 text-xs" style={{ color: 'var(--color-error)', background: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}><CircleAlert size={14} className="shrink-0" />{props.error}</p>}<button disabled={props.connecting} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium disabled:opacity-60 cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{props.connecting ? 'Connecting…' : 'Connect to Hermes'}{!props.connecting && <ChevronLeft size={15} className="rotate-180" />}</button></form></div></main>;
}
