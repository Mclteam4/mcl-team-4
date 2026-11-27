import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Printer, FileText } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { loadBill } from '@/lib/bills';
import { inr, fmtDate, fmtDateTime, num } from '@/lib/format';
import { categoryLabel, DOC_TYPES } from '@/lib/status';
import { Card, PageHeader, StatusBadge, MatchBadge, DecisionBadge, Stat, TableWrap, Empty, Badge } from '@/components/ui';
import { Countdown } from '@/components/Countdown';
import { HospitalPanel, AmoPanel, FinancePanel, DocUpload } from './panels';

export const metadata = { title: 'Bill' };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const data = await loadBill(id);
  if (!data) notFound();
  const { bill, referral, items, docs, rounds, submitted, decisions, queries, finance, audit } = data;
  const admissible = submitted ? num(submitted.total_admissible) : null;
  const editable = user.role === 'hospital' && ['DRAFT', 'REVISION_REQUESTED'].includes(bill.status);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Bill ${bill.tracking_no}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={bill.status} /> Hospital bill no. {bill.hospital_bill_no} · {bill.bill_type} · version {bill.version}</span>}
        actions={<>
          <Link href={`/bills/${id}/print`} className="btn"><Printer className="h-4 w-4" /> Print / PDF</Link>
          <a href={`/api/export/bill/${id}`} className="btn"><Download className="h-4 w-4" /> Excel</a>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Amount claimed" value={inr(bill.total_claimed)} />
        <Stat label="Admissible (AMO)" value={admissible === null ? '—' : inr(admissible)} tone={admissible === null ? undefined : 'green'} />
        <Stat label="Disallowed / reduced" value={admissible === null ? '—' : inr(num(bill.total_claimed) - admissible)} tone={admissible === null ? undefined : 'red'} />
        <Stat label="Sanctioned (Finance)" value={inr(finance?.sanctioned_amount)} hint={finance ? finance.status.replaceAll('_', ' ').toLowerCase() : undefined} />
      </div>

      {bill.status === 'SENT_TO_HOSPITAL' && bill.query_deadline && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-sky-200 bg-sky-50 px-4 py-3 text-sm">
          <span>Hospital may accept or raise a query until <b>{fmtDateTime(bill.query_deadline)}</b>. After that the bill is automatically forwarded to Finance.</span>
          <Countdown deadline={bill.query_deadline} />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Patient & referral" className="xl:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
            {[
              ['Patient', `${bill.patient_name} (${bill.patient_category ?? ''}${referral?.relationship ? ', ' + referral.relationship : ''})`],
              ['Employee', `${bill.employee_name} · ${bill.employee_code}`],
              ['Area', bill.area_name],
              ['Referral ID', bill.referral_no],
              ['Referring AMO', bill.amo_name],
              ['Hospital', `${bill.hospital_name}, ${bill.hospital_city}`],
              ['Admission – discharge', `${fmtDate(bill.admission_date)} – ${fmtDate(bill.discharge_date)}`],
              ['Ward entitled / occupied', `${referral?.ward_entitled ?? '—'} / ${referral?.ward_occupied ?? '—'}`],
              ['MOU', referral?.mou_no ?? '—'],
              ['Diagnosis', bill.diagnosis],
            ].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v ?? '—'}</dd></div>
            ))}
          </dl>
        </Card>
        <div className="no-print space-y-5">
          {user.role === 'hospital' && <HospitalPanel data={data} />}
          {user.role === 'amo' && <AmoPanel data={data} />}
          {user.role === 'finance' && <FinancePanel data={data} />}
          {['admin', 'management'].includes(user.role) && (
            <Card title="Read-only view"><p className="text-sm text-slate-600">Workflow actions are performed by the hospital, AMO and Finance users.</p></Card>
          )}
        </div>
      </div>

      <Card title={`Bill items (${items.length})${submitted ? ` — AMO verification round ${submitted.round_no}` : ''}`}
        actions={editable ? <Link href={`/bills/${id}/edit`} className="btn btn-primary btn-sm">Edit items</Link> : undefined}>
        {items.length === 0 ? <Empty>No items yet{editable ? ' — add items or import an Excel file.' : '.'}</Empty> : (
          <TableWrap>
            <table>
              <thead><tr>
                <th>#</th><th>Category</th><th>Description</th><th>Code / spec / unit</th>
                <th className="text-right">Qty</th><th className="text-right">Rate claimed</th><th className="text-right">Amount claimed</th>
                {submitted && <><th>CGHS check</th><th className="text-right">CGHS rate</th><th className="text-right">Adm. qty</th>
                  <th className="text-right">Adm. rate</th><th className="text-right">Admissible</th><th>Decision / remarks</th></>}
              </tr></thead>
              <tbody>
                {items.map((it) => {
                  const d = decisions.get(it.id);
                  return (
                    <tr key={it.id} className={d?.decision === 'DISALLOWED' ? 'bg-red-50/40' : undefined}>
                      <td className="text-slate-400">{it.line_no}</td>
                      <td className="whitespace-nowrap">{categoryLabel(it.category)}</td>
                      <td>{it.description}{it.service_date && <div className="text-xs text-slate-400">{fmtDate(it.service_date)}</div>}</td>
                      <td className="text-xs text-slate-600">{[it.cghs_code, it.specification, it.unit].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="text-right tabular-nums">{num(it.quantity)}</td>
                      <td className="text-right tabular-nums">{inr(it.rate_claimed)}</td>
                      <td className="text-right tabular-nums">{inr(it.amount_claimed)}</td>
                      {submitted && (d ? <>
                        <td><MatchBadge status={d.match_status} /></td>
                        <td className="text-right tabular-nums">{inr(d.cghs_rate)}</td>
                        <td className="text-right tabular-nums">{num(d.admissible_qty)}</td>
                        <td className="text-right tabular-nums">{inr(d.admissible_rate)}</td>
                        <td className="text-right font-semibold tabular-nums">{inr(d.admissible_amount)}</td>
                        <td className="min-w-48"><DecisionBadge decision={d.decision} />{d.remarks && <div className="mt-1 text-xs text-slate-600">{d.remarks}</div>}</td>
                      </> : <td colSpan={6} className="text-xs text-slate-400">Added after verification</td>)}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="font-semibold">
                <td colSpan={6} className="text-right">Total</td>
                <td className="text-right tabular-nums">{inr(bill.total_claimed)}</td>
                {submitted && <><td colSpan={4}></td><td className="text-right tabular-nums text-green-800">{inr(submitted.total_admissible)}</td><td></td></>}
              </tr></tfoot>
            </table>
          </TableWrap>
        )}
        <div className="mt-6 grid grid-cols-2 gap-2 text-xs text-slate-600 md:grid-cols-5">
          {[['Medicines', bill.total_medicine], ['Procedures', bill.total_procedure], ['Investigations', bill.total_investigation],
            ['Room / ICU', bill.total_room], ['Other', bill.total_other]].map(([k, v]) => (
            <div key={k as string} className="rounded bg-slate-50 px-2 py-1.5">{k}: <b className="tabular-nums">{inr(v)}</b></div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Queries & responses">
          {queries.length === 0 ? <Empty>No queries raised.</Empty> : (
            <ul className="space-y-3">
              {queries.map((q) => {
                const it = items.find((i) => i.id === q.bill_item_id);
                return (
                  <li key={q.id} className="rounded-md border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={q.status === 'OPEN' ? 'red' : 'grey'}>{q.status.replaceAll('_', ' ')}</Badge>
                      <span className="font-medium">{it ? `Line ${it.line_no}: ${it.description}` : 'General observation'}</span>
                      <span className="text-xs text-slate-400">{q.query_type.replaceAll('_', ' ').toLowerCase()} · {fmtDateTime(q.raised_at)}</span>
                    </div>
                    <p className="mt-1 text-slate-700">{q.reason}</p>
                    {(q.query_responses ?? []).map((r: Record<string, string>) => (
                      <div key={r.id} className="mt-2 rounded bg-navy-50 px-2 py-1.5">
                        <span className="text-xs font-semibold text-navy-800">AMO — {r.response_type.replaceAll('_', ' ').toLowerCase()} · {fmtDateTime(r.created_at)}</span>
                        <p>{r.response}</p>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={`Supporting documents (${docs.length})`}>
          {docs.length === 0 ? <Empty>No documents uploaded.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">{d.file_name}</span>
                    <Badge>{DOC_TYPES.find(([k]) => k === d.doc_type)?.[1] ?? d.doc_type}</Badge>
                  </span>
                  <a className="link shrink-0" href={`/api/documents/${d.id}`} target="_blank" rel="noopener">Open</a>
                </li>
              ))}
            </ul>
          )}
          {(['hospital', 'amo'].includes(user.role) && !['PAYMENT_COMPLETED'].includes(bill.status)) && <DocUpload billId={id} />}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Verification history">
          {rounds.length === 0 ? <Empty>Not yet verified.</Empty> : (
            <TableWrap><table>
              <thead><tr><th>Round</th><th>Status</th><th className="text-right">Claimed</th><th className="text-right">Admissible</th><th>Items A / M / D</th><th>Sent · deadline</th></tr></thead>
              <tbody>{rounds.map((r) => (
                <tr key={r.id}>
                  <td>v{r.round_no}</td>
                  <td><Badge tone={r.status === 'SUBMITTED' ? 'green' : 'yellow'}>{r.status === 'SUBMITTED' ? 'Sent to hospital' : 'Draft'}</Badge></td>
                  <td className="text-right tabular-nums">{inr(r.total_claimed)}</td>
                  <td className="text-right tabular-nums">{r.status === 'SUBMITTED' ? inr(r.total_admissible) : '—'}</td>
                  <td>{r.approved_count} / {r.modified_count} / {r.disallowed_count}</td>
                  <td className="text-xs">{fmtDateTime(r.sent_at)}<br />{r.deadline ? `till ${fmtDateTime(r.deadline)}` : ''}</td>
                </tr>))}
              </tbody>
            </table></TableWrap>
          )}
          {finance && (
            <dl className="mt-6 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-sm">
              <div><dt className="text-xs text-slate-500">Forwarded to Finance</dt><dd>{fmtDateTime(finance.received_at)} ({finance.forward_mode === 'DEEMED' ? 'deemed acceptance' : 'hospital accepted'})</dd></div>
              <div><dt className="text-xs text-slate-500">Finance status</dt><dd>{finance.status.replaceAll('_', ' ')}</dd></div>
              {(finance.payment_records ?? []).map((p: Record<string, string>) => (
                <div key={p.id} className="col-span-2 rounded bg-green-50 px-2 py-1.5">
                  Voucher <b>{p.voucher_no}</b> · SAP doc <b>{p.sap_doc_no}</b> · {inr(p.amount)} · paid {fmtDate(p.payment_date)}
                </div>
              ))}
              {finance.return_reason && <div className="col-span-2 text-red-700">Returned to {finance.return_target}: {finance.return_reason}</div>}
            </dl>
          )}
        </Card>

        <Card title="Timeline (audit trail)">
          <ol className="relative max-h-[28rem] space-y-3 overflow-y-auto border-l border-slate-200 pl-4">
            {audit.map((a) => (
              <li key={a.id} className="text-sm">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-navy-700" />
                <div className="font-medium">{a.action.replaceAll('_', ' ').toLowerCase().replace(/^./, (c: string) => c.toUpperCase())}</div>
                <div className="text-xs text-slate-500">{fmtDateTime(a.at)} · {a.actor_label}</div>
              </li>
            ))}
            {!audit.length && <li className="text-sm text-slate-400">No activity yet.</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
