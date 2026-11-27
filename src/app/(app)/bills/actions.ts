'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { actionUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { uploadDocument } from '@/lib/documents';
import { readTabular } from '@/lib/excel';
import { flushEmails } from '@/lib/email';
import { startVerificationRound } from '@/lib/verification/run';
import { CATEGORIES } from '@/lib/status';
import type { ActionResult } from '@/components/ActionForm';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const refresh = (billId?: string) => {
  revalidatePath('/', 'layout');
  after(() => flushEmails().catch(() => undefined));
  if (billId) revalidatePath(`/bills/${billId}`);
};
const fail = (e: unknown): ActionResult => ({ error: e instanceof Error ? e.message : String(e) });
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

const CAT_KEYS = CATEGORIES.map(([k]) => k) as string[];
const toCategory = (v: string) => {
  const u = v.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (CAT_KEYS.includes(u)) return u;
  const byLabel = CATEGORIES.find(([, l]) => l.toUpperCase() === v.trim().toUpperCase());
  if (byLabel) return byLabel[0];
  if (u.startsWith('MED') || u === 'DRUG') return 'MEDICINE';
  if (u.startsWith('INV') || u === 'TEST' || u === 'LAB') return 'INVESTIGATION';
  if (u.startsWith('ROOM') || u === 'BED') return 'ROOM_RENT';
  if (u.startsWith('PROC') || u === 'SURGERY') return 'PROCEDURE';
  if (u.startsWith('CONSULT') || u === 'VISIT') return 'CONSULTATION';
  return null;
};

const itemSchema = z.object({
  category: z.string().refine((c) => CAT_KEYS.includes(c), 'Unknown category'),
  description: z.string().min(1, 'Description is required').max(300),
  cghs_code: z.string().max(40).optional().transform((v) => v || null),
  specification: z.string().max(120).default(''),
  unit: z.string().max(40).default(''),
  quantity: z.coerce.number().positive('Quantity must be more than 0').max(100000),
  rate_claimed: z.coerce.number().min(0, 'Rate cannot be negative').max(1e8),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')).transform((v) => v || null),
});

// =============================================================== HOSPITAL
export async function createBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const u = await actionUser('hospital');
    const sb = await supabaseServer();
    const { data: ref } = await sb.from('patient_referrals').select('id, referring_amo_id, status').eq('id', s(fd, 'referral_id')).maybeSingle();
    if (!ref || ref.status !== 'ACTIVE') return { error: 'A valid active referral is required to submit a bill.' };
    if (!s(fd, 'hospital_bill_no') || !s(fd, 'bill_date')) return { error: 'Hospital bill number and date are required.' };
    const { data, error } = await sb.from('hospital_bills').insert({
      referral_id: ref.id, hospital_id: u.hospital_id, amo_id: ref.referring_amo_id, created_by: u.id,
      hospital_bill_no: s(fd, 'hospital_bill_no'), bill_date: s(fd, 'bill_date'), bill_type: s(fd, 'bill_type') || 'FINAL',
    }).select('id').single();
    if (error) return { error: error.code === '23505' ? 'A bill with this number (or a final bill for this referral) already exists.' : error.message };
    id = data.id;
  } catch (e) { return fail(e); }
  redirect(`/bills/${id}`);
}

export async function addItem(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('hospital');
    const billId = s(fd, 'bill_id');
    const parsed = itemSchema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
    const sb = await supabaseServer();
    const { data: last } = await sb.from('hospital_bill_items').select('line_no').eq('bill_id', billId)
      .order('line_no', { ascending: false }).limit(1).maybeSingle();
    const { error } = await sb.from('hospital_bill_items').insert({ ...parsed.data, bill_id: billId, line_no: (last?.line_no ?? 0) + 1 });
    if (error) return { error: error.message.includes('row-level') ? 'This bill can no longer be edited.' : error.message };
    refresh(billId);
    return { ok: 'Item added.' };
  } catch (e) { return fail(e); }
}

export async function deleteItem(fd: FormData) {
  await actionUser('hospital');
  const sb = await supabaseServer();
  await sb.from('hospital_bill_items').delete().eq('id', s(fd, 'item_id')).eq('bill_id', s(fd, 'bill_id'));
  refresh(s(fd, 'bill_id'));
}

