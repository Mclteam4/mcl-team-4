// Runs on Node's built-in test runner (native TypeScript type-stripping): npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyBill, trigramSimilarity, type BillContext, type BillItem, type RateRow, type RuleSettings } from './engine.ts';

const expect = (v: unknown) => ({
  toBe: (e: unknown) => assert.strictEqual(v, e),
  toBeNull: () => assert.strictEqual(v, null),
  toMatch: (re: RegExp) => assert.match(String(v), re),
  toBeCloseTo: (e: number) => assert.ok(Math.abs((v as number) - e) < 0.005, `${v} ≈ ${e}`),
});

const rules: RuleSettings = {
  rateFactors: {
    city: { TIER_I: 1, TIER_II: 0.9, TIER_III: 0.8 },
    accreditation: { NABH: 1, NON_NABH: 0.85 },
    super_specialty: 1.15,
    ward: { GENERAL: 0.95, SEMI_PRIVATE: 1, PRIVATE: 1.05 },
    scale_categories: ['PACKAGE', 'PROCEDURE'],
    city_accreditation_categories: ['PACKAGE', 'PROCEDURE', 'INVESTIGATION', 'ICU'],
  },
  roomRentPerDay: { GENERAL: 1500, SEMI_PRIVATE: 3000, PRIVATE: 4500 },
  nonAdmissibleKeywords: ['attendant', 'toiletr'],
  nameMatchThreshold: 0.5,
};

const ctx = (o: Partial<BillContext> = {}): BillContext => ({
  cityClass: 'TIER_I', nabh: true, superSpecialty: false, empanelled: true,
  wardEntitled: 'SEMI_PRIVATE', wardOccupied: null, admissionDate: '2026-11-01', dischargeDate: '2026-11-05', mou: null, ...o,
});

const rate = (o: Partial<RateRow>): RateRow => ({
  id: o.code ?? 'r', rateType: 'CGHS', code: 'X', name: 'x', category: 'PROCEDURE', specification: '', unit: '',
  cityClass: null, baseRate: 0, packageDays: null, ...o,
});

let n = 0;
const item = (o: Partial<BillItem>): BillItem => ({
  id: `i${++n}`, lineNo: n, category: 'PROCEDURE', description: 'x', cghsCode: null, specification: '', unit: '',
  quantity: 1, rateClaimed: 0, serviceDate: null, ...o,
});

const RATES = [
  rate({ code: 'P1', name: 'Upper GI endoscopy', baseRate: 2000 }),
  rate({ code: 'INV1', name: 'Complete blood count', category: 'INVESTIGATION', baseRate: 150 }),
  rate({ code: 'M1', rateType: 'MEDICINE', name: 'Paracetamol', category: 'MEDICINE', specification: '500 MG', unit: 'TABLET', baseRate: 1.5 }),
];

