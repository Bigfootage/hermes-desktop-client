import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import { fetchCronJobs, runCronJob } from '../../lib/api';
import type { CronJob } from '../../lib/api';

// ---------------------------------------------------------------------------
// Colors — Catppuccin Mocha
// ---------------------------------------------------------------------------

const C = {
  bg: '#1e1e2e',
  mantle: '#181825',
  surface0: '#313244',
  surface1: '#45475a',
  surface2: '#585b70',
  text: '#cdd6f4',
  subtext0: '#a6adc8',
  overlay0: '#7f849c',
  accent: '#89b4fa',
  green: '#a6e3a1',
  red: '#f38ba8',
  peach: '#fab387',
  yellow: '#f9e2af',
  border: '#45475a',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: C.bg,
    color: C.text,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: C.text,
    margin: 0,
  },
  refreshBtn: {
    background: 'none',
    border: 'none',
    color: C.overlay0,
    cursor: 'pointer',
    fontSize: 13,
    padding: '2px 6px',
    borderRadius: 4,
  },
  jobList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  jobCard: {
    background: C.surface0,
    borderRadius: 8,
    padding: 12,
    border: `1px solid ${C.border}`,
  },
  jobHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  jobName: {
    fontSize: 13,
    fontWeight: 600,
    color: C.text,
  },
  jobSchedule: {
    fontSize: 11,
    color: C.subtext0,
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  jobMeta: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  jobMetaItem: {
    fontSize: 11,
    color: C.overlay0,
  },
  statusDot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 4,
    verticalAlign: 'middle',
  },
  runBtn: {
    padding: '3px 10px',
    borderRadius: 4,
    border: `1px solid ${C.accent}`,
    background: 'transparent',
    color: C.accent,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  runBtnRunning: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  empty: {
    textAlign: 'center',
    color: C.overlay0,
    fontSize: 13,
    padding: '20px 0',
  },
  error: {
    color: C.red,
    fontSize: 12,
    padding: 8,
    background: `${C.red}11`,
    borderRadius: 6,
    marginBottom: 8,
  },
  lastResult: {
    marginTop: 6,
    padding: '4px 8px',
    background: C.mantle,
    borderRadius: 4,
    fontSize: 11,
    color: C.subtext0,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: 60,
    overflow: 'auto',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  active: C.green,
  paused: C.yellow,
  error: C.red,
};

function formatRelativeTime(ts?: number | null): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatFutureTime(ts?: number | null): string {
  if (!ts) return '—';
  const diff = ts * 1000 - Date.now();
  if (diff < 0) return 'Due now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const data = await fetchCronJobs();
      setJobs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleRun = async (jobId: string) => {
    setRunningJobs((prev) => new Set(prev).add(jobId));
    try {
      await runCronJob(jobId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningJobs((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Cron Jobs</h3>
        <button
          style={styles.refreshBtn}
          onClick={refresh}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.surface0)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          ↻ Refresh
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading && (
        <div style={styles.empty}>Loading cron jobs…</div>
      )}

      {!loading && jobs.length === 0 && (
        <div style={styles.empty}>No cron jobs configured.</div>
      )}

      <div style={styles.jobList}>
        {jobs.map((job) => (
          <div key={job.id} style={styles.jobCard}>
            <div style={styles.jobHeader}>
              <span style={styles.jobName}>{job.name}</span>
              <span
                style={{
                  ...styles.jobMetaItem,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    ...styles.statusDot,
                    background: STATUS_COLORS[job.status] || C.overlay0,
                    boxShadow: `0 0 6px ${STATUS_COLORS[job.status] || C.overlay0}44`,
                  }}
                />
                {job.status}
              </span>
            </div>

            <div style={styles.jobSchedule}>
              {job.schedule || 'No schedule'}
              {job.command ? ` → ${job.command}` : ''}
            </div>

            <div style={styles.jobMeta}>
              <span style={styles.jobMetaItem}>
                Last: {formatRelativeTime(job.last_run_at)}
                {job.last_run_at ? ` (${new Date(job.last_run_at * 1000).toLocaleTimeString()})` : ''}
              </span>
              <span style={styles.jobMetaItem}>
                Next: {formatFutureTime(job.next_run_at)}
              </span>
              <button
                style={{
                  ...styles.runBtn,
                  ...(runningJobs.has(job.id) ? styles.runBtnRunning : {}),
                  marginLeft: 'auto',
                }}
                onClick={() => handleRun(job.id)}
                disabled={runningJobs.has(job.id)}
              >
                {runningJobs.has(job.id) ? '⏳ Running…' : '▶ Run now'}
              </button>
            </div>

            {job.last_result && (
              <div style={styles.lastResult}>
                {job.last_result.length > 200
                  ? `${job.last_result.slice(0, 200)}…`
                  : job.last_result}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}