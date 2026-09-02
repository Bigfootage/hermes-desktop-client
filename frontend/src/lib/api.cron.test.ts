import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Test the API functions for cron jobs, model switching, and runtime health.
// Mirrors the patterns from api.auth.test.ts.

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
});

afterEach(() => {
  vi.unstubAllEnvs();
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage =
    undefined;
});

async function freshApi() {
  return await import('./api');
}

// ---------------------------------------------------------------------------
// switchModel
// ---------------------------------------------------------------------------

describe('switchModel', () => {
  it('POSTs to /v1/models/switch with the model name', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
    const { switchModel: sm } = await freshApi();
    await sm('test-model');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/v1/models/switch');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-model');
  });

  it('throws on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Bad request', { status: 400 }),
    );
    const { switchModel: sm } = await freshApi();
    await expect(sm('bad-model')).rejects.toThrow('Failed to switch model');
  });
});

// ---------------------------------------------------------------------------
// fetchCronJobs
// ---------------------------------------------------------------------------

describe('fetchCronJobs', () => {
  it('returns jobs array from /v1/cron', async () => {
    const mockJobs = [
      { id: '1', name: 'Cleanup', schedule: '0 3 * * *', status: 'active', last_run_at: 1234567890, next_run_at: 1234567900 },
      { id: '2', name: 'Report', schedule: '0 9 * * 1', status: 'paused', last_run_at: null, next_run_at: null },
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobs: mockJobs }), { status: 200 }),
    );
    const { fetchCronJobs } = await freshApi();
    const jobs = await fetchCronJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe('Cleanup');
    expect(jobs[0].status).toBe('active');
    expect(jobs[1].status).toBe('paused');
  });

  it('returns empty array when no jobs key', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const { fetchCronJobs } = await freshApi();
    const jobs = await fetchCronJobs();
    expect(jobs).toEqual([]);
  });

  it('throws on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Server error', { status: 500 }),
    );
    const { fetchCronJobs } = await freshApi();
    await expect(fetchCronJobs()).rejects.toThrow('Failed to fetch cron jobs');
  });
});

// ---------------------------------------------------------------------------
// runCronJob
// ---------------------------------------------------------------------------

describe('runCronJob', () => {
  it('POSTs to /v1/cron/:id/run', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
    const { runCronJob } = await freshApi();
    await runCronJob('job-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/v1/cron/job-123/run');
  });

  it('throws on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Not found', { status: 404 }),
    );
    const { runCronJob } = await freshApi();
    await expect(runCronJob('missing')).rejects.toThrow('Failed to run cron job');
  });
});

// ---------------------------------------------------------------------------
// fetchRuntimeHealth
// ---------------------------------------------------------------------------

describe('fetchRuntimeHealth', () => {
  it('GETs /health and returns RuntimeHealth', async () => {
    const mockHealth = {
      status: 'ok',
      version: '1.2.3',
      platform: 'linux',
      uptime_seconds: 3600,
      model: 'llama3',
      engine: 'ollama',
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockHealth), { status: 200 }),
    );
    const { fetchRuntimeHealth } = await freshApi();
    const health = await fetchRuntimeHealth();
    expect(health.status).toBe('ok');
    expect(health.version).toBe('1.2.3');
    expect(health.platform).toBe('linux');
    expect(health.uptime_seconds).toBe(3600);
  });

  it('throws on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Down', { status: 503 }),
    );
    const { fetchRuntimeHealth } = await freshApi();
    await expect(fetchRuntimeHealth()).rejects.toThrow('Failed to fetch health');
  });
});