import 'server-only';
import { supabaseServer } from './supabase/server';
import { finYear, finYearRange, num } from './format';
import { WITH_AMO, WITH_FINANCE, WITH_HOSPITAL, BILL_STATUS } from './status';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Filters { fy?: string; year?: string; hospital?: string; area?: string; amo?: string; status?: string; from?: string; to?: string }

/** Bills visible to the caller (RLS) matching the dashboard filters. Date basis: submission date. */
export async function filteredBills(f: Filters) {
  const sb = await supabaseServer();
  let q = sb.from('bill_overview').select('*').neq('status', 'DRAFT').order('submitted_at', { ascending: true }).limit(10000);
  let from = f.from, to = f.to;
  if (!from && !to && f.fy && f.fy !== 'all') ({ from, to } = finYearRange(f.fy));
  if (!from && !to && f.year) { from = `${f.year}-01-01`; to = `${f.year}-12-31`; }
  if (from) q = q.gte('submitted_at', `${from}T00:00:00+05:30`);
  if (to) q = q.lte('submitted_at', `${to}T23:59:59+05:30`);
  if (f.hospital) q = q.eq('hospital_id', f.hospital);
  if (f.area) q = q.eq('area_id', f.area);
  if (f.amo) q = q.eq('amo_id', f.amo);
  if (f.status) q = q.eq('status', f.status);
  const { data } = await q;
  return (data ?? []) as any[];
}

const month = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' });
const monthKey = (d: string) => new Date(d).toISOString().slice(0, 7);

function groupSum(rows: any[], key: (r: any) => string | null, val: (r: any) => number) {
  const m = new Map<string, number>();
  rows.forEach((r) => { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + val(r)); });
  return [...m.entries()].map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
}

export function analyse(bills: any[]) {
  const verified = bills.filter((b) => b.final_admissible !== null && !WITH_AMO.includes(b.status) && b.status !== 'SENT_TO_HOSPITAL');
  const paid = bills.filter((b) => b.status === 'PAYMENT_COMPLETED');
  const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + num(r[k]), 0);

  const months = new Map<string, { month: string; bills: number; claimed: number; reimbursed: number }>();
  const slot = (d: string) => {
    const k = monthKey(d);
    if (!months.has(k)) months.set(k, { month: month(d), bills: 0, claimed: 0, reimbursed: 0 });
    return months.get(k)!;
  };
  bills.forEach((b) => { if (b.submitted_at) { const s = slot(b.submitted_at); s.bills++; s.claimed += num(b.total_claimed); } });
  paid.forEach((b) => { if (b.payment_date) slot(b.payment_date).reimbursed += num(b.sanctioned_amount); });
  const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => ({ ...v, claimed: Math.round(v.claimed), reimbursed: Math.round(v.reimbursed) }));

  const category = [
    { name: 'Medicines', value: Math.round(sum(bills, 'total_medicine')) },
    { name: 'Procedures', value: Math.round(sum(bills, 'total_procedure')) },
    { name: 'Investigations', value: Math.round(sum(bills, 'total_investigation')) },
    { name: 'Room / ICU', value: Math.round(sum(bills, 'total_room')) },
    { name: 'Other', value: Math.round(sum(bills, 'total_other')) },
  ].filter((c) => c.value > 0);

  return {
    cards: {
      bills: bills.length,
      claimed: sum(bills, 'total_claimed'),
      verifiedAmount: sum(verified, 'final_admissible'),
      pendingAmo: sum(bills.filter((b) => WITH_AMO.includes(b.status)), 'total_claimed'),
      pendingHospital: sum(bills.filter((b) => WITH_HOSPITAL.includes(b.status)), 'total_claimed'),
      pendingFinance: sum(bills.filter((b) => WITH_FINANCE.includes(b.status)), 'final_admissible'),
      reimbursed: sum(paid, 'sanctioned_amount'),
      savings: verified.reduce((s, b) => s + num(b.total_claimed) - num(b.final_admissible), 0),
    },
    monthly,
    hospitalWise: groupSum(verified, (b) => b.hospital_name, (b) => num(b.final_admissible)).slice(0, 10),
    areaWise: groupSum(verified, (b) => b.area_name, (b) => num(b.final_admissible)),
    amoPending: groupSum(bills.filter((b) => WITH_AMO.includes(b.status)), (b) => b.amo_name, () => 1),
    statusDist: groupSum(bills, (b) => BILL_STATUS[b.status]?.label ?? b.status, () => 1),
    category,
    finYearNow: finYear(new Date()),
  };
}