export async function importItems(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('hospital');
    const billId = s(fd, 'bill_id');
    const rows = await readTabular(fd.get('file') as File);
    const errors: string[] = [];
    const clean = rows.map((r, i) => {
      const cat = toCategory(r.category ?? r.item_category ?? '');
      const p = itemSchema.safeParse({
        category: cat ?? '', description: r.description ?? r.item_description ?? r.item ?? '',
        cghs_code: r.cghs_code ?? r.code ?? '', specification: r.specification ?? r.spec ?? '', unit: r.unit ?? '',
        quantity: r.quantity ?? r.qty, rate_claimed: r.rate_claimed ?? r.rate ?? r.unit_rate,
        service_date: r.service_date ?? r.date ?? '',
      });
      if (!p.success) errors.push(`Row ${i + 2}: ${p.error.issues.map((x) => x.message).join(', ')}`);
      return p.success ? p.data : null;
    });
    if (errors.length) return { error: `Nothing imported. Fix these rows: ${errors.slice(0, 8).join(' | ')}${errors.length > 8 ? ` …and ${errors.length - 8} more` : ''}` };
    const sb = await supabaseServer();
    const { data: last } = await sb.from('hospital_bill_items').select('line_no').eq('bill_id', billId)
      .order('line_no', { ascending: false }).limit(1).maybeSingle();
    const start = last?.line_no ?? 0;
    const { error } = await sb.from('hospital_bill_items').insert(clean.map((c, i) => ({ ...c!, bill_id: billId, line_no: start + i + 1 })));
    if (error) return { error: error.message };
    refresh(billId);
    return { ok: `${clean.length} items imported.` };
  } catch (e) { return fail(e); }
}

export async function uploadBillDocs(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const u = await actionUser('hospital', 'amo', 'admin');
    const billId = s(fd, 'bill_id');
    const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return { error: 'Choose at least one file.' };
    const sb = await supabaseServer();
    for (const file of files) await uploadDocument(sb, { file, docType: s(fd, 'doc_type') || 'OTHER', userId: u.id, billId });
    refresh(billId);
    return { ok: `${files.length} document(s) uploaded.` };
  } catch (e) { return fail(e); }
}

export async function submitBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('hospital');
    await rpc('rpc_submit_bill', { p_bill: s(fd, 'bill_id') });
    refresh(s(fd, 'bill_id'));
    return { ok: 'Bill submitted to the referring AMO.' };
  } catch (e) { return fail(e); }
}

export async function acceptBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('hospital');
    if (fd.get('confirm') !== 'on') return { error: 'Tick the confirmation box to accept.' };
    await rpc('rpc_accept_bill', { p_bill: s(fd, 'bill_id') });
    refresh(s(fd, 'bill_id'));
    return { ok: 'Verified bill accepted and forwarded to Finance.' };
  } catch (e) { return fail(e); }
}

export async function raiseQuery(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const u = await actionUser('hospital');
    const billId = s(fd, 'bill_id');
    const queries: { bill_item_id: string | null; query_type: string; reason: string }[] = [];
    for (const key of fd.keys()) {
      if (!key.startsWith('q_')) continue;
      const id = key.slice(2);
      const reason = s(fd, `reason_${id}`);
      if (reason.length < 5) return { error: 'Give a reason (at least 5 characters) for every selected item.' };
      queries.push({ bill_item_id: id, query_type: s(fd, `type_${id}`) || 'OTHER', reason });
    }
    if (s(fd, 'general_reason')) queries.push({ bill_item_id: null, query_type: 'OTHER', reason: s(fd, 'general_reason') });
    if (!queries.length) return { error: 'Select at least one item or write a general observation.' };
    const ids = (await rpc('rpc_raise_query', { p_bill: billId, p_queries: queries })) as string[] | null;
    const file = fd.get('file');
    if (file instanceof File && file.size > 0 && ids?.length) {
      const sb = await supabaseServer();
      await uploadDocument(sb, { file, docType: 'QUERY_SUPPORT', userId: u.id, billId, queryId: ids[0] });
    }
    refresh(billId);
    return { ok: 'Query sent to the AMO.' };
  } catch (e) { return fail(e); }
}

export async function clarifyFinance(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('hospital');
    if (s(fd, 'note').length < 5) return { error: 'Describe the clarification provided.' };
    await rpc('rpc_hospital_clarify', { p_bill: s(fd, 'bill_id'), p_note: s(fd, 'note') });
    refresh(s(fd, 'bill_id'));
    return { ok: 'Clarification sent to Finance.' };
  } catch (e) { return fail(e); }
}

// =============================================================== AMO
export async function startRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const billId = s(fd, 'bill_id');
  try {
    const u = await actionUser('amo');
    await startVerificationRound(billId, u.id);
    refresh(billId);
  } catch (e) { return fail(e); }
  redirect(`/bills/${billId}/verify`);
}

export async function requestRevision(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('amo');
    await rpc('rpc_request_revision', { p_bill: s(fd, 'bill_id'), p_reason: s(fd, 'reason') });
    refresh(s(fd, 'bill_id'));
    return { ok: 'Bill returned to hospital for revision.' };
  } catch (e) { return fail(e); }
}

