import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { CITY_CLASSES } from '@/lib/status';
import { Card, PageHeader, TableWrap, Badge, Field } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { createHospital, createMou, updateHospitalFlags } from '../actions';

export const metadata = { title: 'Hospitals & MOUs' };

export default async function HospitalsPage() {
  await requireUser('admin');
  const sb = await supabaseServer();
  const { data: hospitals } = await sb.from('hospitals').select('*, hospital_mou_details(*)').order('name');

  return (
    <div className="space-y-5">
      <PageHeader title="Hospitals & MOUs" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Register hospital">
          <ActionForm action={createHospital} resetOnSuccess className="grid gap-3 md:grid-cols-3">
            <Field label="Code"><input name="code" required /></Field>
            <Field label="Name" className="md:col-span-2"><input name="name" required /></Field>
            <Field label="City"><input name="city" required /></Field>
            <Field label="State"><input name="state" required defaultValue="Odisha" /></Field>
            <Field label="City class"><select name="city_class">{CITY_CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Address" className="md:col-span-3"><input name="address" /></Field>
            <Field label="GSTIN"><input name="gstin" /></Field><Field label="PAN"><input name="pan" /></Field>
            <Field label="Contact email"><input name="contact_email" type="email" /></Field>
            <Field label="Contact phone"><input name="contact_phone" /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" name="nabh" /> NABH accredited</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="super_specialty" /> Super-specialty</label>
            <SubmitButton className="btn-primary">Register</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Add MOU">
          <ActionForm action={createMou} resetOnSuccess className="grid gap-3 md:grid-cols-2">
            <Field label="Hospital" className="md:col-span-2"><select name="hospital_id" required>{hospitals?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
            <Field label="MOU number"><input name="mou_no" required /></Field>
            <Field label="Discount on CGHS (%)"><input name="discount_pct" type="number" step="0.01" min="0" max="100" defaultValue="0" /></Field>
            <Field label="Valid from"><input name="valid_from" type="date" required /></Field>
            <Field label="Valid to"><input name="valid_to" type="date" required /></Field>
            <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="apply_factors" defaultChecked /> Apply CGHS city / NABH / ward factors to base rates</label>
            <Field label="Remarks" className="md:col-span-2"><input name="remarks" /></Field>
            <SubmitButton className="btn-primary">Save MOU</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <Card title={`Hospitals (${hospitals?.length ?? 0})`}>
        <TableWrap><table>
          <thead><tr><th>Hospital</th><th>Location</th><th>Classification (editable)</th><th>MOUs</th></tr></thead>
          <tbody>{hospitals?.map((h) => (
            <tr key={h.id}>
              <td className="font-medium">{h.name}<div className="text-xs text-slate-400">{h.code} · {h.gstin ?? 'no GSTIN'}</div></td>
              <td>{h.city}, {h.state}</td>
              <td><form action={updateHospitalFlags} className="flex flex-wrap items-center gap-3 text-xs">
                <input type="hidden" name="id" value={h.id} />
                <select name="city_class" defaultValue={h.city_class} className="text-xs">{CITY_CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <label className="flex items-center gap-1"><input type="checkbox" name="nabh" defaultChecked={h.nabh} /> NABH</label>
                <label className="flex items-center gap-1"><input type="checkbox" name="super_specialty" defaultChecked={h.super_specialty} /> Super-spl.</label>
                <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={h.active} /> Active</label>
                <button className="btn btn-sm">Save</button></form></td>
              <td className="text-xs">{h.hospital_mou_details?.map((m: Record<string, string>) => (
                <div key={m.id}><Badge tone={m.valid_to >= new Date().toISOString().slice(0, 10) ? 'green' : 'grey'}>{m.mou_no}</Badge> {fmtDate(m.valid_from)} – {fmtDate(m.valid_to)}{Number(m.discount_pct) ? ` · ${m.discount_pct}% off` : ''}</div>))}
                {!h.hospital_mou_details?.length && <span className="text-red-700">No MOU</span>}</td>
            </tr>))}
          </tbody>
        </table></TableWrap>
      </Card>
    </div>
  );
}
