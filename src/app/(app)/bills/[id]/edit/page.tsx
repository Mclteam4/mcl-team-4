import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { inr, num, fmtDate } from '@/lib/format';
import { CATEGORIES, categoryLabel } from '@/lib/status';
import { Card, PageHeader, TableWrap, Empty, Field } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { addItem, deleteItem, importItems } from '../../actions';

export const metadata = { title: 'Edit bill items' };

export default async function EditBill({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser('hospital');
  const sb = await supabaseServer();
  const { data: bill } = await sb.from('bill_overview').select('*').eq('id', id).maybeSingle();
  if (!bill) notFound();
  if (!['DRAFT', 'REVISION_REQUESTED'].includes(bill.status)) redirect(`/bills/${id}`);
  const { data: items } = await sb.from('hospital_bill_items').select('*').eq('bill_id', id).order('line_no');

  return (
    <div className="space-y-5">
      <PageHeader title={`Bill items — ${bill.tracking_no}`}
        subtitle={`${bill.patient_name} · ${bill.referral_no} · total claimed ${inr(bill.total_claimed)}`}
        actions={<Link href={`/bills/${id}`} className="btn btn-primary">Done — back to bill</Link>} />

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Add item" className="xl:col-span-2">
          <ActionForm action={addItem} resetOnSuccess className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input type="hidden" name="bill_id" value={id} />
            <Field label="Category"><select name="category" required>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Description" className="col-span-2 md:col-span-3"><input name="description" required placeholder="Medicine / procedure / test name" /></Field>
            <Field label="CGHS / medicine code"><input name="cghs_code" placeholder="If available" /></Field>
            <Field label="Specification"><input name="specification" placeholder="e.g. 500 mg" /></Field>
            <Field label="Unit"><input name="unit" placeholder="Tablet / day / test" /></Field>
            <Field label="Service date"><input name="service_date" type="date" /></Field>
            <Field label="Quantity"><input name="quantity" type="number" step="0.001" min="0.001" required /></Field>
            <Field label="Rate claimed (₹)"><input name="rate_claimed" type="number" step="0.01" min="0" required /></Field>
            <div className="col-span-2 flex items-end"><SubmitButton className="btn-primary">Add item</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Import from Excel / CSV">
          <ActionForm action={importItems} resetOnSuccess className="space-y-3">
            <input type="hidden" name="bill_id" value={id} />
            <input type="file" name="file" accept=".xlsx,.csv" required className="w-full" />
            <SubmitButton className="btn-primary w-full">Import items</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-slate-500">Columns: category, description, cghs_code, specification, unit, quantity, rate_claimed, service_date (YYYY-MM-DD).
            Amount = quantity × rate is calculated automatically. All rows are validated; nothing is imported if any row has an error.</p>
          <a href="/api/templates/bill-items" className="link mt-2 inline-block text-sm">Download template</a>
        </Card>
      </div>

      <Card title={`Items (${items?.length ?? 0})`}>
        {!items?.length ? <Empty>No items yet.</Empty> : (
          <TableWrap><table>
            <thead><tr><th>#</th><th>Category</th><th>Description</th><th>Code / spec / unit</th><th>Date</th>
              <th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th></th></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.id}>
                <td className="text-slate-400">{it.line_no}</td><td>{categoryLabel(it.category)}</td><td>{it.description}</td>
                <td className="text-xs">{[it.cghs_code, it.specification, it.unit].filter(Boolean).join(' · ') || '—'}</td>
                <td className="text-xs">{fmtDate(it.service_date)}</td>
                <td className="text-right tabular-nums">{num(it.quantity)}</td><td className="text-right tabular-nums">{inr(it.rate_claimed)}</td>
                <td className="text-right tabular-nums">{inr(it.amount_claimed)}</td>
                <td><form action={deleteItem}><input type="hidden" name="bill_id" value={id} /><input type="hidden" name="item_id" value={it.id} />
                  <button className="text-slate-400 hover:text-red-700" aria-label="Delete item"><Trash2 className="h-4 w-4" /></button></form></td>
              </tr>))}
            </tbody>
            <tfoot><tr className="font-semibold"><td colSpan={7} className="text-right">Grand total claimed</td><td className="text-right tabular-nums">{inr(bill.total_claimed)}</td><td /></tr></tfoot>
          </table></TableWrap>
        )}
      </Card>
    </div>
  );
}
