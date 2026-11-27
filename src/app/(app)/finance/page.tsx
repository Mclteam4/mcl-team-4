import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { inr, num } from '@/lib/format';
import { Card, PageHeader, Stat, Tabs } from '@/components/ui';
import { BillTable } from '@/components/BillTable';
import { Download } from 'lucide-react';

export const metadata = { title: 'Finance — reimbursements' };

const TABS = [
  { key: 'pending', label: 'Pending finance verification', statuses: ['PENDING_FINANCE'] },
  { key: 'approved', label: 'Financially approved', statuses: ['FINANCIALLY_APPROVED'] },
  { key: 'processed', label: 'Payment processed', statuses: ['PAYMENT_PROCESSED'] },
  { key: 'returned', label: 'Returned for clarification', statuses: ['FINANCE_RETURNED'] },
  { key: 'completed', label: 'Payment completed', statuses: ['PAYMENT_COMPLETED'] },
];

export default async function FinanceHome({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser('finance');
  const { tab = 'pending' } = await searchParams;
  const sb = await supabaseServer();
  const { data: bills } = await sb.from('bill_overview').select('*').order('forwarded_at', { ascending: true });
  const all = bills ?? [];
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const sum = (st: string[], k: string) => all.filter((b) => st.includes(b.status)).reduce((s, b) => s + num(b[k]), 0);

  return (
    <div>
      <PageHeader title="Reimbursement processing" subtitle="Bills forwarded after hospital acceptance or expiry of the query period"
        actions={<a href="/api/export/bills?scope=finance" className="btn"><Download className="h-4 w-4" /> Export Excel</a>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Awaiting scrutiny" value={inr(sum(['PENDING_FINANCE'], 'final_admissible'))} hint={`${all.filter((b) => b.status === 'PENDING_FINANCE').length} bills`} tone="yellow" />
        <Stat label="Approved, unpaid" value={inr(sum(['FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED'], 'sanctioned_amount'))} />
        <Stat label="Paid" value={inr(sum(['PAYMENT_COMPLETED'], 'sanctioned_amount'))} tone="green" />
        <Stat label="Hospital claims reduced by" value={inr(all.reduce((s, b) => s + num(b.total_claimed) - num(b.final_admissible), 0))} tone="green" hint="AMO medical verification" />
      </div>
      <Tabs active={active.key} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/finance?tab=${t.key}`, count: all.filter((b) => t.statuses.includes(b.status)).length }))} />
      <Card><BillTable bills={all.filter((b) => active.statuses.includes(b.status))} show={['hospital', 'amo', 'finance']} /></Card>
    </div>
  );
}
