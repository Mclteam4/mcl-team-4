import 'server-only';
import { supabaseServer } from './supabase/server';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

/** Everything shown on a bill page, read as the signed-in user (RLS applies). */
export async function loadBill(id: string) {
  const sb = await supabaseServer();
  const { data: bill } = await sb.from('bill_overview').select('*').eq('id', id).maybeSingle();
  if (!bill) return null;
  const [items, docs, rounds, queries, fin, audit, ref] = await Promise.all([
    sb.from('hospital_bill_items').select('*').eq('bill_id', id).order('line_no'),
    sb.from('supporting_documents').select('*').eq('bill_id', id).order('uploaded_at'),
    sb.from('bill_verification').select('*').eq('bill_id', id).order('round_no'),
    sb.from('hospital_queries').select('*, query_responses(*)').eq('bill_id', id).order('raised_at'),
    sb.from('finance_processing').select('*, payment_records(*)').eq('bill_id', id).maybeSingle(),
    sb.from('audit_logs').select('id, at, actor_label, action, new_data').eq('bill_id', id).order('at'),
    sb.from('referral_overview').select('*').eq('id', bill.referral_id).maybeSingle(),
  ]);
  const roundList = (rounds.data ?? []) as Row[];
  const submitted = [...roundList].reverse().find((r) => r.status === 'SUBMITTED') ?? null;
  const draft = roundList.find((r) => r.status === 'DRAFT') ?? null;
  const { data: decisions } = submitted
    ? await sb.from('bill_verification_items').select('*').eq('verification_id', submitted.id)
    : { data: [] as Row[] };
  const byItem = new Map((decisions ?? []).map((d: Row) => [d.bill_item_id, d]));
  return {
    bill: bill as Row,
    referral: (ref.data ?? null) as Row | null,
    items: (items.data ?? []) as Row[],
    docs: (docs.data ?? []) as Row[],
    rounds: roundList,
    submitted, draft, decisions: byItem,
    queries: (queries.data ?? []) as Row[],
    finance: (fin.data ?? null) as Row | null,
    audit: (audit.data ?? []) as Row[],
  };
}
export type LoadedBill = NonNullable<Awaited<ReturnType<typeof loadBill>>>;
