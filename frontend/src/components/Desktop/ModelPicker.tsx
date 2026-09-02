import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import { fetchModels, switchModel, fetchServerInfo } from '../../lib/api';
import type { ModelInfo } from '../../types';

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
  activeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 6,
    background: C.surface0,
    border: `1px solid ${C.accent}`,
    fontSize: 13,
    fontWeight: 500,
    color: C.text,
    marginBottom: 12,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: C.green,
    boxShadow: `0 0 6px ${C.green}66`,
  },
  selectLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: C.subtext0,
    marginBottom: 6,
  },
  select: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    background: C.mantle,
    border: `1px solid ${C.border}`,
    color: C.text,
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  modelCount: {
    fontSize: 11,
    color: C.overlay0,
    marginTop: 8,
    textAlign: 'right',
  },
  switchBtn: {
    display: 'block',
    width: '100%',
    marginTop: 8,
    padding: '8px 12px',
    borderRadius: 6,
    border: 'none',
    background: C.accent,
    color: C.bg,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'center',
  },
  switchBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  error: {
    color: C.red,
    fontSize: 12,
    padding: 8,
    background: `${C.red}11`,
    borderRadius: 6,
    marginBottom: 8,
  },
  success: {
    color: C.green,
    fontSize: 12,
    padding: 8,
    background: `${C.green}11`,
    borderRadius: 6,
    marginBottom: 8,
  },
  loading: {
    textAlign: 'center',
    color: C.overlay0,
    fontSize: 13,
    padding: '20px 0',
  },
  empty: {
    textAlign: 'center',
    color: C.overlay0,
    fontSize: 13,
    padding: '20px 0',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModelPicker() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeModel, setActiveModel] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [modelList, serverInfo] = await Promise.all([
        fetchModels(),
        fetchServerInfo().catch(() => null),
      ]);
      setModels(modelList);
      const current = serverInfo?.model || '';
      setActiveModel(current);
      if (!selectedModel) {
        setSelectedModel(current);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSwitch = async () => {
    if (!selectedModel || selectedModel === activeModel) return;
    setSwitching(true);
    setError(null);
    setSuccess(null);
    try {
      await switchModel(selectedModel);
      setActiveModel(selectedModel);
      setSuccess(`Switched to ${selectedModel}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSwitching(false);
    }
  };

  const isSameModel = selectedModel === activeModel;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Model Picker</h3>
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
      {success && <div style={styles.success}>{success}</div>}

      {/* Active model display */}
      {activeModel && (
        <div style={styles.activeBadge}>
          <span style={styles.activeDot} />
          <span>Active: {activeModel}</span>
        </div>
      )}

      {loading && <div style={styles.loading}>Loading models…</div>}

      {!loading && models.length === 0 && (
        <div style={styles.empty}>No models available.</div>
      )}

      {!loading && models.length > 0 && (
        <>
          <label style={styles.selectLabel}>Select model</label>
          <select
            style={styles.select}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} {m.id === activeModel ? '(active)' : ''}
                {m.owned_by ? ` [${m.owned_by}]` : ''}
              </option>
            ))}
          </select>

          <div style={styles.modelCount}>
            {models.length} model{models.length !== 1 ? 's' : ''} available
          </div>

          <button
            style={{
              ...styles.switchBtn,
              ...(isSameModel ? styles.switchBtnDisabled : {}),
            }}
            onClick={handleSwitch}
            disabled={isSameModel || switching}
          >
            {switching ? 'Switching…' : isSameModel ? 'Already active' : 'Switch Model'}
          </button>
        </>
      )}
    </div>
  );
}