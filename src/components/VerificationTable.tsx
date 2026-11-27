'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Check, X, RotateCcw, Save, Send, CheckCheck, MessageSquareWarning } from 'lucide-react';
import { saveDecisions, approveAllGreen, sendToHospital, type DecisionRow } from '@/app/(app)/bills/actions';

export interface VRow {
  id: string; lineNo: number; category: string; description: string; code: string | null; spec: string; unit: string;
  qty: number; rate: number; amount: number;
  match: 'GREEN' | 'RED' | 'YELLOW' | 'GREY'; note: string | null; cghsRate: number | null;
  proposedQty: number; proposedRate: number;
  decision: DecisionRow['decision']; admQty: number; admRate: number; remarks: string; suggestionConfirmed: boolean;
  suggestion: { code: string; name: string; baseRate: number } | null;
  query: string | null; prevAdmissible: number | null;
}

const MATCH_ROW: Record<VRow['match'], string> = {
  GREEN: 'border-l-green-600', RED: 'border-l-red-600 bg-red-50/40', YELLOW: 'border-l-amber-500 bg-amber-50/40', GREY: 'border-l-slate-400 bg-slate-50',
};
const MATCH_DOT: Record<VRow['match'], string> = { GREEN: 'bg-green-600', RED: 'bg-red-600', YELLOW: 'bg-amber-500', GREY: 'bg-slate-400' };
const MATCH_LABEL = { GREEN: 'Within CGHS', RED: 'Exceeds CGHS', YELLOW: 'Manual check', GREY: 'Rate not found' };
const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const amt = (q: number, r: number) => Math.round(q * Math.round(r * 100)) / 100;
const CAT: Record<string, string> = { MEDICINE: 'Med', PROCEDURE: 'Proc', PACKAGE: 'Pkg', INVESTIGATION: 'Inv', ROOM_RENT: 'Room', ICU: 'ICU', CONSULTATION: 'Consult', IMPLANT: 'Implant', CONSUMABLE: 'Cons', OTHER: 'Other' };

type Filter = 'ALL' | 'PENDING' | 'RED' | 'YELLOW' | 'GREY' | 'GREEN' | 'QUERIED';

