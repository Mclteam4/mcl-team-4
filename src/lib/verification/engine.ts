/**
 * MCL CGHS Rate Verification Engine (server-only, pure functions).
 *
 * Input : bill context + item lines + the ACTIVE administrator-uploaded rate rows
 *         + rule settings from `system_settings` / MOU.
 * Output: per-item match result (GREEN/RED/YELLOW/GREY), applicable CGHS rate,
 *         proposed admissible qty/rate and an explanation.
 *
 * Guarantees (master brief §6):
 *  - No rate is ever invented: only rows passed in `rates` are used.
 *  - Unmatched items are GREY with proposed rate 0 — never auto-approved.
 *  - Similar names are only *suggested* (suggestedRateId); AMO must confirm.
 *  - Exact match = CGHS code + specification + unit.
 *  - All money is computed in integer paise to avoid floating point error.
 */

export type ItemCategory =
  | 'MEDICINE' | 'PROCEDURE' | 'PACKAGE' | 'INVESTIGATION' | 'ROOM_RENT'
  | 'ICU' | 'CONSULTATION' | 'IMPLANT' | 'CONSUMABLE' | 'OTHER';
export type MatchStatus = 'GREEN' | 'RED' | 'YELLOW' | 'GREY';
export type Ward = 'GENERAL' | 'SEMI_PRIVATE' | 'PRIVATE';
export type CityClass = 'TIER_I' | 'TIER_II' | 'TIER_III';

export interface RateRow {
  id: string;
  rateType: 'CGHS' | 'MEDICINE';
  code: string;
  name: string;
  category: ItemCategory;
  specification: string;
  unit: string;
  cityClass: CityClass | null;
  baseRate: number;          // ₹, as uploaded
  packageDays: number | null;
}

export interface BillItem {
  id: string;
  lineNo: number;
  category: ItemCategory;
  description: string;
  cghsCode: string | null;
  specification: string;
  unit: string;
  quantity: number;
  rateClaimed: number;
  serviceDate: string | null; // yyyy-mm-dd
}

export interface BillContext {
  cityClass: CityClass;
  nabh: boolean;
  superSpecialty: boolean;
  empanelled: boolean;
  wardEntitled: Ward;
  wardOccupied: Ward | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  mou: { applyFactors: boolean; discountPct: number } | null;
}

export interface RuleSettings {
  rateFactors: {
    city: Record<CityClass, number>;
    accreditation: { NABH: number; NON_NABH: number };
    super_specialty: number;
    ward: Record<Ward, number>;
    scale_categories: ItemCategory[];               // get ward factor
    city_accreditation_categories: ItemCategory[];  // get city × accreditation × super-specialty
  };
  roomRentPerDay: Record<Ward, number>;
  nonAdmissibleKeywords: string[];
  nameMatchThreshold: number;
}

export interface ItemResult {
  billItemId: string;
  matchStatus: MatchStatus;
  matchNote: string;
  rateId: string | null;
  suggestedRateId: string | null;
  cghsRate: number | null;        // applicable unit rate after factors
  ceilingAmount: number | null;   // applicable rate × admissible qty
  proposedQty: number;
  proposedRate: number;
  claimedAmount: number;
  proposedAmount: number;
  excessAmount: number;
}

export interface EngineResult {
  items: ItemResult[];
  snapshot: {
    effectiveWard: Ward;
    stayDays: number;
    packageDays: number;
    factors: Record<string, number>;
    mouDiscountPct: number;
  };
  totals: { claimed: number; proposed: number; excess: number; green: number; red: number; yellow: number; grey: number };
}

// ---------------------------------------------------------------- money & text helpers
const toPaise = (rupees: number) => Math.round(rupees * 100);
const fromPaise = (p: number) => p / 100;
const mulPaise = (paise: number, factor: number) => Math.round(paise * factor);
const amount = (qty: number, rate: number) => fromPaise(Math.round(qty * toPaise(rate)));

