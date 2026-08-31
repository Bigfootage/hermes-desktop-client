import { normalizeCapabilities } from './capabilities';
import { HermesApiError, redactSecrets } from './errors';
import type { HermesCapabilities, HermesConnectionProfile } from './types';

export function normalizeBaseUrl(input: string, allowInsecure = false): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a valid Hermes API URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Hermes URL must use HTTP or HTTPS');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local && !allowInsecure) throw new Error('Remote Hermes connections require HTTPS');
  url.pathname = url.pathname.replace(/\/+$/, ''); url.search = ''; url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export class HermesClient {
  readonly baseUrl: string;
  constructor(private readonly profile: HermesConnectionProfile, private readonly fetcher: typeof fetch = fetch) { this.baseUrl = normalizeBaseUrl(profile.baseUrl, profile.allowInsecure); }
  async request<T>(path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${this.profile.apiKey}`); headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (init.method === 'POST' && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key', crypto.randomUUID());
    try {
      const response = await this.fetcher(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers, signal: init.signal ?? controller.signal });
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
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${this.profile.apiKey}`); headers.set('Accept', 'text/event-stream');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (init.method === 'POST') headers.set('Idempotency-Key', crypto.randomUUID());
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) throw new HermesApiError(`Hermes stream failed (HTTP ${response.status})`, response.status);
    return response;
  }
}
