import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Cable, ChevronLeft, CircleAlert, Menu, MessageSquarePlus, PanelLeftClose, Send, Square, Unplug, User, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ResponseActivityTimeline } from '../components/Chat/ResponseActivityTimeline';
import { applyResponseEvent, createResponseActivity, type ResponseActivity } from '../hermes/activity';
import { clearConnection, loadConnection, saveConnection } from '../hermes/auth';
import { HermesClient } from '../hermes/client';
import { supportsResponses } from '../hermes/capabilities';
import { streamResponse } from '../hermes/responses';
import type { HermesCapabilities, HermesConnectionProfile } from '../hermes/types';

type Message = { id: string; role: 'user' | 'assistant'; text: string; activity?: ResponseActivity };
type ConnectionState = 'checking' | 'connected' | 'streaming' | 'error';

export function HermesChatPage() {
  const initial = loadConnection();
  const [profile, setProfile] = useState<HermesConnectionProfile | null>(initial);
  const [url, setUrl] = useState(initial?.baseUrl ?? 'https://');
  const [key, setKey] = useState(initial?.apiKey ?? '');
  const [allowInsecure, setAllowInsecure] = useState(initial?.allowInsecure ?? false);
  const [capabilities, setCapabilities] = useState<HermesCapabilities | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initial ? 'checking' : 'error');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const previousId = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const endRef = useRef<HTMLDivElement | null>(null);
  const client = useMemo(() => profile ? new HermesClient(profile) : null, [profile]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    setConnectionState('checking');
    Promise.all([client.health(), client.fetchCapabilities()])
      .then(([, caps]) => {
        if (!supportsResponses(caps)) throw new Error('This Hermes server does not advertise the Responses API required by this client');
        if (active) { setCapabilities(caps); setConnectionState('connected'); setError(''); }
      })
      .catch((err) => {
        if (active) { setConnectionState('error'); setError(err instanceof Error ? err.message : String(err)); }
      });
    return () => { active = false; };
  }, [client]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function connect(e: FormEvent) {
    e.preventDefault(); setConnecting(true); setError('');
    try {
      const next = { baseUrl: url, apiKey: key, allowInsecure };
      const candidate = new HermesClient(next);
      await candidate.health();
      const caps = await candidate.fetchCapabilities();
      if (!supportsResponses(caps)) throw new Error('This Hermes server does not advertise the Responses API required by this client');
      saveConnection(next); setProfile(next); setCapabilities(caps); setConnectionState('connected');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setConnecting(false); }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!client || !text || streaming || connectionState !== 'connected') return;
    const assistantId = crypto.randomUUID();
    setInput('');
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text }, { id: assistantId, role: 'assistant', text: '', activity: createResponseActivity() }]);
    setStreaming(true); setConnectionState('streaming'); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      for await (const event of streamResponse(client, text, { previousResponseId: previousId.current, signal: controller.signal })) {
        setMessages((current) => current.map((message) => message.id === assistantId ? {
          ...message,
          text: event.delta ? message.text + event.delta : message.text,
          activity: applyResponseEvent(message.activity ?? createResponseActivity(), event),
        } : message));
        if (event.response?.id) previousId.current = event.response.id;
        if (event.type === 'error') throw new Error(typeof event.error === 'string' ? event.error : 'Hermes response failed');
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) { setError(err instanceof Error ? err.message : String(err)); setConnectionState('error'); }
    } finally {
      setStreaming(false); abort.current = undefined;
      setConnectionState((state) => state === 'error' ? state : 'connected');
    }
  }

  function newConversation() {
    if (streaming) abort.current?.abort();
    setMessages([]); setInput(''); setError(''); previousId.current = undefined;
  }

  function disconnect() {
    if (streaming) abort.current?.abort();
    clearConnection(); setProfile(null); setCapabilities(null); setMessages([]); previousId.current = undefined;
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  }

  if (!profile) return <ConnectionScreen url={url} apiKey={key} allowInsecure={allowInsecure} connecting={connecting} error={error} onUrl={setUrl} onKey={setKey} onAllowInsecure={setAllowInsecure} onConnect={connect} />;

  const statusLabel = connectionState === 'checking' ? 'Checking connection' : connectionState === 'streaming' ? 'Hermes is working' : connectionState === 'error' ? 'Connection issue' : 'Connected';
  const canSend = input.trim().length > 0 && !streaming && connectionState === 'connected';

  return (
    <main className="relative flex h-full w-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="hud-backdrop" aria-hidden="true" />
      <aside className={`${sidebarOpen ? 'w-[260px]' : 'w-0'} relative z-10 flex shrink-0 flex-col overflow-hidden transition-[width] duration-200`} style={{ background: 'var(--color-sidebar)', borderRight: sidebarOpen ? '1px solid var(--color-border)' : 'none', backdropFilter: 'blur(20px)' }}>
        <div className="flex h-full w-[260px] flex-col p-3">
          <div className="mb-5 flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}><Bot size={18} /></span><div><div className="text-sm font-semibold">Hermes</div><div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>Desktop</div></div></div>
            <button className="rounded-lg p-2 cursor-pointer hover:bg-black/5" onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar"><PanelLeftClose size={17} /></button>
          </div>
          <button onClick={newConversation} className="mb-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}><MessageSquarePlus size={16} />New conversation</button>
          <nav aria-label="Hermes navigation" className="space-y-1">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-text)' }}><Bot size={16} style={{ color: 'var(--color-accent)' }} />Conversation</div>
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><Wrench size={16} />Activity appears in chat</div>
          </nav>
          <div className="mt-auto rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium"><span className={`h-2 w-2 rounded-full ${connectionState === 'streaming' ? 'animate-pulse' : ''}`} style={{ background: connectionState === 'error' ? 'var(--color-error)' : connectionState === 'checking' ? 'var(--color-warning)' : 'var(--color-success)' }} />{statusLabel}</div>
            <p className="truncate text-[11px]" title={profile.baseUrl} style={{ color: 'var(--color-text-tertiary)' }}>{capabilities?.profile ?? profile.baseUrl}</p>
            {capabilities?.model && <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{capabilities.model}</p>}
            <button onClick={disconnect} className="mt-3 flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}><Unplug size={12} />Disconnect</button>
          </div>
        </div>
      </aside>

      <section className="relative z-[2] flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4" style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-bg) 85%, transparent)', backdropFilter: 'blur(16px)' }}>
          {!sidebarOpen && <button className="rounded-lg p-2 cursor-pointer" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={18} /></button>}
          <div className="min-w-0"><h1 className="truncate text-sm font-semibold">Hermes conversation</h1><p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{statusLabel}</p></div>
          {messages.length > 0 && <button onClick={newConversation} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}><MessageSquarePlus size={13} />New</button>}
        </header>

        <div className="flex-1 overflow-y-auto px-4">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col py-8">
            {messages.length === 0 ? <EmptyConversation checking={connectionState === 'checking'} /> : messages.map((message) => <MessageView key={message.id} message={message} streaming={streaming && message.id === messages[messages.length - 1]?.id} />)}
            <div ref={endRef} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2">
          {error && <div role="alert" className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--color-error) 9%, transparent)', color: 'var(--color-error)' }}><CircleAlert size={14} className="mt-0.5 shrink-0" /><span className="flex-1">{error}</span>{connectionState === 'error' && <button onClick={disconnect} className="shrink-0 underline cursor-pointer">Reconnect</button>}</div>}
          <form onSubmit={send} className="mx-auto max-w-3xl rounded-2xl border p-2 shadow-sm" style={{ borderColor: 'var(--color-input-border)', background: 'var(--color-input-bg)' }}>
            <textarea aria-label="Message Hermes" rows={2} placeholder={connectionState === 'checking' ? 'Checking Hermes…' : 'Message Hermes…'} className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onComposerKeyDown} disabled={connectionState === 'checking'} />
            <div className="flex items-center justify-between px-1"><span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Enter to send · Shift+Enter for a new line</span><button type={streaming ? 'button' : 'submit'} onClick={streaming ? () => abort.current?.abort() : undefined} disabled={!streaming && !canSend} aria-label={streaming ? 'Stop response' : 'Send message'} className="grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40 cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{streaming ? <Square size={13} fill="currentColor" /> : <Send size={14} />}</button></div>
          </form>
        </div>
      </section>
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

