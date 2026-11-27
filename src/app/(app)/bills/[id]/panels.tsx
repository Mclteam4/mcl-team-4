import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Card, Notice } from '@/components/ui';
import { inr, num } from '@/lib/format';
import { DOC_TYPES } from '@/lib/status';
import type { LoadedBill } from '@/lib/bills';
import {
  submitBill, acceptBill, clarifyFinance, startRound, requestRevision, respondQuery, financeAction, uploadBillDocs,
} from '../actions';

const Hidden = ({ id }: { id: string }) => <input type="hidden" name="bill_id" value={id} />;
const today = () => new Date().toISOString().slice(0, 10);

export function DocUpload({ billId }: { billId: string }) {
  return (
    <ActionForm action={uploadBillDocs} resetOnSuccess className="mt-4 space-y-2 border-t border-slate-100 pt-3">
      <Hidden id={billId} />
      <div className="flex flex-wrap gap-2">
        <select name="doc_type" defaultValue="FINAL_BILL" className="flex-1">
          {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="file" name="files" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" className="flex-1" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">PDF, JPG, PNG, Excel or CSV · max 20 MB each</span>
        <SubmitButton className="btn-sm">Upload</SubmitButton>
      </div>
    </ActionForm>
  );
}

function lastAudit(data: LoadedBill, action: string) {
  return [...data.audit].reverse().find((a) => a.action === action)?.new_data as Record<string, string> | undefined;
}

// ------------------------------------------------------------------ HOSPITAL
export function HospitalPanel({ data }: { data: LoadedBill }) {
  const { bill, items, docs, finance } = data;
  const id = bill.id;
  if (['DRAFT', 'REVISION_REQUESTED'].includes(bill.status)) {
    const hasFinal = docs.some((d) => d.doc_type === 'FINAL_BILL');
    const rev = bill.status === 'REVISION_REQUESTED' ? lastAudit(data, 'REVISION_REQUESTED') : undefined;
    return (
      <Card title={bill.status === 'DRAFT' ? 'Prepare & submit bill' : 'Revise & resubmit bill'}>
        {rev && <Notice tone="red">AMO requested revision: {rev.reason}</Notice>}
        <ul className="my-3 space-y-1 text-sm">
          <li>{items.length ? '✅' : '⬜'} Item-wise bill entered ({items.length} items, {inr(bill.total_claimed)})</li>
          <li>{hasFinal ? '✅' : '⬜'} Final hospital bill uploaded</li>
          <li>{docs.some((d) => d.doc_type === 'DISCHARGE_SUMMARY') ? '✅' : '⬜'} Discharge summary uploaded (recommended)</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link href={`/bills/${id}/edit`} className="btn">Edit items / import Excel</Link>
          <ActionForm action={submitBill} confirm="Submit this bill to MCL? Items cannot be edited after submission.">
            <Hidden id={id} />
            <SubmitButton className="btn-primary">Submit to MCL</SubmitButton>
          </ActionForm>
        </div>
      </Card>
    );
  }
  if (bill.status === 'SENT_TO_HOSPITAL') {
    return (
      <Card title="Verified bill — your response">
        <p className="text-sm text-slate-600">AMO admitted <b className="text-green-800">{inr(bill.final_admissible)}</b> against {inr(bill.total_claimed)} claimed.
          Review the item-wise decisions below.</p>
        <ActionForm action={acceptBill} className="mt-3 space-y-2" confirm="Accept the verified amount? The bill will move to Finance.">
          <Hidden id={id} />
          <label className="flex items-start gap-2 text-sm font-normal text-slate-700">
            <input type="checkbox" name="confirm" className="mt-0.5" /> We accept the AMO-verified amount and require no further clarification.
          </label>
          <SubmitButton className="btn-success w-full">Accept verified bill</SubmitButton>
        </ActionForm>
        <Link href={`/bills/${id}/query`} className="btn mt-2 w-full">Raise query on items</Link>
      </Card>
    );
  }
  if (bill.status === 'FINANCE_RETURNED' && finance?.return_target === 'HOSPITAL') {
    return (
      <Card title="Finance needs clarification">
        <Notice tone="red">{finance.return_reason}</Notice>
        <p className="mt-2 text-xs text-slate-500">Upload any documents requested below, then send your clarification.</p>
        <ActionForm action={clarifyFinance} className="mt-2 space-y-2">
          <Hidden id={id} />
          <textarea name="note" rows={3} className="w-full" placeholder="Clarification / documents provided" required />
          <SubmitButton className="btn-primary">Send to Finance</SubmitButton>
        </ActionForm>
      </Card>
    );
  }
  const where: Record<string, string> = {
    SUBMITTED: 'with the AMO for verification', UNDER_VERIFICATION: 'being verified by the AMO',
    QUERY_RAISED: 'with the AMO for query review', FINANCE_RETURNED: 'with the AMO for medical clarification requested by Finance',
  };
  return <Card title="Status"><p className="text-sm text-slate-600">{where[bill.status] ? `This bill is ${where[bill.status]}.` : 'No action is pending from the hospital.'}</p></Card>;
}

// ------------------------------------------------------------------ AMO
export function AmoPanel({ data }: { data: LoadedBill }) {
  const { bill, queries, finance, draft } = data;
  const id = bill.id;
  if (draft) {
    return (
      <Card title={`Verification round ${draft.round_no} in progress`}>
        <Link href={`/bills/${id}/verify`} className="btn btn-primary w-full">Continue item-wise verification</Link>
      </Card>
    );
  }
  if (bill.status === 'SUBMITTED') {
    return (
      <Card title="New bill — verify">
        <ActionForm action={startRound}><Hidden id={id} />
          <SubmitButton className="btn-primary w-full">Start verification (run CGHS check)</SubmitButton></ActionForm>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-slate-600">Return to hospital for correction instead</summary>
          <ActionForm action={requestRevision} className="mt-2 space-y-2"><Hidden id={id} />
            <textarea name="reason" rows={2} className="w-full" placeholder="What must the hospital correct or upload?" required />
            <SubmitButton className="btn-danger btn-sm">Request revision</SubmitButton>
          </ActionForm>
        </details>
      </Card>
    );
  }
  if (bill.status === 'QUERY_RAISED') {
    const open = queries.filter((q) => q.status === 'OPEN');
    return (
      <Card title={`Hospital queries (${open.length} open)`}>
        <div className="space-y-3">
          {open.map((q) => {
            const it = data.items.find((i) => i.id === q.bill_item_id);
            return (
              <ActionForm key={q.id} action={respondQuery} className="rounded-md border border-slate-200 p-2">
                <Hidden id={id} /><input type="hidden" name="query_id" value={q.id} />
                <p className="text-sm font-medium">{it ? `Line ${it.line_no}: ${it.description}` : 'General'}</p>
                <p className="text-sm text-slate-600">{q.reason}</p>
                <div className="mt-2 flex gap-2">
                  <select name="type" className="w-40">
                    <option value="ACCEPTED">Accept explanation</option><option value="MODIFIED">Modify amount</option>
                    <option value="REJECTED">Reject query</option><option value="CLARIFICATION_SOUGHT">Seek clarification</option>
                  </select>
                  <input name="response" className="flex-1" placeholder="Reply / reason" required />
                </div>
                <SubmitButton className="btn-sm mt-2">Record response</SubmitButton>
              </ActionForm>
            );
          })}
        </div>
        <ActionForm action={startRound} className="mt-4 border-t border-slate-100 pt-3"><Hidden id={id} />
          <p className="mb-2 text-xs text-slate-500">Then start a new verification round (previous decisions are carried forward) to revise amounts and resend.</p>
          <SubmitButton className="btn-primary w-full">Start revision round</SubmitButton>
        </ActionForm>
      </Card>
    );
  }
  if (bill.status === 'FINANCE_RETURNED' && finance?.return_target === 'AMO') {
    return (
      <Card title="Returned by Finance for medical clarification">
        <Notice tone="red">{finance.return_reason}</Notice>
        <ActionForm action={startRound} className="mt-3"><Hidden id={id} />
          <SubmitButton className="btn-primary w-full">Start new verification round</SubmitButton></ActionForm>
      </Card>
    );
  }
  const msg: Record<string, string> = {
    SENT_TO_HOSPITAL: 'Awaiting hospital acceptance or query.', REVISION_REQUESTED: 'Awaiting revised bill from hospital.',
    DRAFT: 'Hospital has not submitted this bill yet.',
  };
  return <Card title="Status"><p className="text-sm text-slate-600">{msg[bill.status] ?? 'No AMO action pending. The bill is with Finance or closed.'}</p></Card>;
}

// ------------------------------------------------------------------ FINANCE
export function FinancePanel({ data }: { data: LoadedBill }) {
  const { bill, finance } = data;
  const id = bill.id;
  if (!finance) return null;
  const returnForm = (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-slate-600">Return for clarification</summary>
      <ActionForm action={financeAction} className="mt-2 space-y-2"><Hidden id={id} /><input type="hidden" name="action" value="RETURN" />
        <select name="target" className="w-full">
          <option value="AMO">To AMO — medical point (new verification round)</option>
          <option value="HOSPITAL">To hospital — documents / billing details</option>
        </select>
        <textarea name="reason" rows={2} className="w-full" placeholder="Reason" required />
        <SubmitButton className="btn-danger btn-sm">Return bill</SubmitButton>
      </ActionForm>
    </details>
  );
  if (finance.status === 'PENDING_FINANCE_VERIFICATION') {
    return (
      <Card title="Financial scrutiny & sanction">
        <p className="text-sm">Medically admissible amount: <b className="text-green-800">{inr(finance.final_admissible)}</b></p>
        <p className="text-xs text-slate-500">Finance cannot change AMO decisions. Sanction ≤ admissible; deductions and differences need remarks.</p>
        <ActionForm action={financeAction} className="mt-3 space-y-2"><Hidden id={id} /><input type="hidden" name="action" value="APPROVE" />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1"><label>Sanctioned amount (₹)</label>
              <input name="sanctioned_amount" type="number" step="0.01" min="0" max={num(finance.final_admissible)} defaultValue={num(finance.final_admissible)} required /></div>
            <div className="flex flex-col gap-1"><label>Approval date</label><input name="approval_date" type="date" defaultValue={today()} /></div>
            {(['tds', 'advance', 'recovery'] as const).map((k) => (
              <div key={k} className="col-span-2 grid grid-cols-3 gap-2">
                <input name={`ded_${k}`} type="number" step="0.01" min="0" placeholder={`${k.toUpperCase()} deduction ₹`} />
                <input name={`ded_${k}_reason`} className="col-span-2" placeholder="Reason / reference" />
              </div>
            ))}
          </div>
          <textarea name="remarks" rows={2} className="w-full" placeholder="Scrutiny remarks" />
          <SubmitButton className="btn-success w-full">Financially approve</SubmitButton>
        </ActionForm>
        {returnForm}
      </Card>
    );
  }
  if (finance.status === 'FINANCIALLY_APPROVED') {
    return (
      <Card title="Process payment">
        <p className="text-sm">Sanctioned: <b>{inr(finance.sanctioned_amount)}</b></p>
        <ActionForm action={financeAction} className="mt-3 space-y-2"><Hidden id={id} /><input type="hidden" name="action" value="PROCESS" />
          <input name="voucher_no" className="w-full" placeholder="Payment voucher number" required />
          <input name="sap_doc_no" className="w-full" placeholder="SAP document number" required />
          <input name="remarks" className="w-full" placeholder="Payment remarks" />
          <SubmitButton className="btn-primary w-full">Mark payment processed</SubmitButton>
        </ActionForm>
        {returnForm}
      </Card>
    );
  }
  if (finance.status === 'PAYMENT_PROCESSED') {
    return (
      <Card title="Complete payment">
        <ActionForm action={financeAction} className="space-y-2"><Hidden id={id} /><input type="hidden" name="action" value="COMPLETE" />
          <div className="flex flex-col gap-1"><label>Payment date</label><input name="payment_date" type="date" defaultValue={today()} required /></div>
          <input name="remarks" className="w-full" placeholder="Remarks (UTR / bank reference)" />
          <SubmitButton className="btn-success w-full">Mark payment completed</SubmitButton>
        </ActionForm>
      </Card>
    );
  }
  return <Card title="Status"><p className="text-sm text-slate-600">{finance.status === 'PAYMENT_COMPLETED' ? 'Payment completed. Hospital and AMO have been notified.' : 'Returned for clarification — awaiting response.'}</p></Card>;
}
