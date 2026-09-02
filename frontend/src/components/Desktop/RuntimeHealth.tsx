import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import { fetchRuntimeHealth, checkHealth, getBase } from '../../lib/api';
import type { RuntimeHealth } from '../../lib/api';

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
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 14,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    marginBottom: 12,
  },
  statItem: {
    background: C.surface0,
    borderRadius: 6,
    padding: '8px 10px',
    border: `1px solid ${C.border}`,
  },
  statLabel: {
    fontSize: 11,
    color: C.overlay0,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: 600,
    color: C.text,
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  diagnosticSection: {
    marginTop: 14,
  },
  diagnosticTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: C.subtext0,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 8,
  },
  diagRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${C.border}`,
    fontSize: 13,
  },
  diagLabel: {
    color: C.subtext0,
  },
  diagValue: {
    color: C.text,
    fontSize: 12,
    fontFamily: 'monospace',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  diagDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    display: 'inline-block',
  },
  error: {
    color: C.red,
    fontSize: 12,
    padding: 8,
    background: `${C.red}11`,
    borderRadius: 6,
    marginBottom: 8,
  },
  loading: {
    textAlign: 'center',
    color: C.overlay0,
    fontSize: 13,
    padding: '20px 0',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuntimeHealthPanel() {
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Measure latency
      const start = performance.now();
      const reachable = await checkHealth();
      const latency = Math.round(performance.now() - start);
      setApiReachable(reachable);
      setLatencyMs(latency);

      // Fetch detailed health
      try {
        const h = await fetchRuntimeHealth();
        setHealth(h);
      } catch {
        // Detailed health may not be available; that's ok
      }

      setError(null);
    } catch (err) {
      setApiReachable(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const statusLabel =
    apiReachable === null ? 'Checking…' : apiReachable ? 'Healthy' : 'Unreachable';
  const statusBg =
    apiReachable === null
      ? C.surface0
      : apiReachable
        ? `${C.green}18`
        : `${C.red}18`;
  const statusBorder =
    apiReachable === null
      ? C.border
      : apiReachable
        ? `${C.green}40`
        : `${C.red}40`;
  const statusDotBg =
    apiReachable === null
      ? C.overlay0
      : apiReachable
        ? C.green
        : C.red;
  const statusDotShadow =
    apiReachable === null
      ? 'none'
      : apiReachable
        ? `0 0 6px ${C.green}66`
        : `0 0 6px ${C.red}66`;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Runtime Health</h3>
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

      {loading && <div style={styles.loading}>Checking connectivity…</div>}

      {!loading && (
        <>
          {/* Connection status banner */}
          <div
            style={{
              ...styles.statusBadge,
              background: statusBg,
              border: `1px solid ${statusBorder}`,
              color: apiReachable === null ? C.text : apiReachable ? C.green : C.red,
            }}
          >
            <span
              style={{
                ...styles.statusDot,
                background: statusDotBg,
                boxShadow: statusDotShadow,
              }}
            />
            {statusLabel}
          </div>

          {/* Core stats */}
          {health && (
            <div style={styles.grid}>
              <div style={styles.statItem}>
                <div style={styles.statLabel}>Version</div>
                <div style={styles.statValue}>{health.version || 'N/A'}</div>
              </div>
              <div style={styles.statItem}>
                <div style={styles.statLabel}>Platform</div>
                <div style={styles.statValue}>{health.platform || 'N/A'}</div>
              </div>
              <div style={styles.statItem}>
                <div style={styles.statLabel}>Engine</div>
                <div style={styles.statValue}>{health.engine || 'N/A'}</div>
              </div>
              <div style={styles.statItem}>
                <div style={styles.statLabel}>Active Model</div>
                <div style={styles.statValue}>{health.model || 'N/A'}</div>
              </div>
              <div style={{ ...styles.statItem, gridColumn: '1 / -1' }}>
                <div style={styles.statLabel}>Uptime</div>
                <div style={styles.statValue}>
                  {health.uptime_seconds !== undefined
                    ? formatUptime(health.uptime_seconds)
                    : 'N/A'}
                </div>
              </div>
            </div>
          )}

          {/* Connection diagnostics */}
          <div style={styles.diagnosticSection}>
            <div style={styles.diagnosticTitle}>Connection Diagnostics</div>
            <div style={styles.diagRow}>
              <span style={styles.diagLabel}>API Base URL</span>
              <span style={styles.diagValue}>{getBase()}</span>
            </div>
            <div style={styles.diagRow}>
              <span style={styles.diagLabel}>API Reachable</span>
              <span style={styles.diagValue}>
                <span
                  style={{
                    ...styles.diagDot,
                    background: apiReachable ? C.green : C.red,
                    boxShadow: apiReachable
                      ? `0 0 4px ${C.green}66`
                      : `0 0 4px ${C.red}66`,
                  }}
                />
                {apiReachable ? 'Yes' : 'No'}
              </span>
            </div>
            <div style={styles.diagRow}>
              <span style={styles.diagLabel}>Latency</span>
              <span style={styles.diagValue}>
                {latencyMs !== null ? `${latencyMs} ms` : '—'}
              </span>
            </div>
            <div style={styles.diagRow}>
              <span style={styles.diagLabel}>Health Endpoint</span>
              <span style={styles.diagValue}>
                {health ? 'OK' : 'Unavailable'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}