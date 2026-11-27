'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actionUser } from '@/lib/auth';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';
import { readTabular } from '@/lib/excel';
import { CATEGORIES } from '@/lib/status';
import type { ActionResult } from '@/components/ActionForm';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (e: unknown): ActionResult => ({ error: e instanceof Error ? e.message : String(e) });
const done = (msg: string): ActionResult => { revalidatePath('/', 'layout'); return { ok: msg }; };

// ------------------------------------------------------------------ users
export async function createUser(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('admin');
    const p = z.object({
      email: z.email(), full_name: z.string().min(2), role: z.enum(['admin', 'hospital', 'amo', 'finance', 'management']),
      password: z.string().min(10, 'Temporary password must be at least 10 characters'),
      hospital_id: z.string().optional(), area_id: z.string().optional(), designation: z.string().optional(), employee_code: z.string().optional(),
      login_id: z.string().optional(),
    }).safeParse(Object.fromEntries(fd));
    if (!p.success) return { error: p.error.issues.map((i) => i.message).join('; ') };
    const d = p.data;
    const loginId = (d.login_id ?? '').trim().toLowerCase() || null;
    if (loginId && !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(loginId)) return { error: 'User ID: 3–40 lowercase letters or numbers (dot, dash, underscore allowed).' };
    if (d.role === 'hospital' && !d.hospital_id) return { error: 'Select the hospital for a hospital user.' };
    if (d.role === 'amo' && !d.area_id) return { error: 'Select the Area for an AMO.' };
    const admin = supabaseAdmin();
    const { data: created, error } = await admin.auth.admin.createUser({ email: d.email.toLowerCase(), password: d.password, email_confirm: true });
    if (error) return { error: error.message };
    const { error: e2 } = await admin.from('users').insert({
      id: created.user.id, email: d.email.toLowerCase(), full_name: d.full_name, role: d.role,
      hospital_id: d.role === 'hospital' ? d.hospital_id : null, area_id: d.area_id || null,
      designation: d.designation || null, employee_code: d.employee_code || null, login_id: loginId,
    });
    if (e2) {
      await admin.auth.admin.deleteUser(created.user.id);
      return { error: e2.code === '23505' && e2.message.includes('login_id') ? `User ID "${loginId}" is already taken.` : e2.message };
    }
    await admin.from('audit_logs').insert({ actor_label: 'Administrator', entity: 'users', entity_id: created.user.id, action: 'USER_CREATED', new_data: { email: d.email, role: d.role } });
    return done(`User ${d.email} created. Share the temporary password securely; they can change it via “Forgot password”.`);
  } catch (e) { return fail(e); }
}

/** The "connected email" that receives bill notifications (empty = use the login email). */
export async function setNotifyEmail(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('admin');
    const value = s(fd, 'notify_email').toLowerCase();
    if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { error: 'Enter a valid email address, or leave it empty to use the login email.' };
    const sb = await supabaseServer();
    const { error, count } = await sb.from('users').update({ notify_email: value || null }, { count: 'exact' }).eq('id', s(fd, 'id'));
    if (error) return { error: error.message };
    if (!count) return { error: 'Not permitted to change this user.' };
    return done(value ? `Saved. Notices go to ${value}.` : 'Saved. Notices go to the login email.');
  } catch (e) { return fail(e); }
}

export async function setUserActive(fd: FormData) {
  await actionUser('admin');
  const id = s(fd, 'id'); const active = s(fd, 'active') === 'true';
  const sb = await supabaseServer();
  await sb.from('users').update({ active }).eq('id', id);
  await supabaseAdmin().auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
  revalidatePath('/admin/users');
}

