import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { BILL_STATUS } from '@/lib/status';
import { Card, PageHeader, Stat, Badge, Notice } from '@/components/ui';

export const metadata = { title: 'Administration' };

export default async function AdminHome() {
  await requireUser('admin');
  const sb = await supabaseServer();
  const [users, hospitals, { data: versions }, { data: bills }, { data: audit }] = await Promise.all([
    sb.from('users').select('role, active'),
    sb.from('hospitals').select('id', { count: 'exact', head: true }),
    sb.from('cghs_rate_versions').select('*').eq('status', 'ACTIVE').order('effective_from', { ascending: false }),
    sb.from('hospital_bills').select('status'),
    sb.from('audit_logs').select('id, at, actor_label, action, entity').order('at', { ascending: false }).limit(12),
  ]);
  const byRole = (r: string) => (users.data ?? []).filter((u) => u.role === r && u.active).length;
  const byStatus = new Map<string, number>();
  (bills ?? []).forEach((b) => byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1));
  const hasCghs = versions?.some((v) => v.rate_type === 'CGHS');

  return (
    <div className="space-y-5">
      <PageHeader title="Administration" subtitle="Users, hospitals, MOUs, rate schedules and system settings" />
      {!hasCghs && <Notice tone="red">No ACTIVE CGHS rate schedule. Every bill item will be marked “rate not found” until you <Link href="/admin/rates" className="link">upload and activate one</Link>.</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Hospital users" value={byRole('hospital')} href="/admin/users" />
        <Stat label="AMOs" value={byRole('amo')} href="/admin/users" />
        <Stat label="Finance users" value={byRole('finance')} href="/admin/users" />
        <Stat label="Management" value={byRole('management')} href="/admin/users" />
        <Stat label="Hospitals" value={hospitals.count ?? 0} href="/admin/hospitals" />
        <Stat label="Total bills" value={bills?.length ?? 0} href="/management?fy=all" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Active rate schedules" actions={<Link href="/admin/rates" className="btn btn-sm">Manage</Link>}>
          <ul className="space-y-2 text-sm">{(versions ?? []).map((v) => (
            <li key={v.id} className="flex justify-between gap-2"><span><Badge tone="navy">{v.rate_type}</Badge> {v.version_label}</span>
              <span className="text-xs text-slate-500">{fmtDate(v.effective_from)} – {v.effective_to ? fmtDate(v.effective_to) : 'open'}</span></li>))}
            {!versions?.length && <li className="text-slate-400">None</li>}
          </ul>
        </Card>
        <Card title="Bills by status">
          <ul className="space-y-1 text-sm">{[...byStatus.entries()].map(([k, n]) => (
            <li key={k} className="flex justify-between"><span>{BILL_STATUS[k]?.label ?? k}</span><b>{n}</b></li>))}
            {!byStatus.size && <li className="text-slate-400">No bills yet</li>}
          </ul>
        </Card>
        <Card title="Recent activity" actions={<Link href="/admin/audit" className="btn btn-sm">Audit log</Link>}>
          <ul className="space-y-2 text-xs">{(audit ?? []).map((a) => (
            <li key={a.id}><b>{a.action.replaceAll('_', ' ')}</b> · {a.entity}<div className="text-slate-500">{fmtDateTime(a.at)} · {a.actor_label}</div></li>))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
