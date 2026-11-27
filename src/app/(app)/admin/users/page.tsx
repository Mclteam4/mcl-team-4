import { requireUser, ROLE_LABEL, type Role } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { Card, PageHeader, TableWrap, Badge, Field } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { createUser, setUserActive, createDelegation, createArea, setNotifyEmail } from '../actions';

export const metadata = { title: 'Users' };

export default async function UsersPage() {
  await requireUser('admin');
  const sb = await supabaseServer();
  const [{ data: users }, { data: hospitals }, { data: areas }, { data: maps }] = await Promise.all([
    sb.from('users').select('*, hospitals(name), areas(name)').order('role').order('full_name'),
    sb.from('hospitals').select('id, name').eq('active', true).order('name'),
    sb.from('areas').select('id, name, code').order('name'),
    sb.from('amo_doctor_mapping').select('*').order('created_at', { ascending: false }),
  ]);
  const amos = (users ?? []).filter((u) => u.role === 'amo');
  const name = (id: string) => users?.find((u) => u.id === id)?.full_name ?? '—';
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <PageHeader title="Users & AMO mapping" />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Create user account" className="xl:col-span-2">
          <ActionForm action={createUser} resetOnSuccess className="grid gap-3 md:grid-cols-3">
            <Field label="Full name"><input name="full_name" required /></Field>
            <Field label="Email"><input name="email" type="email" required /></Field>
            <Field label="User ID for sign-in (optional)" hint="e.g. dr.sharma — lowercase"><input name="login_id" autoCapitalize="none" /></Field>
            <Field label="Role"><select name="role" required>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <Field label="Hospital (hospital users)"><select name="hospital_id"><option value="">—</option>{hospitals?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
            <Field label="Area (AMOs)"><select name="area_id"><option value="">—</option>{areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Designation"><input name="designation" /></Field>
            <Field label="Employee code"><input name="employee_code" /></Field>
            <Field label="Temporary password" hint="Min 10 characters; user should reset it"><input name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
            <div className="flex items-end"><SubmitButton className="btn-primary">Create user</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Areas / establishments">
          <ul className="mb-3 space-y-1 text-sm">{areas?.map((a) => <li key={a.id}>{a.name} <span className="text-xs text-slate-400">({a.code})</span></li>)}</ul>
          <ActionForm action={createArea} resetOnSuccess className="flex gap-2">
            <input name="code" placeholder="Code" className="w-20" required /><input name="name" placeholder="Area name" className="flex-1" required />
            <SubmitButton className="btn-sm">Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title={`All users (${users?.length ?? 0})`}>
        <p className="mb-3 text-sm text-slate-500">
          Every bill movement is emailed to <b>both sides</b> (the office that raised it and the office it is raised to), quoting the bill&apos;s reference number.
          Mail goes to the <b>notification email</b>; if it is empty, to the login email. Demo addresses ending in <span className="font-mono">.example</span> never receive mail.
        </p>
        <TableWrap><table>
          <thead><tr><th>Name</th><th>User ID</th><th>Login email</th><th>Notification email (bill updates)</th><th>Role</th><th>Hospital / Area</th><th>Designation</th><th>Status</th><th></th></tr></thead>
          <tbody>{users?.map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.full_name}</td><td className="font-mono text-xs">{u.login_id ?? '—'}</td>
              <td className="text-xs">{u.email}</td>
              <td className="min-w-72">
                <ActionForm action={setNotifyEmail} className="flex flex-wrap gap-1">
                  <input type="hidden" name="id" value={u.id} />
                  <input name="notify_email" type="email" defaultValue={u.notify_email ?? ''} placeholder={u.email} aria-label={`Notification email for ${u.full_name}`} className="min-w-0 flex-1 text-xs" />
                  <SubmitButton className="btn-sm">Save</SubmitButton>
                </ActionForm>
              </td><td><Badge tone="navy">{ROLE_LABEL[u.role as Role]}</Badge></td>
              <td>{u.hospitals?.name ?? u.areas?.name ?? '—'}</td><td>{u.designation ?? '—'}</td>
              <td><Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Active' : 'Disabled'}</Badge></td>
              <td><form action={setUserActive}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="active" value={String(!u.active)} />
                <button className="btn btn-sm">{u.active ? 'Disable' : 'Enable'}</button></form></td>
            </tr>))}
          </tbody>
        </table></TableWrap>
      </Card>

      <Card title="AMO delegation / reassignment" >
        <p className="mb-3 text-sm text-slate-500">While an AMO is on leave or transferred, a delegate AMO can verify their bills. Actions are logged under the delegate.</p>
        <ActionForm action={createDelegation} resetOnSuccess className="grid gap-3 md:grid-cols-5">
          <Field label="AMO"><select name="amo_user_id" required>{amos.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}</select></Field>
          <Field label="Delegate AMO"><select name="delegate_user_id" required>{amos.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}</select></Field>
          <Field label="From"><input name="valid_from" type="date" defaultValue={today} required /></Field>
          <Field label="To (optional)"><input name="valid_to" type="date" /></Field>
          <Field label="Reason"><input name="reason" required /></Field>
          <SubmitButton className="btn-primary">Save delegation</SubmitButton>
        </ActionForm>
        {!!maps?.length && (
          <ul className="mt-4 space-y-1 text-sm">{maps.map((m) => (
            <li key={m.id}>{name(m.amo_user_id)} → <b>{name(m.delegate_user_id)}</b> · {fmtDate(m.valid_from)} – {m.valid_to ? fmtDate(m.valid_to) : 'until revoked'} · {m.reason}</li>))}
          </ul>
        )}
      </Card>
    </div>
  );
}
