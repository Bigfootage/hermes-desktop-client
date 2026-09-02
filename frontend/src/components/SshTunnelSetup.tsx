import { FormEvent, useState } from 'react';
import { CircleAlert, KeyRound, Loader, Server, User } from 'lucide-react';
import { clearTunnel, retryTunnel, tunnelStatusLabel, choosePrivateKey, setupTunnel, type SshTunnelProfile, type TunnelStatus } from '../hermes/ssh-tunnel';

export function SshTunnelGate({ status, onStatus }: { status: TunnelStatus; onStatus: (status: TunnelStatus) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const retry = async () => {
    setBusy(true); setError('');
    try { onStatus(await retryTunnel()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const edit = async () => {
    setBusy(true); setError('');
    try {
      await clearTunnel();
      onStatus({ ...status, configured: false, phase: 'unconfigured', profile: undefined, message: undefined, errorCode: undefined });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const problem = status.message || error;
  return <main className="relative grid h-full place-items-center overflow-auto p-6" style={{ background: 'var(--color-bg)' }}><div className="relative z-10 w-full max-w-md rounded-2xl border p-7 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><span className="mb-5 grid h-11 w-11 place-items-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>{status.phase === 'error' ? <CircleAlert size={21} /> : <Loader size={21} className="animate-spin" />}</span><h1 className="text-xl font-semibold">{tunnelStatusLabel(status)}</h1>{status.profile && <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{status.profile.username}@{status.profile.host}</p>}{problem && <p role="alert" className="mt-4 rounded-lg p-3 text-sm leading-6" style={{ color: 'var(--color-error)', background: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}>{problem}</p>}<div className="mt-5 flex gap-2"><button disabled={busy} onClick={() => void retry()} className="flex-1 rounded-xl py-2.5 text-sm font-medium cursor-pointer disabled:opacity-60" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>Retry</button><button disabled={busy} onClick={() => void edit()} className="rounded-xl border px-4 py-2.5 text-sm font-medium cursor-pointer disabled:opacity-60" style={{ borderColor: 'var(--color-border)' }}>Edit setup</button></div></div></main>;
}

export function SshTunnelSetup({ onConfigured }: { onConfigured: (status: TunnelStatus) => void }) {
  const [username, setUsername] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function browse() {
    setError('');
    try {
      const path = await choosePrivateKey();
      if (path) setPrivateKeyPath(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const profile: SshTunnelProfile = { username, host, port, privateKeyPath };
      onConfigured(await setupTunnel(profile));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative grid h-full place-items-center overflow-auto p-6" style={{ background: 'var(--color-bg)' }}>
      <div className="hud-backdrop" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border p-7 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <span className="mb-5 grid h-11 w-11 place-items-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}><KeyRound size={21} /></span>
        <h1 className="text-2xl font-semibold tracking-tight">Connect securely to Hermes</h1>
        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--color-text-secondary)' }}>Hermes Desktop will keep a private SSH tunnel running and reconnect it automatically. Password login is never requested or stored.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-xs font-medium"><span className="flex items-center gap-1.5"><User size={13} />SSH username</span><input required autoComplete="username" className="mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ borderColor: 'var(--color-input-border)' }} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="hermes" /></label>
          <label className="block text-xs font-medium"><span className="flex items-center gap-1.5"><Server size={13} />SSH host</span><input required className="mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ borderColor: 'var(--color-input-border)' }} value={host} onChange={(event) => setHost(event.target.value)} placeholder="vm.example.com" /></label>
          <label className="block text-xs font-medium">SSH port<input required type="number" min={1} max={65535} className="mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--color-input-border)' }} value={port} onChange={(event) => setPort(Number(event.target.value))} /></label>
          <label className="block text-xs font-medium">Private key file<div className="mt-1.5 flex gap-2"><input readOnly required aria-label="Private key file" className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--color-input-border)' }} value={privateKeyPath} placeholder="Select an OpenSSH private key" /><button type="button" onClick={() => void browse()} className="rounded-xl border px-3 text-sm font-medium cursor-pointer" style={{ borderColor: 'var(--color-border)' }}>Browse…</button></div></label>
          <p className="text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>Use an unencrypted OpenSSH key, or load a passphrase-protected key into ssh-agent first. Hermes never requests a passphrase. The key path is saved locally; the key is never exposed to JavaScript or uploaded.</p>
          {error && <p role="alert" className="flex items-start gap-2 rounded-lg p-2.5 text-xs" style={{ color: 'var(--color-error)', background: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}><CircleAlert size={14} className="shrink-0" />{error}</p>}
          <button disabled={busy || !username.trim() || !host.trim() || !privateKeyPath} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium disabled:opacity-60 cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{busy ? <><Loader size={14} className="animate-spin" />Starting tunnel…</> : 'Save and connect'}</button>
        </form>
      </div>
    </main>
  );
}