const decisionSchema = z.array(z.object({
  id: z.uuid(),
  decision: z.enum(['PENDING', 'APPROVED', 'MODIFIED', 'PARTIAL', 'DISALLOWED']),
  admissible_qty: z.number().min(0).max(100000),
  admissible_rate: z.number().min(0).max(1e8),
  remarks: z.string().max(500).nullable(),
  suggestion_confirmed: z.boolean(),
})).max(2000);

export type DecisionRow = z.infer<typeof decisionSchema>[number];

export async function saveDecisions(billId: string, rows: DecisionRow[]): Promise<ActionResult> {
  try {
    const u = await actionUser('amo');
    const parsed = decisionSchema.safeParse(rows);
    if (!parsed.success) return { error: 'Invalid verification data.' };
    const sb = await supabaseServer();
    const problems: string[] = [];
    for (const r of parsed.data) {
      const needsRemark = ['DISALLOWED', 'MODIFIED', 'PARTIAL'].includes(r.decision);
      if (needsRemark && (r.remarks ?? '').trim().length < 3) { problems.push('remark missing'); continue; }
      const { error, count } = await sb.from('bill_verification_items').update({
        decision: r.decision,
        admissible_qty: r.decision === 'DISALLOWED' ? 0 : r.admissible_qty,
        admissible_rate: r.admissible_rate,
        remarks: r.remarks?.trim() || null,
        suggestion_confirmed: r.suggestion_confirmed,
        decided_by: u.id, decided_at: new Date().toISOString(),
      }, { count: 'exact' }).eq('id', r.id);
      if (error) problems.push(error.message.includes('check constraint') ? 'remark required for manual decisions on yellow/grey items' : error.message);
      else if (count === 0) problems.push('round is no longer open');
    }
    refresh(billId);
    if (problems.length) return { error: `${problems.length} item(s) not saved: ${[...new Set(problems)].join('; ')}` };
    return { ok: `Saved ${parsed.data.length} item decision(s).` };
  } catch (e) { return fail(e); }
}

export async function approveAllGreen(billId: string, verificationId: string): Promise<ActionResult> {
  try {
    await actionUser('amo');
    const n = await rpc('rpc_approve_green', { p_verification: verificationId });
    refresh(billId);
    return { ok: `${n} green item(s) approved.` };
  } catch (e) { return fail(e); }
}

export async function sendToHospital(billId: string, verificationId: string, remarks: string): Promise<ActionResult> {
  try {
    await actionUser('amo');
    await rpc('rpc_send_to_hospital', { p_verification: verificationId, p_remarks: remarks || null });
    refresh(billId);
  } catch (e) { return fail(e); }
  redirect(`/bills/${billId}`);
}

export async function respondQuery(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('amo');
    await rpc('rpc_respond_query', { p_query: s(fd, 'query_id'), p_type: s(fd, 'type'), p_response: s(fd, 'response') });
    refresh(s(fd, 'bill_id'));
    return { ok: 'Response recorded.' };
  } catch (e) { return fail(e); }
}

// =============================================================== FINANCE
export async function financeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('finance');
    const action = s(fd, 'action');
    const payload: Record<string, unknown> = { remarks: s(fd, 'remarks') || undefined };
    if (action === 'APPROVE') {
      payload.sanctioned_amount = Number(s(fd, 'sanctioned_amount'));
      payload.approval_date = s(fd, 'approval_date') || undefined;
      const deductions = [];
      for (const k of ['tds', 'advance', 'recovery']) {
        const amt = Number(s(fd, `ded_${k}`) || 0);
        if (amt > 0) deductions.push({ label: k.toUpperCase(), amount: amt, reason: s(fd, `ded_${k}_reason`) });
      }
      payload.deductions = deductions;
    } else if (action === 'PROCESS') {
      payload.voucher_no = s(fd, 'voucher_no'); payload.sap_doc_no = s(fd, 'sap_doc_no');
    } else if (action === 'COMPLETE') {
      payload.payment_date = s(fd, 'payment_date');
    } else if (action === 'RETURN') {
      payload.target = s(fd, 'target'); payload.reason = s(fd, 'reason');
    }
    await rpc('rpc_finance_action', { p_bill: s(fd, 'bill_id'), p_action: action, p_payload: payload });
    refresh(s(fd, 'bill_id'));
    return { ok: 'Finance record updated.' };
  } catch (e) { return fail(e); }
}

// =============================================================== NOTIFICATIONS
export async function markRead(fd: FormData) {
  const u = await actionUser();
  const sb = await supabaseServer();
  await sb.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('id', String(fd.get('id') ?? '')).eq('user_id', u.id);
  revalidatePath('/', 'layout');
}

export async function markAllRead() {
  const u = await actionUser();
  const sb = await supabaseServer();
  await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', u.id).is('read_at', null);
  revalidatePath('/', 'layout');
}
