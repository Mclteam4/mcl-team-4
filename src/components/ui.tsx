import Link from 'next/link';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { BILL_STATUS, MATCH, DECISION, type Tone } from '@/lib/status';

const TONES: Record<Tone, string> = {
  green: 'bg-green-50 text-green-800 ring-green-600/20',
  red: 'bg-red-50 text-red-800 ring-red-600/20',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-600/30',
  grey: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  blue: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  navy: 'bg-navy-100 text-navy-900 ring-navy-700/20',
};

export function Badge({ tone = 'grey', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}
export const StatusBadge = ({ status }: { status: string }) => {
  const s = BILL_STATUS[status] ?? { label: status, tone: 'grey' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
};
export const MatchBadge = ({ status }: { status: string }) => {
  const s = MATCH[status] ?? { label: status, tone: 'grey' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
};
export const DecisionBadge = ({ decision }: { decision: string }) => {
  const s = DECISION[decision] ?? { label: decision, tone: 'grey' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
};

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <div className={clsx('card h-full p-4', href && 'transition hover:border-navy-600')}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums',
        tone === 'green' && 'text-green-700', tone === 'red' && 'text-red-700',
        tone === 'yellow' && 'text-amber-700', (!tone || tone === 'navy') && 'text-navy-900')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label>{label}</label>
      {children}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 -my-4 overflow-x-auto">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Tabs({ items, active }: { items: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="no-print mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((t) => (
        <Link key={t.key} href={t.href}
          className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            t.key === active ? 'border-navy-800 text-navy-900' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}
          {t.count !== undefined && (
            <span className={clsx('ml-1.5 rounded-full px-1.5 text-xs', t.key === active ? 'bg-navy-800 text-white' : 'bg-slate-200 text-slate-600')}>
              {t.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function Notice({ tone = 'blue', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={clsx('rounded-md px-3 py-2 text-sm ring-1 ring-inset', TONES[tone])}>{children}</div>;
}
