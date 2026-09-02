import { Channel, invoke } from '@tauri-apps/api/core';
import { normalizeCapabilities } from './capabilities';
import { HermesApiError, redactSecrets } from './errors';
import { isTauriRuntime } from './auth';
import type { HermesCapabilities, HermesConnectionProfile } from './types';

interface NativeResponse { status: number; body: string; headers: Record<string, string> }
type NativeStreamEvent =
  | { type: 'metadata'; status: number; headers: Record<string, string> }
  | { type: 'chunk'; data: number[] }
  | { type: 'end' }
  | { type: 'error'; message: string };

export function normalizeBaseUrl(input: string, allowInsecure = false): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a valid Hermes API URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Hermes URL must use HTTP or HTTPS');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Remote Hermes connections require HTTPS');
  url.pathname = url.pathname.replace(/\/+$/, ''); url.search = ''; url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function headersRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
}

function nativeInput(path: string, init: RequestInit, timeoutMs: number) {
  return { path, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : undefined, headers: headersRecord(new Headers(init.headers)), timeoutMs };
}

export class HermesClient {
  readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly native: boolean;
  constructor(private readonly profile: HermesConnectionProfile, fetcher?: typeof fetch) {
    this.baseUrl = normalizeBaseUrl(profile.baseUrl, profile.allowInsecure);
    this.native = !fetcher && isTauriRuntime();
    this.fetcher = fetcher
      ? ((input, init) => fetcher.call(globalThis, input, init)) as typeof fetch
      : ((input, init) => globalThis.fetch(input, init)) as typeof fetch;
  }
  async request<T>(path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(init.headers);
    if (!this.native) headers.set('Authorization', `Bearer ${this.profile.apiKey ?? ''}`);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (init.method === 'POST' && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key', crypto.randomUUID());
    try {
      let response: Response;
      if (this.native) {
        const result = await invoke<NativeResponse>('hermes_request', { input: nativeInput(path, { ...init, headers }, timeoutMs) });
        response = new Response(result.body, { status: result.status, headers: result.headers });
      } else {
        response = await this.fetcher(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers, signal: init.signal ?? controller.signal });
      }
      if (!response.ok) {
        let detail = response.statusText || `HTTP ${response.status}`; let code: string | undefined;
        try { const body = await response.json() as { error?: string | { message?: string; code?: string }; message?: string }; const err = body.error; detail = typeof err === 'string' ? err : err?.message ?? body.message ?? detail; code = typeof err === 'object' ? err.code : undefined; } catch { /* non-json */ }
        throw new HermesApiError(redactSecrets(detail, [this.profile.apiKey]), response.status, code, response.headers.get('retry-after') ?? undefined);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } catch (error) {
      if (error instanceof HermesApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new HermesApiError('Hermes request timed out');
      throw new HermesApiError(redactSecrets(error instanceof Error ? error.message : String(error), [this.profile.apiKey]));
    } finally { clearTimeout(timer); }
  }
  health() { return this.request<Record<string, unknown>>('/health'); }
  async fetchCapabilities(): Promise<HermesCapabilities> { return normalizeCapabilities(await this.request('/v1/capabilities')); }
  async stream(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'text/event-stream');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (init.method === 'POST') headers.set('Idempotency-Key', crypto.randomUUID());
    if (!this.native) {
      headers.set('Authorization', `Bearer ${this.profile.apiKey ?? ''}`);
      const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
      if (!response.ok) throw new HermesApiError(`Hermes stream failed (HTTP ${response.status})`, response.status);
      return response;
    }
    const channel = new Channel<NativeStreamEvent>();
    const streamId = crypto.randomUUID();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const cancelNative = () => {
      if (cancelled) return;
      cancelled = true;
      void invoke('hermes_cancel_stream', { streamId });
    };
    init.signal?.addEventListener('abort', cancelNative, { once: true });
    let metadataResolve!: (value: { status: number; headers: Record<string, string> }) => void;
    let metadataReject!: (reason: unknown) => void;
    const metadata = new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => { metadataResolve = resolve; metadataReject = reject; });
    const body = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { cancelNative(); },
    });
    channel.onmessage = (event) => {
      if (cancelled) return;
      if (event.type === 'metadata') metadataResolve(event);
      else if (event.type === 'chunk') controller.enqueue(new Uint8Array(event.data));
      else if (event.type === 'end') controller.close();
      else { const error = new HermesApiError(event.message, undefined); metadataReject(error); controller.error(error); }
    };
    void invoke('hermes_stream', { input: nativeInput(path, { ...init, headers }, 300_000), streamId, onEvent: channel }).catch((error) => {
      if (cancelled) return;
      metadataReject(error); controller.error(error);
    });
    const info = await metadata;
    return new Response(body, { status: info.status, headers: info.headers });
  }
}
