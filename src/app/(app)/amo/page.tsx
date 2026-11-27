import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { inr, num } from '@/lib/format';
import { Card, PageHeader, Stat, Tabs } from '@/components/ui';
import { BillTable } from '@/components/BillTable';

export const metadata = { title: 'AMO verification dashboard' };
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AmoHome({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser('amo');
  const { tab = 'new' } = await searchParams;
  const sb = await supabaseServer();
  const [{ data: bills }, { data: setting }] = await Promise.all([
    sb.from('bill_overview').select('*').order('submitted_at', { ascending: true }),
    sb.from('system_settings').select('value').eq('key', 'query_period_days').maybeSingle(),
  ]);
  const days = Number(setting?.value ?? 7);
  const all = (bills ?? []).filter((b: any) => b.status !== 'DRAFT');
  const overdueCut = Date.now() - days * 86_400_000;
  const withAmo = ['SUBMITTED', 'UNDER_VERIFICATION', 'QUERY_RAISED'];

  const buckets: { key: string; label: string; test: (b: any) => boolean }[] = [
    { key: 'new', label: 'New bills received', test: (b) => b.status === 'SUBMITTED' },
    { key: 'pending', label: 'Pending verification', test: (b) => b.status === 'UNDER_VERIFICATION' && b.current_round <= 1 },
    { key: 'review', label: 'Under review', test: (b) => (b.status === 'UNDER_VERIFICATION' && b.current_round > 1) || (b.status === 'FINANCE_RETURNED' && b.return_target === 'AMO') },
    { key: 'queries', label: 'Returned with queries', test: (b) => b.status === 'QUERY_RAISED' },
    { key: 'awaiting', label: 'Awaiting hospital acceptance', test: (b) => b.status === 'SENT_TO_HOSPITAL' },
    { key: 'verified', label: 'Verified', test: (b) => ['ACCEPTED', 'DEEMED_ACCEPTED', 'PENDING_FINANCE', 'FINANCIALLY_APPROVED', 'PAYMENT_PROCESSED', 'PAYMENT_COMPLETED'].includes(b.status) || (b.status === 'FINANCE_RETURNED' && b.return_target !== 'AMO') },
    { key: 'overdue', label: 'Overdue', test: (b) => withAmo.includes(b.status) && b.submitted_at && Date.parse(b.submitted_at) < overdueCut },
  ];
  const active = buckets.find((b) => b.key === tab) ?? buckets[0];
  const pendingAmt = all.filter((b: any) => withAmo.includes(b.status)).reduce((s: number, b: any) => s + num(b.total_claimed), 0);
  const verified = all.filter(buckets[5].test);

  return (
    <div>
      <PageHeader title="Verification dashboard" subtitle={`${user.full_name}${user.designation ? ' · ' + user.designation : ''} — bills for patients you referred`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bills with you" value={all.filter((b: any) => withAmo.includes(b.status)).length} hint={inr(pendingAmt) + ' claimed'} tone="yellow" />
        <Stat label="Open hospital queries" value={all.filter(buckets[3].test).length} tone="red" href="/amo?tab=queries" />
        <Stat label="Overdue"value={all.filter(buckets[6].test).length} hint={`with you more than ${days} days`} tone="red" href="/amo?tab=overdue" />
        <Stat label="Savings on verified bills" value={inr(verified.reduce((s: number, b: any) => s + num(b.total_claimed) - num(b.final_admissible), 0))} tone="green" />
      </div>
      <Tabs active={active.key} items={buckets.map((b) => ({ key: b.key, label: b.label, href: `/amo?tab=${b.key}`, count: all.filter(b.test).length }))} />
      <Card><BillTable bills={all.filter(active.test)} show={['hospital', 'deadline']} /></Card>
    </div>
  );
}