export async function createDelegation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const u = await actionUser('admin');
    const sb = await supabaseServer();
    const { error } = await sb.from('amo_doctor_mapping').insert({
      amo_user_id: s(fd, 'amo_user_id'), delegate_user_id: s(fd, 'delegate_user_id'),
      valid_from: s(fd, 'valid_from'), valid_to: s(fd, 'valid_to') || null, reason: s(fd, 'reason'), created_by: u.id,
    });
    return error ? { error: error.message } : done('Delegation saved.');
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ hospitals, MOUs, areas
export async function createHospital(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('admin');
    const sb = await supabaseServer();
    const { error } = await sb.from('hospitals').insert({
      code: s(fd, 'code').toUpperCase(), name: s(fd, 'name'), address: s(fd, 'address') || null, city: s(fd, 'city'), state: s(fd, 'state'),
      city_class: s(fd, 'city_class'), nabh: fd.get('nabh') === 'on', super_specialty: fd.get('super_specialty') === 'on',
      empanelled: fd.get('empanelled') !== 'off', gstin: s(fd, 'gstin') || null, pan: s(fd, 'pan') || null,
      contact_email: s(fd, 'contact_email') || null, contact_phone: s(fd, 'contact_phone') || null,
    });
    return error ? { error: error.code === '23505' ? 'Hospital code already exists.' : error.message } : done('Hospital registered.');
  } catch (e) { return fail(e); }
}

export async function updateHospitalFlags(fd: FormData) {
  await actionUser('admin');
  const sb = await supabaseServer();
  await sb.from('hospitals').update({
    nabh: fd.get('nabh') === 'on', super_specialty: fd.get('super_specialty') === 'on', active: fd.get('active') === 'on', city_class: s(fd, 'city_class'),
  }).eq('id', s(fd, 'id'));
  revalidatePath('/admin/hospitals');
}

export async function createMou(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('admin');
    const sb = await supabaseServer();
    const { error } = await sb.from('hospital_mou_details').insert({
      hospital_id: s(fd, 'hospital_id'), mou_no: s(fd, 'mou_no'), valid_from: s(fd, 'valid_from'), valid_to: s(fd, 'valid_to'),
      apply_factors: fd.get('apply_factors') === 'on', discount_pct: Number(s(fd, 'discount_pct') || 0), remarks: s(fd, 'remarks') || null,
    });
    if (error) return { error: error.message.includes('exclusion') || error.message.includes('conflicting') ? 'This hospital already has an MOU covering part of that period.' : error.message };
    return done('MOU saved.');
  } catch (e) { return fail(e); }
}

export async function createArea(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('admin');
    const sb = await supabaseServer();
    const { error } = await sb.from('areas').insert({ code: s(fd, 'code').toUpperCase(), name: s(fd, 'name') });
    return error ? { error: error.message } : done('Area added.');
  } catch (e) { return fail(e); }
}

// ------------------------------------------------------------------ CGHS / medicine rate schedules
const CAT_KEYS = CATEGORIES.map(([k]) => k) as string[];
const rateRow = z.object({
  code: z.string().min(1, 'code missing').max(40),
  name: z.string().min(1, 'name missing').max(300),
  category: z.string().transform((c) => c.trim().toUpperCase().replace(/[\s-]+/g, '_')).refine((c) => CAT_KEYS.includes(c), 'invalid category'),
  specification: z.string().max(120).default(''),
  unit: z.string().max(40).default(''),
  city_class: z.string().transform((c) => (c ? c.trim().toUpperCase().replace(/[\s-]+/g, '_') : null))
    .refine((c) => c === null || ['TIER_I', 'TIER_II', 'TIER_III'].includes(c), 'city_class must be TIER_I/TIER_II/TIER_III or blank'),
  base_rate: z.coerce.number().min(0, 'rate must be ≥ 0'),
  package_days: z.string().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'package_days must be a whole number'),
  remarks: z.string().max(300).optional(),
});

