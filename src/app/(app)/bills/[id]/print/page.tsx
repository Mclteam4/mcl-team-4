import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { loadBill } from '@/lib/bills';
import { inr, fmtDate, fmtDateTime, num, amountInWords } from '@/lib/format';
import { categoryLabel, BILL_STATUS, DECISION } from '@/lib/status';
import { PrintButton } from '@/components/PrintButton';

export const metadata = { title: 'Verified bill statement' };

export default async function PrintBill({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const data = await loadBill(id);
  if (!data) notFound();
  const { bill, referral, items, submitted, decisions, finance } = data;
  const admissible = submitted ? num(submitted.total_admissible) : null;
  const payable = finance?.sanctioned_amount ?? admissible;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-4 flex gap-2"><PrintButton /><Link href={`/bills/${id}`} className="btn">Back</Link></div>
      <article className="bg-white p-8 text-[13px] shadow print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-navy-900 pb-3">
          <div>
            <div className="text-lg font-bold text-navy-900">MAHANADI COALFIELDS LIMITED</div>
            <div className="text-xs">(A Subsidiary of Coal India Limited) · Medical Department</div>
            <div className="mt-1 font-semibold">Hospital Bill Verification Statement</div>
          </div>
          <div className="text-right text-xs">
            <div>Tracking No: <b>{bill.tracking_no}</b></div>
            <div>Status: {BILL_STATUS[bill.status]?.label}</div>
            <div>Printed: {fmtDateTime(new Date().toISOString())}</div>
          </div>
        </header>

        <table className="mt-3 text-xs [&_td]:border-0 [&_td]:py-0.5">
          <tbody>
            <tr><td className="w-40 text-slate-500">Patient</td><td><b>{bill.patient_name}</b> ({bill.patient_category}{referral?.relationship ? `, ${referral.relationship}` : ''})</td>
              <td className="w-40 text-slate-500">Referral ID</td><td>{bill.referral_no}</td></tr>
            <tr><td className="text-slate-500">Employee</td><td>{bill.employee_name} · {bill.employee_code}</td><td className="text-slate-500">Referring AMO</td><td>{bill.amo_name}</td></tr>
            <tr><td className="text-slate-500">Hospital</td><td>{bill.hospital_name}, {bill.hospital_city}</td><td className="text-slate-500">Hospital bill no.</td><td>{bill.hospital_bill_no} dt. {fmtDate(bill.bill_date)}</td></tr>
            <tr><td className="text-slate-500">Admission – discharge</td><td>{fmtDate(bill.admission_date)} – {fmtDate(bill.discharge_date)}</td><td className="text-slate-500">Diagnosis</td><td>{bill.diagnosis}</td></tr>
            <tr><td className="text-slate-500">Verification</td><td>{submitted ? `Round ${submitted.round_no}, sent ${fmtDateTime(submitted.sent_at)}` : 'Not yet verified'}</td>
              <td className="text-slate-500">Area</td><td>{bill.area_name}</td></tr>
          </tbody>
        </table>

        <table className="mt-4 text-xs [&_td]:border [&_td]:border-slate-300 [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-slate-300 [&_th]:px-1.5">
          <thead><tr><th>#</th><th>Category</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Claimed</th>
            <th className="text-right">CGHS rate</th><th className="text-right">Adm. qty</th><th className="text-right">Adm. rate</th><th className="text-right">Admissible</th><th>Decision / remarks</th></tr></thead>
          <tbody>{items.map((it) => {
            const d = decisions.get(it.id);
            return (
              <tr key={it.id}>
                <td>{it.line_no}</td><td>{categoryLabel(it.category)}</td>
                <td>{it.description}{it.specification ? ` (${it.specification})` : ''}</td>
                <td className="text-right">{num(it.quantity)}</td><td className="text-right">{inr(it.rate_claimed)}</td><td className="text-right">{inr(it.amount_claimed)}</td>
                <td className="text-right">{d ? inr(d.cghs_rate) : ''}</td><td className="text-right">{d ? num(d.admissible_qty) : ''}</td>
                <td className="text-right">{d ? inr(d.admissible_rate) : ''}</td><td className="text-right font-semibold">{d ? inr(d.admissible_amount) : ''}</td>
                <td>{d ? `${DECISION[d.decision]?.label}${d.remarks ? ' — ' + d.remarks : ''}` : ''}</td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr className="font-semibold"><td colSpan={5} className="text-right">Total</td><td className="text-right">{inr(bill.total_claimed)}</td>
            <td colSpan={3}></td><td className="text-right">{admissible === null ? '' : inr(admissible)}</td><td></td></tr></tfoot>
        </table>

        <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
          <table className="[&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1">
            <tbody>
              <tr><td>Amount claimed by hospital</td><td className="text-right">{inr(bill.total_claimed)}</td></tr>
              <tr><td>Medically admissible (AMO)</td><td className="text-right">{admissible === null ? '—' : inr(admissible)}</td></tr>
              <tr><td>Disallowed / reduction</td><td className="text-right">{admissible === null ? '—' : inr(num(bill.total_claimed) - admissible)}</td></tr>
              {finance?.sanctioned_amount != null && <tr><td>Sanctioned by Finance</td><td className="text-right">{inr(finance.sanctioned_amount)}</td></tr>}
              {(finance?.payment_records ?? []).map((p: Record<string, string>) => (
                <tr key={p.id}><td>Paid — voucher {p.voucher_no}, SAP {p.sap_doc_no}</td><td className="text-right">{fmtDate(p.payment_date)}</td></tr>
              ))}
            </tbody>
          </table>
          {payable != null && <p className="self-end"><b>Amount payable:</b> {inr(payable)}<br /><i>({amountInWords(num(payable))})</i></p>}
        </div>

        <footer className="mt-14 grid grid-cols-3 gap-6 text-center text-xs">
          {['Verified by (AMO)', 'Checked by (Finance)', 'Approved by (Competent Authority)'].map((s) => (
            <div key={s} className="border-t border-slate-400 pt-1">{s}</div>
          ))}
        </footer>
        <p className="mt-6 text-[10px] text-slate-400">Generated by MCL Medical Bill Management System. Rates verified against administrator-uploaded CGHS schedules effective on the rate reference date.</p>
      </article>
    </div>
  );
}
