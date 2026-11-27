import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { inr, num, fmtDate } from '@/lib/format';
import { Card, PageHeader, Stat, Tabs } from '@/components/ui';
import { BillTable } from '@/components/BillTable';

export const metadata = { title: 'Hospital dashboard' };

const TABS = [
  { key: 'action', label: 'Action required', statuses: ['DRAFT', 'REVISION_REQUESTED', 'SENT_TO_HOSPITAL', 'FINANCE_RETURNED'] },
  { key: 'amo', label: 'With AMO', statuses: ['SUBMITTED', 'UNDER_VERIFICATION', 'QUERY_RAISED'] },
  { key: 'finance', label: 'With Finance', statuses: ['PENDING_FINANCE', 'FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED'] },
  { key: 'paid', label: 'Paid', statuses: ['PAYMENT_COMPLETED'] },
  { key: 'all', label: 'All bills', statuses: [] as string[] },
];

export default async function HospitalHome({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser('hospital');
  const { tab = 'action' } = await searchParams;
  const sb = await supabaseServer();
  const [{ data: hospital }, { data: mou }, { data: bills }] = await Promise.all([
    sb.from('hospitals').select('*').eq('id', user.hospital_id!).single(),
    sb.from('hospital_mou_details').select('*').eq('hospital_id', user.hospital_id!).order('valid_to', { ascending: false }).limit(1).maybeSingle(),
    sb.from('bill_overview').select('*').order('updated_at', { ascending: false }),
  ]);
  const all = bills ?? [];
  const sum = (st: string[], k = 'total_claimed') => all.filter((b) => st.includes(b.status)).reduce((s, b) => s + num(b[k]), 0);
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const list = active.statuses.length ? all.filter((b) => active.statuses.includes(b.status)) : all;

  return (
    <div>
      <PageHeader title={hospital?.name ?? 'Hospital'} subtitle={`${hospital?.city}, ${hospital?.state} · ${hospital?.nabh ? 'NABH accredited' : 'Non-NABH'} · ${String(hospital?.city_class ?? '').replace('_', ' ')}${mou ? ` · MOU ${mou.mou_no} valid till ${fmtDate(mou.valid_to)}` : ' · no MOU on record'}`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Awaiting your response" value={all.filter((b) => b.status === 'SENT_TO_HOSPITAL').length} tone="yellow" href="/hospital?tab=action" />
        <Stat label="Pending with AMO" value={inr(sum(TABS[1].statuses))} href="/hospital?tab=amo" />
        <Stat label="Pending with Finance" value={inr(sum(TABS[2].statuses, 'final_admissible'))} href="/hospital?tab=finance" />
        <Stat label="Reimbursed" value={inr(sum(['PAYMENT_COMPLETED'], 'sanctioned_amount'))} tone="green" href="/hospital?tab=paid" />
      </div>
      <Tabs active={active.key} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/hospital?tab=${t.key}`,
        count: t.statuses.length ? all.filter((b) => t.statuses.includes(b.status)).length : all.length }))} />
      <Card bodyClass="p-4"><BillTable bills={list} show={['amo', 'deadline', 'finance']} /></Card>
    </div>
  );
}