interface ConnectionScreenProps { url: string; apiKey: string; allowInsecure: boolean; connecting: boolean; error: string; onUrl: (value: string) => void; onKey: (value: string) => void; onAllowInsecure: (value: boolean) => void; onConnect: (event: FormEvent) => void }
function ConnectionScreen(props: ConnectionScreenProps) {
  return <main className="relative grid h-full place-items-center overflow-auto p-6" style={{ background: 'var(--color-bg)' }}><div className="hud-backdrop" aria-hidden="true" /><div className="relative z-10 w-full max-w-md rounded-2xl border p-7 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><span className="mb-5 grid h-11 w-11 place-items-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}><Cable size={21} /></span><h1 className="text-2xl font-semibold tracking-tight">Connect to Hermes</h1><p className="mt-2 text-sm leading-6" style={{ color: 'var(--color-text-secondary)' }}>Use your existing Hermes API. Your key remains in session storage for this desktop session.</p><form onSubmit={props.onConnect} className="mt-6 space-y-4"><label className="block text-xs font-medium">API base URL<input className="mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ borderColor: 'var(--color-input-border)' }} value={props.url} onChange={(e) => props.onUrl(e.target.value)} placeholder="https://your-hermes-vm" /></label><label className="block text-xs font-medium">API key<input type="password" className="mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ borderColor: 'var(--color-input-border)' }} value={props.apiKey} onChange={(e) => props.onKey(e.target.value)} autoComplete="off" /></label><label className="flex items-start gap-2 text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}><input className="mt-1" type="checkbox" checked={props.allowInsecure} onChange={(e) => props.onAllowInsecure(e.target.checked)} />Explicitly allow insecure HTTP for a remote host</label>{props.error && <p role="alert" className="flex items-start gap-2 rounded-lg p-2.5 text-xs" style={{ color: 'var(--color-error)', background: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}><CircleAlert size={14} className="shrink-0" />{props.error}</p>}<button disabled={props.connecting} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium disabled:opacity-60 cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{props.connecting ? 'Connecting…' : 'Connect to Hermes'}{!props.connecting && <ChevronLeft size={15} className="rotate-180" />}</button></form></div></main>;
}
