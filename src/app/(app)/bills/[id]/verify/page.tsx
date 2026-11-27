import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { inr, fmtDate, num } from '@/lib/format';
import { PageHeader, Notice } from '@/components/ui';
import { VerificationTable, type VRow } from '@/components/VerificationTable';

export const metadata = { title: 'Item-wise verification' };

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser('amo');
  const sb = await supabaseServer();
  const { data: bill } = await sb.from('bill_overview').select('*').eq('id', id).maybeSingle();
  if (!bill) notFound();
  const { data: rounds } = await sb.from('bill_verification').select('*').eq('bill_id', id).order('round_no');
  const draft = rounds?.find((r) => r.status === 'DRAFT');
  if (!draft) redirect(`/bills/${id}`);
  const prev = [...(rounds ?? [])].reverse().find((r) => r.status === 'SUBMITTED');

  const [{ data: items }, { data: vitems }, { data: prevItems }, { data: queries }] = await Promise.all([
    sb.from('hospital_bill_items').select('*').eq('bill_id', id).order('line_no'),
    sb.from('bill_verification_items').select('*').eq('verification_id', draft.id),
    prev ? sb.from('bill_verification_items').select('bill_item_id, admissible_amount').eq('verification_id', prev.id) : Promise.resolve({ data: [] as { bill_item_id: string; admissible_amount: number }[] }),
    sb.from('hospital_queries').select('bill_item_id, reason, status').eq('bill_id', id).eq('verification_id', prev?.id ?? '00000000-0000-0000-0000-000000000000'),
  ]);
  const sugIds = (vitems ?? []).map((v) => v.suggested_rate_id).filter(Boolean);
  const { data: sugs } = sugIds.length ? await sb.from('cghs_rate_master').select('id, code, name, base_rate').in('id', sugIds) : { data: [] };
  const sugMap = new Map((sugs ?? []).map((s) => [s.id, s]));
  const vMap = new Map((vitems ?? []).map((v) => [v.bill_item_id, v]));
  const prevMap = new Map((prevItems ?? []).map((p) => [p.bill_item_id, num(p.admissible_amount)]));
  const qMap = new Map((queries ?? []).filter((q) => q.bill_item_id).map((q) => [q.bill_item_id, q.reason]));

  const rows: VRow[] = (items ?? []).flatMap((it) => {
    const v = vMap.get(it.id);
    if (!v) return [];
    const s = v.suggested_rate_id ? sugMap.get(v.suggested_rate_id) : null;
    return [{
      id: v.id, lineNo: it.line_no, category: it.category, description: it.description, code: it.cghs_code,
      spec: it.specification ?? '', unit: it.unit ?? '', qty: num(it.quantity), rate: num(it.rate_claimed), amount: num(it.amount_claimed),
      match: v.match_status, note: v.match_note, cghsRate: v.cghs_rate === null ? null : num(v.cghs_rate),
      proposedQty: num(v.proposed_qty), proposedRate: num(v.proposed_rate),
      decision: v.decision, admQty: num(v.admissible_qty), admRate: num(v.admissible_rate), remarks: v.remarks ?? '',
      suggestionConfirmed: v.suggestion_confirmed,
      suggestion: s ? { code: s.code, name: s.name, baseRate: num(s.base_rate) } : null,
      query: qMap.get(it.id) ?? null, prevAdmissible: prevMap.has(it.id) ? prevMap.get(it.id)! : null,
    }];
  });
  const snap = draft.rule_snapshot ?? {};

  return (
    <div className="space-y-4">
      <PageHeader title={`Verify ${bill.tracking_no} — round ${draft.round_no}`}
        subtitle={`${bill.patient_name} (${bill.employee_code}) · ${bill.hospital_name} · ${fmtDate(bill.admission_date)} – ${fmtDate(bill.discharge_date)} · claimed ${inr(bill.total_claimed)}`}
        actions={<Link href={`/bills/${id}`} className="btn">Bill details &amp; documents</Link>} />
      <Notice tone="navy">
        Rates applied: {(snap.rate_versions ?? []).map((v: { type: string; label: string }) => `${v.type} ${v.label}`).join(', ') || <b>no active rate schedule — all items need manual verification</b>}
        {' · '}rate date {fmtDate(snap.rate_reference_date)} · paid ward {String(snap.effectiveWard ?? '').replace('_', '-').toLowerCase()}
        {' · '}factors city {snap.factors?.city} × accreditation {snap.factors?.accreditation} × ward {snap.factors?.ward}
        {snap.mouDiscountPct ? ` · MOU discount ${snap.mouDiscountPct}%` : ''}
        {snap.stayDays ? ` · stay ${snap.stayDays} day(s)` : ''}
      </Notice>
      <VerificationTable billId={id} verificationId={draft.id} roundNo={draft.round_no} initial={rows} />
    </div>
  );
}
