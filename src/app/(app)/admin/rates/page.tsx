import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Card, PageHeader, TableWrap, Badge, Field, Notice } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { uploadRateSchedule, activateRateVersion, deleteDraftVersion } from '../actions';

export const metadata = { title: 'CGHS rate master' };

export default async function RatesPage() {
  await requireUser('admin');
  const sb = await supabaseServer();
  const { data: versions } = await sb.from('cghs_rate_versions').select('*').order('rate_type').order('effective_from', { ascending: false });

  return (
    <div className="space-y-5">
      <PageHeader title="CGHS & medicine rate master" subtitle="Only administrator-uploaded, activated schedules are used for verification. Rates are never hardcoded." />
      <Notice tone="yellow">Upload the official CGHS rate list (and the medicine price schedule) exactly as notified. Base rates are for NABH · Tier-I · Semi-private;
        city, accreditation and ward factors from Settings are applied by the engine (per MOU).</Notice>
      <Card title="Upload new schedule (Excel / CSV)">
        <ActionForm action={uploadRateSchedule} resetOnSuccess className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Schedule type"><select name="rate_type"><option value="CGHS">CGHS (procedures, packages, investigations, room, implants)</option><option value="MEDICINE">Medicine price schedule</option></select></Field>
          <Field label="Version label"><input name="version_label" required placeholder="CGHS-2025-OM-Oct" /></Field>
          <Field label="Notification / OM reference"><input name="notification_ref" placeholder="OM No. …" /></Field>
          <Field label="Effective from"><input name="effective_from" type="date" required /></Field>
          <Field label="Effective to (optional)"><input name="effective_to" type="date" /></Field>
          <Field label="File"><input name="file" type="file" accept=".xlsx,.csv" required /></Field>
          <div className="flex items-center gap-3 md:col-span-3 xl:col-span-6">
            <SubmitButton className="btn-primary">Upload as draft</SubmitButton>
            <a className="link text-sm" href="/api/templates/rates">Download template</a>
            <span className="text-xs text-slate-500">Columns: code, name, category, specification, unit, city_class (blank = all), base_rate, package_days, remarks</span>
          </div>
        </ActionForm>
      </Card>
      <Card title="Schedule versions">
        <TableWrap><table>
          <thead><tr><th>Type</th><th>Version</th><th>Reference</th><th>Effective</th><th>Rows</th><th>Status</th><th>Uploaded</th><th></th></tr></thead>
          <tbody>{versions?.map((v) => (
            <tr key={v.id}>
              <td><Badge tone="navy">{v.rate_type}</Badge></td>
              <td className="font-medium"><Link className="link" href={`/admin/rates/${v.id}`}>{v.version_label}</Link><div className="text-xs text-slate-400">{v.source_filename}</div></td>
              <td className="text-xs">{v.notification_ref ?? '—'}</td>
              <td className="text-xs">{fmtDate(v.effective_from)} – {v.effective_to ? fmtDate(v.effective_to) : 'open'}</td>
              <td>{v.row_count}</td>
              <td><Badge tone={v.status === 'ACTIVE' ? 'green' : v.status === 'DRAFT' ? 'yellow' : 'grey'}>{v.status}</Badge></td>
              <td className="text-xs">{fmtDateTime(v.uploaded_at)}</td>
              <td>{v.status === 'DRAFT' && (
                <div className="flex gap-1">
                  <ActionForm action={activateRateVersion} confirm={`Activate ${v.version_label}? It will be used for bills with admission on/after ${v.effective_from}.`}>
                    <input type="hidden" name="id" value={v.id} /><SubmitButton className="btn-success btn-sm">Activate</SubmitButton></ActionForm>
                  <form action={deleteDraftVersion}><input type="hidden" name="id" value={v.id} /><button className="btn btn-sm">Delete</button></form>
                </div>)}</td>
            </tr>))}
            {!versions?.length && <tr><td colSpan={8} className="py-6 text-center text-slate-400">No schedules uploaded yet.</td></tr>}
          </tbody>
        </table></TableWrap>
      </Card>
    </div>
  );
}
