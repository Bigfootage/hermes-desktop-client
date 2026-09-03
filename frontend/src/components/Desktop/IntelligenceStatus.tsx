import { ShieldCheck } from 'lucide-react';
import { PhaseDControl } from '../../PhaseDControl';
import { deriveIntelligenceStatus, type EffectiveIntelligence } from '../../hermes/intelligence';

export function IntelligenceStatus({ intelligence }: { intelligence: EffectiveIntelligence | null }) {
  const items = intelligence ? deriveIntelligenceStatus(intelligence) : [];
  return <section aria-label="Intelligence status" className="w-[310px] rounded-xl border p-3 shadow-lg" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
    <div className="mb-2 flex items-center gap-2"><ShieldCheck size={15} style={{ color: 'var(--color-accent)' }} /><strong className="text-xs">Intelligence status</strong></div>
    {!intelligence ? <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Status unavailable on this server.</p> : <>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => <div key={item.key} className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: 'var(--color-bg-secondary)' }} title={`${item.label}: ${item.state}`}>
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: item.state === 'available' ? 'var(--color-success)' : item.state === 'unavailable' ? 'var(--color-error)' : 'var(--color-text-tertiary)' }} />
          <span className="min-w-0 truncate text-[10px]">{item.label}</span>
          <span className="ml-auto truncate text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{item.detail ?? item.state}</span>
        </div>)}
      </div>
      {intelligence.source !== 'intelligence-endpoint' && <p className="mt-2 text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>Compatibility view — unknown means not advertised.</p>}
    </>}
    <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Phase D · Windows control</div>
      <PhaseDControl />
    </div>
  </section>;
}
