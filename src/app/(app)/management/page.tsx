import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { filteredBills, analyse, type Filters } from '@/lib/analytics';
import { inrShort, finYear } from '@/lib/format';
import { BILL_STATUS } from '@/lib/status';
import { Card, PageHeader, Stat } from '@/components/ui';
import { BarCard, LineCard, PieCard } from '@/components/Charts';
import { BillTable } from '@/components/BillTable';

export const metadata = { title: 'Management dashboard' };

export default async function ManagementHome({ searchParams }: { searchParams: Promise<Filters> }) {
  await requireUser('management', 'admin');
  const sp = await searchParams;
  const f: Filters = { ...sp, fy: sp.fy ?? (sp.year || sp.from || sp.to ? undefined : finYear(new Date())) };
  const sb = await supabaseServer();
  const [bills, { count: hospitals }, { count: referrals }, { data: hospList }, { data: areas }, { data: amos }] = await Promise.all([
    filteredBills(f),
    sb.from('hospitals').select('id', { count: 'exact', head: true }).eq('active', true),
    sb.from('patient_referrals').select('id', { count: 'exact', head: true }),
    sb.from('hospitals').select('id, name').order('name'),
    sb.from('areas').select('id, name').order('name'),
    sb.from('user_directory').select('id, full_name').eq('role', 'amo').order('full_name'),
  ]);
  const a = analyse(bills);
  const fyNow = Number(finYear(new Date()).slice(0, 4));
  const fys = Array.from({ length: 5 }, (_, i) => `${fyNow - i}-${String((fyNow - i + 1) % 100).padStart(2, '0')}`);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-5">
      <PageHeader title="MCL medical expenditure dashboard" subtitle="Read-only overview of referrals, verification and reimbursement"
        actions={<a href={`/api/export/bills?${qs}`} className="btn"><Download className="h-4 w-4" /> Export Excel</a>} />

      <form className="card no-print grid grid-cols-2 gap-2 p-3 md:grid-cols-4 xl:grid-cols-8">
        <select name="fy" defaultValue={f.fy ?? ''} aria-label="Financial year"><option value="">FY: any</option><option value="all">All years</option>{fys.map((y) => <option key={y} value={y}>FY {y}</option>)}</select>
        <select name="year" defaultValue={f.year ?? ''} aria-label="Calendar year"><option value="">Calendar year</option>{[0, 1, 2, 3].map((i) => <option key={i}>{new Date().getFullYear() - i}</option>)}</select>
        <select name="hospital" defaultValue={f.hospital ?? ''} aria-label="Hospital"><option value="">All hospitals</option>{hospList?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        <select name="area" defaultValue={f.area ?? ''} aria-label="Area"><option value="">All areas</option>{areas?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select name="amo" defaultValue={f.amo ?? ''} aria-label="AMO"><option value="">All AMOs</option>{amos?.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select>
        <select name="status" defaultValue={f.status ?? ''} aria-label="Status"><option value="">All statuses</option>{Object.entries(BILL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <input type="date" name="from" defaultValue={f.from} aria-label="From date" />
        <div className="flex gap-2"><input type="date" name="to" defaultValue={f.to} aria-label="To date" className="min-w-0 flex-1" /><button className="btn btn-primary">Apply</button></div>
        <Link href="/management?fy=all" className="link col-span-2 text-xs">Reset filters</Link>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Hospitals registered" value={hospitals ?? 0} />
        <Stat label="Patients referred" value={referrals ?? 0} hint="all time" />
        <Stat label="Bills submitted" value={a.cards.bills} />
        <Stat label="Total claimed" value={inrShort(a.cards.claimed)} />
        <Stat label="AMO-verified amount" value={inrShort(a.cards.verifiedAmount)} tone="green" />
        <Stat label="Pending with AMOs" value={inrShort(a.cards.pendingAmo)} tone="yellow" />
        <Stat label="Pending with hospitals" value={inrShort(a.cards.pendingHospital)} tone="yellow" />
        <Stat label="Pending with Finance" value={inrShort(a.cards.pendingFinance)} tone="yellow" />
        <Stat label="Total reimbursed" value={inrShort(a.cards.reimbursed)} tone="green" />
        <Stat label="Savings vs hospital claims" value={inrShort(a.cards.savings)} tone="green" hint={a.cards.claimed ? `${((a.cards.savings / Math.max(a.cards.claimed, 1)) * 100).toFixed(1)}% of claims` : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Monthly bill submissions"><BarCard data={a.monthly} x="month" bars={[{ key: 'claimed', label: 'Amount claimed' }]} /></Card>
        <Card title="Monthly reimbursement"><LineCard data={a.monthly} x="month" lines={[{ key: 'claimed', label: 'Claimed' }, { key: 'reimbursed', label: 'Reimbursed' }]} /></Card>
        <Card title="Hospital-wise expenditure (admissible, top 10)"><BarCard data={a.hospitalWise} x="name" bars={[{ key: 'value', label: 'Admissible' }]} horizontal height={300} /></Card>
        <Card title="Area-wise expenditure (admissible)"><BarCard data={a.areaWise} x="name" bars={[{ key: 'value', label: 'Admissible', color: '#0e7490' }]} /></Card>
        <Card title="Category-wise medical expenditure (claimed)"><PieCard data={a.category} money /></Card>
        <Card title="Bill status distribution"><PieCard data={a.statusDist} /></Card>
        <Card title="AMO-wise pending verification (bills)" className="xl:col-span-2"><BarCard data={a.amoPending} x="name" bars={[{ key: 'value', label: 'Bills pending' }]} money={false} /></Card>
      </div>

      <Card title={`Bills (${bills.length})`}><BillTable bills={[...bills].reverse().slice(0, 200)} show={['hospital', 'area', 'amo', 'finance']} /></Card>
    </div>
  );
}