export const normalise = (s: string | null | undefined) =>
  String(s ?? '').toUpperCase().replace(/\s+/g, ' ').replace(/[^A-Z0-9.%/ ]/g, '').trim();

const UNIT_ALIASES: Record<string, string> = {
  TAB: 'TABLET', TABS: 'TABLET', TABLETS: 'TABLET', CAP: 'CAPSULE', CAPS: 'CAPSULE', CAPSULES: 'CAPSULE',
  INJ: 'INJECTION', VIAL: 'INJECTION', AMP: 'INJECTION', AMPOULE: 'INJECTION', DAYS: 'DAY', 'PER DAY': 'DAY',
  TESTS: 'TEST', PROCEDURES: 'PROCEDURE', SESSIONS: 'SESSION', NOS: 'NO', NUMBER: 'NO', EACH: 'NO',
};
const normUnit = (u: string) => { const n = normalise(u); return UNIT_ALIASES[n] ?? n; };

/** pg_trgm-compatible trigram similarity (0..1). */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const set = new Set<string>();
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).forEach((w) => {
      const p = `  ${w} `;
      for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    });
    return set;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach((g) => { if (B.has(g)) common++; });
  return common / (A.size + B.size - common);
}

export function stayDays(adm: string | null, dis: string | null): number {
  if (!adm || !dis) return 0;
  const ms = Date.parse(dis) - Date.parse(adm);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.max(1, Math.round(ms / 86_400_000)); // same-day = 1 day (day care)
}

const WARD_RANK: Record<Ward, number> = { GENERAL: 0, SEMI_PRIVATE: 1, PRIVATE: 2 };
const PACKAGE_INCLUSIVE: ItemCategory[] = ['MEDICINE', 'CONSUMABLE', 'INVESTIGATION', 'CONSULTATION'];

