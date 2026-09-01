import { Check, ChevronDown, CircleAlert, LoaderCircle, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { ResponseActivity } from '../../hermes/activity';

export function ResponseActivityTimeline({ activity }: { activity: ResponseActivity }) {
  const [expanded, setExpanded] = useState(true);
  if (activity.items.length === 0) return null;
  const active = activity.items.filter((item) => item.status === 'running').length;
  const summary = active > 0 ? `${active} ${active === 1 ? 'activity' : 'activities'} running` : `${activity.items.length} ${activity.items.length === 1 ? 'activity' : 'activities'}`;

  return (
    <section className="mb-4 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }} aria-label="Response activity">
      <button type="button" className="flex w-full items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        {active > 0 ? <LoaderCircle size={13} className="animate-spin" style={{ color: 'var(--color-accent)' }} /> : <Check size={13} style={{ color: 'var(--color-success)' }} />}
        <span className="flex-1 text-left">{summary}</span>
        <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <ol className="relative mt-3 ml-1 space-y-3 border-l pl-4" style={{ borderColor: 'var(--color-border)' }}>
          {activity.items.map((item) => (
            <li key={item.id} className="relative min-w-0">
              <span className="absolute -left-[21px] top-0.5 flex h-3 w-3 items-center justify-center rounded-full" style={{ background: 'var(--color-bg-secondary)' }}>
                {item.status === 'running' ? <LoaderCircle size={11} className="animate-spin" style={{ color: 'var(--color-accent)' }} /> : item.status === 'failed' ? <CircleAlert size={11} style={{ color: 'var(--color-error)' }} /> : <Check size={11} style={{ color: 'var(--color-success)' }} />}
              </span>
              <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {item.kind === 'tool' && <Wrench size={11} style={{ color: 'var(--color-text-tertiary)' }} />}
                <span className="truncate">{item.label}</span>
              </div>
              {item.detail && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{item.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
