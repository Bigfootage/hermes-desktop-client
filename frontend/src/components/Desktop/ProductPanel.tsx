import { useState } from 'react';
import type React from 'react';
import { Toolbox, Settings, BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import { CronPanel } from './CronPanel';
import { ModelPicker } from './ModelPicker';
import { RuntimeHealthPanel } from './RuntimeHealth';

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
    padding: 24,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: C.text,
    margin: 0,
  },
  pageSubtitle: {
    fontSize: 13,
    color: C.subtext0,
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
    background: C.mantle,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    cursor: 'pointer',
    userSelect: 'none',
    borderBottom: '1px solid transparent',
  },
  sectionHeaderOpen: {
    borderBottom: `1px solid ${C.border}`,
  },
  sectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: C.text,
    margin: 0,
  },
  sectionCount: {
    fontSize: 12,
    color: C.subtext0,
    background: C.surface0,
    padding: '2px 8px',
    borderRadius: 10,
  },
  sectionBody: {
    padding: 16,
  },
  chevron: {
    color: C.overlay0,
    transition: 'transform 0.2s ease',
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  footer: {
    marginTop: 24,
    paddingTop: 16,
    borderTop: `1px solid ${C.border}`,
    textAlign: 'center',
    color: C.overlay0,
    fontSize: 12,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SectionKey = 'cron' | 'models' | 'health';

export function ProductPanel() {
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    cron: true,
    models: true,
    health: true,
  });

  const toggle = (section: SectionKey) => {
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const sections: Array<{
    key: SectionKey;
    label: string;
    icon: React.ReactNode;
    component: React.ReactNode;
  }> = [
    {
      key: 'health',
      label: 'Runtime Health',
      icon: <BarChart3 size={16} style={{ color: C.accent }} />,
      component: <RuntimeHealthPanel />,
    },
    {
      key: 'models',
      label: 'Model Picker',
      icon: <Settings size={16} style={{ color: C.accent }} />,
      component: <ModelPicker />,
    },
    {
      key: 'cron',
      label: 'Cron Jobs',
      icon: <Toolbox size={16} style={{ color: C.accent }} />,
      component: <CronPanel />,
    },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.pageHeader}>
        <Toolbox size={22} style={{ color: C.accent }} />
        <div>
          <h2 style={styles.pageTitle}>Product Panel</h2>
          <div style={styles.pageSubtitle}>
            Server operations, model management, and diagnostics
          </div>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.key} style={styles.section}>
          <div
            style={{
              ...styles.sectionHeader,
              ...(expanded[section.key] ? styles.sectionHeaderOpen : {}),
            }}
            onClick={() => toggle(section.key)}
            onMouseEnter={(e) => {
              if (!expanded[section.key]) {
                (e.currentTarget as HTMLElement).style.background = C.surface0;
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = '';
            }}
          >
            <div style={styles.sectionHeaderLeft}>
              {section.icon}
              <span style={styles.sectionTitle}>{section.label}</span>
            </div>
            <ChevronRight
              size={16}
              style={{
                ...styles.chevron,
                ...(expanded[section.key] ? styles.chevronOpen : {}),
              }}
            />
          </div>
          {expanded[section.key] && (
            <div style={styles.sectionBody}>{section.component}</div>
          )}
        </div>
      ))}

      <div style={styles.footer}>
        Hermes Agent Desktop · Read-only operations panel
      </div>
    </div>
  );
}