describe('CGHS verification engine', () => {
  it('GREEN when claimed rate within CGHS rate', () => {
    const r = verifyBill(ctx(), [item({ cghsCode: 'P1', rateClaimed: 1800 })], RATES, rules).items[0];
    expect(r.matchStatus).toBe('GREEN');
    expect(r.proposedRate).toBe(1800);
  });

  it('RED with excess when claimed exceeds rate; admissible = ceiling', () => {
    const r = verifyBill(ctx(), [item({ cghsCode: 'P1', rateClaimed: 2500, quantity: 2 })], RATES, rules).items[0];
    expect(r.matchStatus).toBe('RED');
    expect(r.cghsRate).toBe(2000);
    expect(r.proposedAmount).toBe(4000);
    expect(r.excessAmount).toBe(1000);
  });

  it('applies Tier-II × Non-NABH × General ward factors to procedures', () => {
    const r = verifyBill(ctx({ cityClass: 'TIER_II', nabh: false, wardEntitled: 'GENERAL' }),
      [item({ cghsCode: 'P1', rateClaimed: 5000 })], RATES, rules).items[0];
    expect(r.cghsRate).toBe(1453.5); // 2000 × 0.9 × 0.85 × 0.95
  });

  it('pays at lower of entitled and occupied ward', () => {
    const higher = verifyBill(ctx({ wardOccupied: 'PRIVATE' }), [item({ cghsCode: 'P1', rateClaimed: 5000 })], RATES, rules);
    expect(higher.items[0].cghsRate).toBe(2000);
    const lower = verifyBill(ctx({ wardOccupied: 'GENERAL' }), [item({ cghsCode: 'P1', rateClaimed: 5000 })], RATES, rules);
    expect(lower.items[0].cghsRate).toBe(1900);
  });

  it('investigations are not ward-scaled', () => {
    const r = verifyBill(ctx({ wardEntitled: 'GENERAL' }), [item({ category: 'INVESTIGATION', cghsCode: 'INV1', rateClaimed: 500 })], RATES, rules);
    expect(r.items[0].cghsRate).toBe(150);
  });

  it('applies MOU discount and can disable factors', () => {
    const r = verifyBill(ctx({ cityClass: 'TIER_III', mou: { applyFactors: false, discountPct: 10 } }),
      [item({ cghsCode: 'P1', rateClaimed: 5000 })], RATES, rules);
    expect(r.items[0].cghsRate).toBe(1800);
  });

  it('GREY and never approved when not found; proposes 0', () => {
    const r = verifyBill(ctx(), [item({ cghsCode: 'NOPE', description: 'Mystery procedure', rateClaimed: 999 })], RATES, rules).items[0];
    expect(r.matchStatus).toBe('GREY');
    expect(r.proposedAmount).toBe(0);
    expect(r.rateId).toBeNull();
  });

  it('name similarity only produces a suggestion', () => {
    const r = verifyBill(ctx(), [item({ description: 'Upper GI endoscopy diagnostic', rateClaimed: 2000 })], RATES, rules).items[0];
    expect(r.matchStatus).toBe('GREY');
    expect(r.suggestedRateId).toBe('P1');
    expect(r.rateId).toBeNull();
  });

  it('medicine needs exact specification match; mismatch is YELLOW', () => {
    const okMed = verifyBill(ctx({ admissionDate: null }), [item({ category: 'MEDICINE', cghsCode: 'M1', specification: '500 mg', unit: 'Tab', rateClaimed: 2, quantity: 10 })], RATES, rules).items[0];
    expect(okMed.matchStatus).toBe('RED');
    expect(okMed.proposedAmount).toBe(15);
    const bad = verifyBill(ctx(), [item({ category: 'MEDICINE', cghsCode: 'M1', specification: '650 mg', rateClaimed: 2 })], RATES, rules).items[0];
    expect(bad.matchStatus).toBe('YELLOW');
    expect(bad.rateId).toBeNull();
  });

  it('room rent capped at entitlement and chargeable days', () => {
    const r = verifyBill(ctx(), [item({ category: 'ROOM_RENT', description: 'Room', quantity: 6, rateClaimed: 4000 })], RATES, rules).items[0];
    expect(r.matchStatus).toBe('YELLOW');      // 6 days billed vs 4-day stay
    expect(r.proposedQty).toBe(4);
    expect(r.proposedRate).toBe(3000);
    expect(r.proposedAmount).toBe(12000);
  });

  it('flags non-admissible keywords and duplicates', () => {
    const res = verifyBill(ctx(), [
      item({ category: 'OTHER', description: 'Attendant diet', rateClaimed: 500 }),
      item({ cghsCode: 'P1', rateClaimed: 1000, serviceDate: '2026-11-02' }),
      item({ cghsCode: 'P1', rateClaimed: 1000, serviceDate: '2026-11-02' }),
    ], RATES, rules).items;
    expect(res[0].matchStatus).toBe('YELLOW');
    expect(res[0].proposedAmount).toBe(0);
    expect(res[2].matchStatus).toBe('YELLOW');
    expect(res[2].matchNote).toMatch(/duplicate/);
  });

  it('avoids floating point drift in totals', () => {
    const res = verifyBill(ctx(), Array.from({ length: 10 }, () => item({ cghsCode: 'INV1', rateClaimed: 0.1, serviceDate: `2026-11-0${n % 9 + 1}` })), RATES, rules);
    expect(res.totals.claimed).toBe(1);
  });

  it('trigram similarity is symmetric and bounded', () => {
    expect(trigramSimilarity('abc', 'abc')).toBe(1);
    expect(trigramSimilarity('knee replacement', 'replacement knee')).toBeCloseTo(1);
    expect(trigramSimilarity('x', '')).toBe(0);
  });
});
