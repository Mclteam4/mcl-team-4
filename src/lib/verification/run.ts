import 'server-only';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';
import { verifyBill, type BillItem, type RateRow, type RuleSettings } from './engine';

async function loadSetting<T>(sb: Awaited<ReturnType<typeof supabaseServer>>, key: string, fallback: T): Promise<T> {
  const { data } = await sb.from('system_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

/**
 * Runs the CGHS engine for a bill and creates a new verification round.
 * Reads happen as the signed-in AMO (RLS proves access to the bill); only the
 * final write goes through the service-role RPC, which re-checks that the actor
 * is the assigned AMO or an active delegate.
 */
export async function startVerificationRound(billId: string, actorId: string): Promise<string> {
  const sb = await supabaseServer();
  const { data: bill } = await sb.from('hospital_bills').select('id, referral_id, hospital_id, status').eq('id', billId).maybeSingle();
  if (!bill) throw new Error('Bill not found or not accessible.');

  const [{ data: ref }, { data: hosp }, { data: items }] = await Promise.all([
    sb.from('patient_referrals').select('referral_date, admission_date, discharge_date, ward_entitled, ward_occupied, mou_id').eq('id', bill.referral_id).single(),
    sb.from('hospitals').select('city_class, nabh, super_specialty, empanelled').eq('id', bill.hospital_id).single(),
    sb.from('hospital_bill_items').select('*').eq('bill_id', billId).order('line_no'),
  ]);
  if (!ref || !hosp) throw new Error('Referral or hospital details are missing.');
  const { data: mou } = ref.mou_id
    ? await sb.from('hospital_mou_details').select('apply_factors, discount_pct').eq('id', ref.mou_id).maybeSingle()
    : { data: null };

  // rate versions effective on the rate reference date (admission date, else referral date)
  const refDate = ref.admission_date ?? ref.referral_date;
  const { data: versions } = await sb.from('cghs_rate_versions').select('id, rate_type, version_label, notification_ref')
    .eq('status', 'ACTIVE').lte('effective_from', refDate).or(`effective_to.is.null,effective_to.gte.${refDate}`);
  const rates: RateRow[] = [];
  for (const v of versions ?? []) {
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from('cghs_rate_master').select('*').eq('version_id', v.id).range(from, from + 999);
      (data ?? []).forEach((r) => rates.push({
        id: r.id, rateType: v.rate_type, code: r.code, name: r.name, category: r.category,
        specification: r.specification ?? '', unit: r.unit ?? '', cityClass: r.city_class,
        baseRate: Number(r.base_rate), packageDays: r.package_days,
      }));
      if (!data || data.length < 1000) break;
    }
  }

  const rules: RuleSettings = {
    rateFactors: await loadSetting(sb, 'rate_factors', null as unknown as RuleSettings['rateFactors']),
    roomRentPerDay: await loadSetting(sb, 'room_rent_per_day', { GENERAL: 0, SEMI_PRIVATE: 0, PRIVATE: 0 }),
    nonAdmissibleKeywords: await loadSetting(sb, 'non_admissible_keywords', [] as string[]),
    nameMatchThreshold: Number(await loadSetting(sb, 'name_match_threshold', 0.6)),
  };
  if (!rules.rateFactors) throw new Error('Rate factors are not configured (Admin → Settings).');

  const billItems: BillItem[] = (items ?? []).map((i) => ({
    id: i.id, lineNo: i.line_no, category: i.category, description: i.description, cghsCode: i.cghs_code,
    specification: i.specification ?? '', unit: i.unit ?? '', quantity: Number(i.quantity),
    rateClaimed: Number(i.rate_claimed), serviceDate: i.service_date,
  }));

  const result = verifyBill({
    cityClass: hosp.city_class, nabh: hosp.nabh, superSpecialty: hosp.super_specialty, empanelled: hosp.empanelled,
    wardEntitled: ref.ward_entitled, wardOccupied: ref.ward_occupied,
    admissionDate: ref.admission_date, dischargeDate: ref.discharge_date,
    mou: mou ? { applyFactors: mou.apply_factors, discountPct: Number(mou.discount_pct) } : null,
  }, billItems, rates, rules);

  const snapshot = {
    ...result.snapshot, rate_reference_date: refDate,
    rate_versions: (versions ?? []).map((v) => ({ id: v.id, type: v.rate_type, label: v.version_label, ref: v.notification_ref })),
    rules_used: rules.rateFactors, room_rent: rules.roomRentPerDay, engine_totals: result.totals,
  };
  const payload = result.items.map((r) => ({
    bill_item_id: r.billItemId, rate_id: r.rateId, suggested_rate_id: r.suggestedRateId, match_status: r.matchStatus,
    match_note: r.matchNote, cghs_rate: r.cghsRate, ceiling_amount: r.ceilingAmount,
    proposed_qty: r.proposedQty, proposed_rate: r.proposedRate,
  }));

  const { data, error } = await supabaseAdmin().rpc('rpc_create_round', {
    p_bill: billId, p_actor: actorId, p_snapshot: snapshot, p_items: payload,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