export function VerificationTable({ billId, verificationId, roundNo, initial }: {
  billId: string; verificationId: string; roundNo: number; initial: VRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>(initial.some((r) => r.query) ? 'QUERIED' : 'ALL');
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [pending, start] = useTransition();

  const update = (id: string, patch: Partial<VRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty((d) => new Set(d).add(id));
  };

  const approve = (r: VRow) => {
    if (r.match === 'RED') {
      update(r.id, { decision: 'MODIFIED', admQty: r.proposedQty, admRate: r.proposedRate,
        remarks: r.remarks || `Restricted to applicable CGHS rate ${money(r.cghsRate ?? r.proposedRate)}` });
    } else if (r.match === 'GREEN') {
      update(r.id, { decision: 'APPROVED', admQty: r.qty, admRate: r.rate });
    } else {
      update(r.id, { decision: 'APPROVED', admQty: r.admQty || r.qty, admRate: r.admRate || r.proposedRate || r.rate });
    }
  };
  const disallow = (r: VRow) => update(r.id, { decision: 'DISALLOWED', admQty: 0 });
  const reset = (r: VRow) => update(r.id, { decision: 'PENDING', admQty: r.proposedQty, admRate: r.proposedRate });
  const editValue = (r: VRow, patch: { admQty?: number; admRate?: number }) => {
    const q = patch.admQty ?? r.admQty, rt = patch.admRate ?? r.admRate;
    const decision: VRow['decision'] = q === r.qty && rt === r.rate ? 'APPROVED' : (q < r.qty && rt === r.rate ? 'PARTIAL' : 'MODIFIED');
    update(r.id, { ...patch, decision });
  };

  const totals = useMemo(() => {
    let claimed = 0, admissible = 0, disallowed = 0;
    const count = { APPROVED: 0, MODIFIED: 0, PARTIAL: 0, DISALLOWED: 0, PENDING: 0 };
    rows.forEach((r) => {
      claimed += r.amount;
      const a = r.decision === 'DISALLOWED' ? 0 : amt(r.admQty, r.admRate);
      admissible += r.decision === 'PENDING' ? 0 : a;
      if (r.decision === 'DISALLOWED') disallowed += r.amount;
      count[r.decision]++;
    });
    return { claimed: r2(claimed), admissible: r2(admissible), disallowed: r2(disallowed), reduction: r2(claimed - admissible), count };
  }, [rows]);

  const counts: Record<Filter, number> = {
    ALL: rows.length, PENDING: totals.count.PENDING, RED: rows.filter((r) => r.match === 'RED').length,
    YELLOW: rows.filter((r) => r.match === 'YELLOW').length, GREY: rows.filter((r) => r.match === 'GREY').length,
    GREEN: rows.filter((r) => r.match === 'GREEN').length, QUERIED: rows.filter((r) => r.query).length,
  };
  const visible = rows.filter((r) => filter === 'ALL' || (filter === 'PENDING' ? r.decision === 'PENDING'
    : filter === 'QUERIED' ? !!r.query : r.match === filter));

  const missingRemark = (r: VRow) => (['DISALLOWED', 'MODIFIED', 'PARTIAL'].includes(r.decision) ||
    (['YELLOW', 'GREY'].includes(r.match) && r.decision !== 'PENDING' && r.decision !== 'DISALLOWED')) && r.remarks.trim().length < 3;

  const payload = (ids?: Set<string>) => rows.filter((r) => !ids || ids.has(r.id)).map((r) => ({
    id: r.id, decision: r.decision, admissible_qty: r.decision === 'DISALLOWED' ? 0 : r.admQty, admissible_rate: r.admRate,
    remarks: r.remarks || null, suggestion_confirmed: r.suggestionConfirmed,
  }));

  const save = () => start(async () => {
    if (!dirty.size) { setMsg({ ok: 'No unsaved changes.' }); return; }
    const res = await saveDecisions(billId, payload(dirty));
    setMsg(res);
    if (!res?.error) { setDirty(new Set()); router.refresh(); }
  });
  const greenAll = () => start(async () => {
    if (dirty.size) { const s = await saveDecisions(billId, payload(dirty)); if (s?.error) { setMsg(s); return; } setDirty(new Set()); }
    const res = await approveAllGreen(billId, verificationId);
    setMsg(res);
    if (!res?.error) setRows((rs) => rs.map((r) => (r.match === 'GREEN' && r.decision === 'PENDING' ? { ...r, decision: 'APPROVED', admQty: r.qty, admRate: r.rate } : r)));
  });
  const submit = () => {
    const bad = rows.filter(missingRemark);
    if (totals.count.PENDING) { setMsg({ error: `${totals.count.PENDING} item(s) still pending. Every item needs a decision.` }); setFilter('PENDING'); return; }
    if (bad.length) { setMsg({ error: `Remarks are required on ${bad.length} item(s) (lines ${bad.map((b) => b.lineNo).join(', ')}).` }); return; }
    if (!window.confirm(`Send verified bill to hospital?\nAdmissible ${money(totals.admissible)} of ${money(totals.claimed)} claimed.\nThe hospital's 7-day query period starts now.`)) return;
    start(async () => {
      const s = await saveDecisions(billId, payload());
      if (s?.error) { setMsg(s); return; }
      const res = await sendToHospital(billId, verificationId, remarks);
      if (res?.error) setMsg(res);
    });
  };

  return (
    <div className="space-y-4">
      <div className="card no-print sticky top-0 z-20 flex flex-wrap items-center gap-2 p-3 lg:top-2">
        {(['ALL', 'PENDING', 'RED', 'YELLOW', 'GREY', 'GREEN', 'QUERIED'] as Filter[]).filter((f) => f !== 'QUERIED' || counts.QUERIED).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx('btn btn-sm', filter === f && 'border-navy-800 bg-navy-800 text-white hover:bg-navy-700')}>
            {f !== 'ALL' && f !== 'PENDING' && f !== 'QUERIED' && <span className={clsx('h-2 w-2 rounded-full', MATCH_DOT[f as VRow['match']])} />}
            {f === 'ALL' ? 'All' : f === 'PENDING' ? 'Undecided' : f === 'QUERIED' ? 'Queried' : MATCH_LABEL[f as VRow['match']]} ({counts[f]})
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={greenAll} disabled={pending || !rows.some((r) => r.match === 'GREEN' && r.decision === 'PENDING')} className="btn btn-sm btn-success"><CheckCheck className="h-4 w-4" /> Approve all green</button>
          <button onClick={save} disabled={pending} className="btn btn-sm"><Save className="h-4 w-4" /> Save draft{dirty.size ? ` (${dirty.size})` : ''}</button>
        </div>
      </div>

      {msg?.error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{msg.error}</p>}
      {msg?.ok && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">{msg.ok}</p>}

      <div className="card overflow-x-auto">
        <table className="min-w-[1250px]">
          <thead><tr>
            <th className="w-10">#</th><th>Item</th><th>CGHS check</th>
            <th className="text-right">Claimed qty × rate</th><th className="text-right">CGHS rate</th><th className="text-right">Rate diff</th>
            <th className="text-right">Claimed</th><th className="w-24 text-right">Adm. qty</th><th className="w-28 text-right">Adm. rate</th>
            <th className="text-right">Admissible</th><th className="text-right">Excess</th><th className="w-64">Decision &amp; remarks</th>
          </tr></thead>
          <tbody>
            {visible.map((r) => {
              const admissible = r.decision === 'DISALLOWED' ? 0 : amt(r.admQty, r.admRate);
              const diff = r.cghsRate === null ? null : r2(r.rate - r.cghsRate);
              return (
                <tr key={r.id} className={clsx('border-l-4', MATCH_ROW[r.match])}>
                  <td className="text-slate-400">{r.lineNo}</td>
                  <td className="min-w-56">
                    <div className="font-medium">{r.description}</div>
                    <div className="text-xs text-slate-500">{CAT[r.category] ?? r.category} · {[r.code, r.spec, r.unit].filter(Boolean).join(' · ') || 'no code'}</div>
                    {r.query && <div className="mt-1 flex items-start gap-1 rounded bg-red-100 px-1.5 py-1 text-xs text-red-900"><MessageSquareWarning className="mt-0.5 h-3 w-3 shrink-0" /> Hospital query: {r.query}</div>}
                    {r.prevAdmissible !== null && <div className="text-xs text-slate-400">Previous round admissible: {money(r.prevAdmissible)}</div>}
                  </td>
                  <td className="max-w-60">
                    <span className="flex items-center gap-1.5 text-xs font-semibold"><span className={clsx('h-2 w-2 rounded-full', MATCH_DOT[r.match])} />{MATCH_LABEL[r.match]}</span>
                    <div className="text-xs text-slate-600">{r.note}</div>
                    {r.suggestion && (
                      <label className="mt-1 flex items-center gap-1 text-xs font-normal text-slate-700">
                        <input type="checkbox" checked={r.suggestionConfirmed}
                          onChange={(e) => update(r.id, { suggestionConfirmed: e.target.checked, ...(e.target.checked && !r.admRate ? { admRate: r.suggestion!.baseRate } : {}) })} />
                        Use {r.suggestion.code} (base {money(r.suggestion.baseRate)})
                      </label>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{r.qty} × {money(r.rate)}</td>
                  <td className="text-right tabular-nums">{r.cghsRate === null ? '—' : money(r.cghsRate)}</td>
                  <td className={clsx('text-right tabular-nums', diff !== null && diff > 0 && 'font-semibold text-red-700')}>{diff === null ? '—' : (diff > 0 ? '+' : '') + money(diff)}</td>
                  <td className="text-right tabular-nums">{money(r.amount)}</td>
                  <td><input type="number" min={0} step="0.001" value={r.decision === 'DISALLOWED' ? 0 : r.admQty} disabled={r.decision === 'DISALLOWED'}
                    onChange={(e) => editValue(r, { admQty: Number(e.target.value) })} className="w-20 text-right" aria-label={`Admissible quantity line ${r.lineNo}`} /></td>
                  <td><input type="number" min={0} step="0.01" value={r.admRate} disabled={r.decision === 'DISALLOWED'}
                    onChange={(e) => editValue(r, { admRate: Number(e.target.value) })} className="w-24 text-right" aria-label={`Admissible rate line ${r.lineNo}`} /></td>
                  <td className="text-right font-semibold tabular-nums">{r.decision === 'PENDING' ? <span className="text-slate-400">{money(admissible)}</span> : money(admissible)}</td>
                  <td className={clsx('text-right tabular-nums', r.amount - admissible > 0 && 'text-red-700')}>{money(r2(r.amount - admissible))}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <select value={r.decision} onChange={(e) => {
                        const d = e.target.value as VRow['decision'];
                        if (d === 'DISALLOWED') disallow(r); else if (d === 'PENDING') reset(r); else update(r.id, { decision: d, admQty: r.admQty || r.proposedQty });
                      }} className={clsx('flex-1 text-xs', r.decision === 'DISALLOWED' && 'text-red-700', r.decision === 'APPROVED' && 'text-green-700')}>
                        <option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="MODIFIED">Modified</option>
                        <option value="PARTIAL">Partially approved</option><option value="DISALLOWED">Disallowed</option>
                      </select>
                      <button title="Approve at admissible rate" onClick={() => approve(r)} className="btn btn-sm px-1.5 text-green-700"><Check className="h-4 w-4" /></button>
                      <button title="Disallow" onClick={() => disallow(r)} className="btn btn-sm px-1.5 text-red-700"><X className="h-4 w-4" /></button>
                      <button title="Reset to engine proposal" onClick={() => reset(r)} className="btn btn-sm px-1.5"><RotateCcw className="h-3.5 w-3.5" /></button>
                    </div>
                    <input value={r.remarks} onChange={(e) => update(r.id, { remarks: e.target.value })} placeholder={missingRemark(r) ? 'Remark required' : 'Remarks'}
                      className={clsx('mt-1 w-full text-xs', missingRemark(r) && 'border-red-400 bg-red-50')} />
                  </td>
                </tr>
              );
            })}
            {!visible.length && <tr><td colSpan={12} className="py-8 text-center text-slate-400">No items in this filter.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card grid gap-4 p-4 md:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-slate-500">Total claimed</div><div className="text-lg font-semibold tabular-nums">{money(totals.claimed)}</div></div>
          <div><div className="text-xs text-slate-500">Total admissible</div><div className="text-lg font-semibold tabular-nums text-green-700">{money(totals.admissible)}</div></div>
          <div><div className="text-xs text-slate-500">Total disallowed</div><div className="text-lg font-semibold tabular-nums text-red-700">{money(totals.disallowed)}</div></div>
          <div><div className="text-xs text-slate-500">Total reduction</div><div className="text-lg font-semibold tabular-nums text-red-700">{money(totals.reduction)}</div></div>
          <div className="col-span-2 text-xs text-slate-600 sm:col-span-4">
            Approved <b>{totals.count.APPROVED}</b> · Modified <b>{totals.count.MODIFIED + totals.count.PARTIAL}</b> · Disallowed <b>{totals.count.DISALLOWED}</b> · Pending <b className={totals.count.PENDING ? 'text-red-700' : ''}>{totals.count.PENDING}</b>
          </div>
        </div>
        <div className="flex min-w-72 flex-col gap-2">
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder={`Overall remarks for round ${roundNo} (optional)`} />
          <div className="flex gap-2">
            <button onClick={save} disabled={pending} className="btn flex-1"><Save className="h-4 w-4" /> Save as draft</button>
            <button onClick={submit} disabled={pending} className="btn btn-primary flex-1"><Send className="h-4 w-4" /> {pending ? 'Working…' : 'Submit to hospital'}</button>
          </div>
          <p className="text-xs text-slate-400">Totals are recalculated and validated on the server when you submit.</p>
        </div>
      </div>
    </div>
  );
}
