'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actionUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { uploadDocument } from '@/lib/documents';
import type { ActionResult } from '@/components/ActionForm';

const schema = z.object({
  employee_code: z.string().min(2, 'Employee ID is required'),
  employee_name: z.string().min(2, 'Employee name is required'),
  department: z.string().optional(),
  designation: z.string().optional(),
  basic_pay: z.coerce.number().min(0).optional(),
  patient_category: z.enum(['Employee', 'Dependent', 'Other']),
  patient_name: z.string().optional(),
  relationship: z.string().optional(),
  hospital_id: z.uuid('Select a hospital'),
  establishment: z.string().optional(),
  referral_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  admission_date: z.string().optional(),
  discharge_date: z.string().optional(),
  diagnosis: z.string().min(2, 'Diagnosis is required'),
  treatment_details: z.string().optional(),
  ward_entitled: z.enum(['GENERAL', 'SEMI_PRIVATE', 'PRIVATE']),
  ward_occupied: z.string().optional(),
  // admin exception referrals only
  amo_id: z.string().optional(),
  area_id: z.string().optional(),
  exception_reason: z.string().optional(),
});

export async function createReferral(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const u = await actionUser('amo', 'admin');
    const p = schema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')));
    if (!p.success) return { error: p.error.issues.map((i) => i.message).join('; ') };
    const d = p.data;
    if (d.patient_category !== 'Employee' && (!d.patient_name || !d.relationship)) return { error: 'Patient name and relationship are required for dependents.' };
    if (d.admission_date && d.discharge_date && d.discharge_date < d.admission_date) return { error: 'Discharge date cannot be before admission date.' };
    const isAdmin = u.role === 'admin';
    if (isAdmin && (!d.amo_id || !d.area_id || (d.exception_reason ?? '').length < 5)) return { error: 'Admin referrals need the AMO, area and an exception reason.' };
    const areaId = isAdmin ? d.area_id! : u.area_id;
    if (!areaId) return { error: 'Your account has no Area assigned. Ask the administrator.' };

    const sb = await supabaseServer();
    // employee (upsert by employee code)
    let { data: emp } = await sb.from('employees').select('id').eq('employee_code', d.employee_code.trim().toUpperCase()).maybeSingle();
    if (!emp) {
      const ins = await sb.from('employees').insert({
        employee_code: d.employee_code.trim().toUpperCase(), full_name: d.employee_name, area_id: areaId,
        department: d.department || null, designation: d.designation || null, basic_pay: d.basic_pay ?? null, ward_entitlement: d.ward_entitled,
      }).select('id').single();
      if (ins.error) return { error: ins.error.message };
      emp = ins.data;
    }
    // patient
    const patientName = d.patient_category === 'Employee' ? d.employee_name : d.patient_name!;
    let { data: pat } = await sb.from('patients').select('id').eq('employee_id', emp.id).eq('full_name', patientName).maybeSingle();
    if (!pat) {
      const ins = await sb.from('patients').insert({
        employee_id: emp.id, full_name: patientName, category: d.patient_category,
        relationship: d.patient_category === 'Employee' ? null : d.relationship,
      }).select('id').single();
      if (ins.error) return { error: ins.error.message };
      pat = ins.data;
    }
    // MOU in force on the referral date
    const { data: mou } = await sb.from('hospital_mou_details').select('id').eq('hospital_id', d.hospital_id)
      .lte('valid_from', d.referral_date).gte('valid_to', d.referral_date).maybeSingle();

    const { data: ref, error } = await sb.from('patient_referrals').insert({
      patient_id: pat.id, employee_id: emp.id, referring_amo_id: isAdmin ? d.amo_id : u.id, area_id: areaId,
      establishment: d.establishment || null, hospital_id: d.hospital_id, mou_id: mou?.id ?? null,
      referral_date: d.referral_date, admission_date: d.admission_date || null, discharge_date: d.discharge_date || null,
      diagnosis: d.diagnosis, treatment_details: d.treatment_details || null,
      ward_entitled: d.ward_entitled, ward_occupied: d.ward_occupied || null, created_by: u.id,
      is_exception: isAdmin, exception_reason: isAdmin ? d.exception_reason : null, exception_approved_by: isAdmin ? u.id : null,
    }).select('id, referral_no').single();
    if (error) return { error: error.message };

    const letter = fd.get('letter');
    if (letter instanceof File && letter.size > 0) {
      const doc = await uploadDocument(sb, { file: letter, docType: 'REFERRAL_LETTER', userId: u.id, referralId: ref.id });
      await sb.from('patient_referrals').update({ referral_letter_path: doc.path }).eq('id', ref.id);
    }
    revalidatePath('/', 'layout');
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  redirect(fd.get('return_to') === 'admin' ? '/admin/referrals' : '/amo/referrals');
}

export async function updateReferral(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await actionUser('amo', 'admin', 'hospital');
    const sb = await supabaseServer();
    const patch: Record<string, string | null> = {};
    for (const k of ['admission_date', 'discharge_date', 'ward_occupied', 'status']) {
      const v = String(fd.get(k) ?? '');
      if (fd.has(k)) patch[k] = v || null;
    }
    const { error, count } = await sb.from('patient_referrals').update(patch, { count: 'exact' }).eq('id', String(fd.get('id')));
    if (error) return { error: error.message };
    if (!count) return { error: 'Not permitted to update this referral.' };
    revalidatePath('/', 'layout');
    return { ok: 'Referral updated.' };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}
