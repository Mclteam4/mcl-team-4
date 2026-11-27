import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { loadBill } from '@/lib/bills';
import { inr, num, fmtDateTime } from '@/lib/format';
import { Card, PageHeader, TableWrap, DecisionBadge } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { Countdown } from '@/components/Countdown';
import { raiseQuery } from '../../actions';

export const metadata = { title: 'Raise query' };

export default async function QueryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser('hospital');
  const data = await loadBill(id);
  if (!data) notFound();
  const { bill, items, decisions } = data;
  if (bill.status !== 'SENT_TO_HOSPITAL') redirect(`/bills/${id}`);
  // modified / disallowed / partially approved items first
  const rows = [...items].sort((a, b) => {
    const w = (i: typeof a) => (decisions.get(i.id)?.decision === 'APPROVED' ? 1 : 0);
    return w(a) - w(b) || a.line_no - b.line_no;
  });

  return (
    <div className="space-y-5">
      <PageHeader title={`Raise query — ${bill.tracking_no}`}
        subtitle={<>Deadline {fmtDateTime(bill.query_deadline)} · <Countdown deadline={bill.query_deadline} /></>}
        actions={<Link href={`/bills/${id}`} className="btn">Cancel</Link>} />
      <ActionForm action={raiseQuery} className="space-y-5">
        <input type="hidden" name="bill_id" value={id} />
        <Card title="Select items to query">
          <TableWrap><table>
            <thead><tr><th></th><th>#</th><th>Item</th><th className="text-right">Claimed</th><th className="text-right">Admissible</th><th>AMO decision</th><th>Query type</th><th>Reason</th></tr></thead>
            <tbody>{rows.map((it) => {
              const d = decisions.get(it.id);
              return (
                <tr key={it.id}>
                  <td><input type="checkbox" name={`q_${it.id}`} aria-label={`Query line ${it.line_no}`} /></td>
                  <td className="text-slate-400">{it.line_no}</td>
                  <td>{it.description}<div className="text-xs text-slate-400">{num(it.quantity)} × {inr(it.rate_claimed)}</div></td>
                  <td className="text-right tabular-nums">{inr(it.amount_claimed)}</td>
                  <td className="text-right tabular-nums">{inr(d?.admissible_amount)}</td>
                  <td>{d && <DecisionBadge decision={d.decision} />}<div className="text-xs text-slate-500">{d?.remarks}</div></td>
                  <td><select name={`type_${it.id}`} defaultValue={d?.decision === 'DISALLOWED' ? (it.category === 'MEDICINE' ? 'DISALLOWED_MEDICINE' : 'DISALLOWED_PROCEDURE') : 'MODIFIED_RATE'}>
                    <option value="MODIFIED_RATE">Modified rate</option><option value="DISALLOWED_MEDICINE">Disallowed medicine</option>
                    <option value="DISALLOWED_PROCEDURE">Disallowed procedure</option><option value="QUANTITY">Quantity discrepancy</option>
                    <option value="OTHER">Other</option></select></td>
                  <td><input name={`reason_${it.id}`} className="w-64" placeholder="Reason (required if selected)" /></td>
                </tr>
              );
            })}</tbody>
          </table></TableWrap>
        </Card>
        <Card title="General observation & supporting document">
          <textarea name="general_reason" rows={2} className="w-full" placeholder="Optional observation not tied to a single item" />
          <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" className="mt-2" />
        </Card>
        <SubmitButton className="btn-primary">Send query to AMO</SubmitButton>
      </ActionForm>
    </div>
  );
}