// ---------------------------------------------------------------- engine
export function verifyBill(ctx: BillContext, items: BillItem[], rates: RateRow[], rules: RuleSettings): EngineResult {
  const rf = rules.rateFactors;
  const applyFactors = ctx.mou?.applyFactors ?? true;
  const discount = Math.min(Math.max(ctx.mou?.discountPct ?? 0, 0), 100);

  // the hospital is paid at the lower of entitled and occupied ward
  const occupied = ctx.wardOccupied ?? ctx.wardEntitled;
  const effectiveWard: Ward = WARD_RANK[occupied] < WARD_RANK[ctx.wardEntitled] ? occupied : ctx.wardEntitled;
  const accrKey = !ctx.empanelled || !ctx.nabh ? 'NON_NABH' : 'NABH';
  const f = {
    city: applyFactors ? rf.city[ctx.cityClass] ?? 1 : 1,
    accreditation: applyFactors ? rf.accreditation[accrKey] ?? 1 : 1,
    superSpecialty: applyFactors && ctx.empanelled && ctx.superSpecialty ? rf.super_specialty : 1,
    ward: applyFactors ? rf.ward[effectiveWard] ?? 1 : 1,
    discount: 1 - discount / 100,
  };
  const factorFor = (cat: ItemCategory) => {
    let x = f.discount;
    if (rf.city_accreditation_categories.includes(cat)) x *= f.city * f.accreditation * f.superSpecialty;
    if (rf.scale_categories.includes(cat)) x *= f.ward;
    return x;
  };

  // index rate rows by code, restricted to the hospital's city class (or all-city rows)
  const usable = rates.filter((r) => r.cityClass === null || r.cityClass === ctx.cityClass);
  const byCode = new Map<string, RateRow[]>();
  usable.forEach((r) => {
    const k = normalise(r.code);
    byCode.set(k, [...(byCode.get(k) ?? []), r]);
  });
  const rateTypeFor = (cat: ItemCategory) => (cat === 'MEDICINE' ? 'MEDICINE' : 'CGHS');

  const stay = stayDays(ctx.admissionDate, ctx.dischargeDate);

  // package period = longest matched package
  let packageDays = 0;
  items.filter((i) => i.category === 'PACKAGE').forEach((i) => {
    const r = (byCode.get(normalise(i.cghsCode)) ?? [])[0];
    packageDays = Math.max(packageDays, r?.packageDays ?? 0);
  });
  packageDays = Math.min(packageDays, stay || packageDays);
  const hasPackage = items.some((i) => i.category === 'PACKAGE');
  const pkgEnd = ctx.admissionDate && packageDays
    ? new Date(Date.parse(ctx.admissionDate) + packageDays * 86_400_000).toISOString().slice(0, 10) : null;
  let bedDaysLeft = Math.max(0, stay - packageDays);

  const seen = new Map<string, number>();
  const kw = rules.nonAdmissibleKeywords.map((k) => k.toLowerCase()).filter(Boolean);

  // ICU before room rent so chargeable bed-days are allocated deterministically
  const ordered = [...items].sort((a, b) => {
    const p = (c: ItemCategory) => (c === 'ICU' ? 0 : c === 'ROOM_RENT' ? 1 : 2);
    return p(a.category) - p(b.category) || a.lineNo - b.lineNo;
  });

  const results = new Map<string, ItemResult>();
  for (const it of ordered) {
    const claimedAmount = amount(it.quantity, it.rateClaimed);
    const res = (s: MatchStatus, note: string, o: Partial<ItemResult> = {}): ItemResult => {
      const proposedQty = o.proposedQty ?? it.quantity;
      const proposedRate = o.proposedRate ?? 0;
      const proposedAmount = amount(proposedQty, proposedRate);
      const cghsRate = o.cghsRate ?? null;
      return {
        billItemId: it.id, matchStatus: s, matchNote: note, rateId: o.rateId ?? null,
        suggestedRateId: o.suggestedRateId ?? null, cghsRate,
        ceilingAmount: cghsRate === null ? null : amount(proposedQty, cghsRate),
        proposedQty, proposedRate, claimedAmount, proposedAmount,
        excessAmount: fromPaise(toPaise(claimedAmount) - toPaise(proposedAmount)),
      };
    };

    // 1. duplicate detection (same code/description + spec + date)
    const dupKey = [normalise(it.cghsCode) || normalise(it.description), normalise(it.specification), it.serviceDate ?? ''].join('|');
    const dupOf = seen.get(dupKey);
    seen.set(dupKey, it.lineNo);
    if (dupOf !== undefined) {
      results.set(it.id, res('YELLOW', `Possible duplicate of line ${dupOf} (same item, specification and date)`));
      continue;
    }

    // 2. non-admissible keyword
    const hit = kw.find((k) => it.description.toLowerCase().includes(k));
    if (hit) {
      results.set(it.id, res('YELLOW', `Suggested non-admissible ("${hit}") — disallow with reason or justify`, { proposedQty: 0 }));
      continue;
    }

    // 3. room rent: entitlement ceiling + chargeable days outside package period
    if (it.category === 'ROOM_RENT') {
      const perDay = rules.roomRentPerDay[effectiveWard];
      const days = Math.min(it.quantity, bedDaysLeft);
      bedDaysLeft -= days;
      const rate = Math.min(it.rateClaimed, perDay);
      const notes: string[] = [];
      if (days < it.quantity) notes.push(`${it.quantity - days} day(s) exceed chargeable stay (${stay} day stay${packageDays ? `, ${packageDays} in package` : ''})`);
      if (it.rateClaimed > perDay) notes.push(`Exceeds ${effectiveWard.replace('_', '-').toLowerCase()} ward ceiling ₹${perDay}/day`);
      const status: MatchStatus = days < it.quantity ? 'YELLOW' : it.rateClaimed > perDay ? 'RED' : 'GREEN';
      results.set(it.id, res(status, notes.join('; ') || 'Within ward entitlement', { proposedQty: days, proposedRate: rate, cghsRate: perDay }));
      continue;
    }

    // 4. items normally subsumed in a package
    if (hasPackage && PACKAGE_INCLUSIVE.includes(it.category) && (!it.serviceDate || !pkgEnd || it.serviceDate <= pkgEnd)) {
      results.set(it.id, res('YELLOW', `Within package period${pkgEnd ? ` (till ${pkgEnd})` : ''} — normally included in package; admit only if for a complication`, { proposedQty: 0 }));
      continue;
    }

    // 5. rate master lookup — exact code, then specification + unit
    const candidates = (byCode.get(normalise(it.cghsCode)) ?? []).filter((r) => r.rateType === rateTypeFor(it.category));
    if (it.cghsCode && candidates.length) {
      const specOk = (r: RateRow) => !normalise(r.specification) || normalise(r.specification) === normalise(it.specification);
      const unitOk = (r: RateRow) => !normalise(r.unit) || !normalise(it.unit) || normUnit(r.unit) === normUnit(it.unit);
      // prefer city-specific row over all-city row
      const exact = candidates.filter((r) => specOk(r) && unitOk(r))
        .sort((a, b) => (b.cityClass ? 1 : 0) - (a.cityClass ? 1 : 0))[0];
      if (!exact) {
        const c = candidates[0];
        results.set(it.id, res('YELLOW',
          `Code ${c.code} found but ${!specOk(c) ? `specification differs ("${c.specification}")` : `unit differs ("${c.unit}")`} — confirm equivalence`,
          { suggestedRateId: c.id }));
        continue;
      }
      const factor = it.category === 'IMPLANT' ? f.discount : factorFor(it.category);
      const applicable = fromPaise(mulPaise(toPaise(exact.baseRate), factor));
      if (it.rateClaimed <= applicable) {
        results.set(it.id, res('GREEN', `Within CGHS rate ₹${applicable.toFixed(2)} (${exact.code})`,
          { rateId: exact.id, cghsRate: applicable, proposedRate: it.rateClaimed }));
      } else {
        results.set(it.id, res('RED',
          `Claimed ₹${it.rateClaimed.toFixed(2)} exceeds CGHS ₹${applicable.toFixed(2)} by ₹${(it.rateClaimed - applicable).toFixed(2)}/unit`,
          { rateId: exact.id, cghsRate: applicable, proposedRate: applicable }));
      }
      continue;
    }

    // 6. not found → name suggestion only (never auto-applied)
    let best: { r: RateRow; s: number } | null = null;
    for (const r of usable) {
      if (r.rateType !== rateTypeFor(it.category) || r.category !== it.category) continue;
      const s = trigramSimilarity(`${it.description} ${it.specification}`, `${r.name} ${r.specification}`);
      if (s >= rules.nameMatchThreshold && (!best || s > best.s)) best = { r, s };
    }
    results.set(it.id, res('GREY',
      best
        ? `${it.cghsCode ? `Code "${it.cghsCode}" not in active schedule. ` : 'No CGHS code. '}Suggested: ${best.r.code} ${best.r.name} (${Math.round(best.s * 100)}% name match) — confirm before use`
        : `${it.cghsCode ? `Code "${it.cghsCode}" not in active schedule` : 'No CGHS code and no matching rate'} — manual verification required`,
      { suggestedRateId: best?.r.id ?? null }));
  }

  const out = items.map((i) => results.get(i.id)!);
  const sum = (k: 'claimedAmount' | 'proposedAmount' | 'excessAmount') =>
    fromPaise(out.reduce((s, r) => s + toPaise(r[k]), 0));
  const count = (s: MatchStatus) => out.filter((r) => r.matchStatus === s).length;

  return {
    items: out,
    snapshot: {
      effectiveWard, stayDays: stay, packageDays,
      factors: { city: f.city, accreditation: f.accreditation, superSpecialty: f.superSpecialty, ward: f.ward },
      mouDiscountPct: discount,
    },
    totals: {
      claimed: sum('claimedAmount'), proposed: sum('proposedAmount'), excess: sum('excessAmount'),
      green: count('GREEN'), red: count('RED'), yellow: count('YELLOW'), grey: count('GREY'),
    },
  };
}