export async function uploadRateSchedule(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const u = await actionUser('admin');
    const file = fd.get('file') as File;
    const rows = await readTabular(file);
    const errors: string[] = []; const clean: z.infer<typeof rateRow>[] = [];
    rows.forEach((r, i) => {
      const p = rateRow.safeParse({ ...r, base_rate: r.base_rate ?? r.rate ?? r.cghs_rate, specification: r.specification ?? '', unit: r.unit ?? '', city_class: r.city_class ?? '', package_days: r.package_days ?? '' });
      if (p.success) clean.push(p.data); else errors.push(`Row ${i + 2}: ${p.error.issues.map((x) => x.message).join(', ')}`);
    });
    if (errors.length) return { error: `Upload rejected — ${errors.length} invalid row(s): ${errors.slice(0, 6).join(' | ')}` };
    const seen = new Set<string>();
    for (const c of clean) {
      const k = `${c.code}|${c.specification}|${c.city_class}`;
      if (seen.has(k)) return { error: `Duplicate rate for code ${c.code} (${c.specification || 'no spec'}).` };
      seen.add(k);
    }
    const sb = await supabaseServer();
    const { data: v, error } = await sb.from('cghs_rate_versions').insert({
      rate_type: s(fd, 'rate_type'), version_label: s(fd, 'version_label'), notification_ref: s(fd, 'notification_ref') || null,
      effective_from: s(fd, 'effective_from'), effective_to: s(fd, 'effective_to') || null, source_filename: file.name,
      row_count: clean.length, uploaded_by: u.id,
    }).select('id').single();
    if (error) return { error: error.code === '23505' ? 'A version with this label already exists.' : error.message };
    for (let i = 0; i < clean.length; i += 500) {
      const { error: e } = await sb.from('cghs_rate_master').insert(clean.slice(i, i + 500).map((c) => ({ ...c, version_id: v.id })));
      if (e) { await sb.from('cghs_rate_versions').delete().eq('id', v.id); return { error: `Import failed: ${e.message}` }; }
    }
    return done(`${clean.length} rates uploaded as DRAFT. Review and activate to use them for verification.`);
  } catch (e) { return fail(e); }
}

export async function activateRateVersion(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const u = await actionUser('admin');
    const sb = await supabaseServer();
    const { data: v } = await sb.from('cghs_rate_versions').select('*').eq('id', s(fd, 'id')).single();
    if (!v || v.status !== 'DRAFT') return { error: 'Only draft versions can be activated.' };
    // close the open-ended active version of the same type the day before this one starts
    const dayBefore = new Date(Date.parse(v.effective_from) - 86_400_000).toISOString().slice(0, 10);
    await sb.from('cghs_rate_versions').update({ effective_to: dayBefore })
      .eq('rate_type', v.rate_type).eq('status', 'ACTIVE').is('effective_to', null).lt('effective_from', v.effective_from);
    const { error } = await sb.from('cghs_rate_versions').update({ status: 'ACTIVE', activated_by: u.id, activated_at: new Date().toISOString() }).eq('id', v.id);
    if (error) return { error: error.message.includes('rate_versions_no_overlap') ? 'Its effective period overlaps another active version. Adjust the dates first.' : error.message };
    return done(`${v.version_label} is now active from ${v.effective_from}. Earlier versions remain for historical bills.`);
  } catch (e) { return fail(e); }
}

export async function deleteDraftVersion(fd: FormData) {
  await actionUser('admin');
  const sb = await supabaseServer();
  await sb.from('cghs_rate_versions').delete().eq('id', s(fd, 'id')).eq('status', 'DRAFT');
  revalidatePath('/admin/rates');
}

// ------------------------------------------------------------------ settings
export async function saveSetting(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const u = await actionUser('admin');
    const key = s(fd, 'key');
    let value: unknown;
    try { value = JSON.parse(s(fd, 'value')); } catch { return { error: 'Value must be valid JSON.' }; }
    if (key === 'query_period_days' && !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 60)) return { error: 'Query period must be 1–60 days.' };
    const sb = await supabaseServer();
    const { error } = await sb.from('system_settings').update({ value, updated_by: u.id, updated_at: new Date().toISOString() }).eq('key', key);
    return error ? { error: error.message } : done(`Setting “${key}” saved.`);
  } catch (e) { return fail(e); }
}
