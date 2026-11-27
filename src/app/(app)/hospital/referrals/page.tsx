import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { Card, PageHeader, TableWrap, Empty, Badge } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { createBill } from '../../bills/actions';

export const metadata = { title: 'Referred patients' };

export default async function HospitalReferrals() {
  await requireUser('hospital');
  const sb = await supabaseServer();
  const { data: refs } = await sb.from('referral_overview').select('*').order('referral_date', { ascending: false });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Patients referred by MCL" subtitle="Bills can only be raised against a valid MCL referral." />
      <Card>
        {!refs?.length ? <Empty>No referrals to your hospital yet.</Empty> : (
          <TableWrap><table>
            <thead><tr><th>Referral</th><th>Patient</th><th>Employee</th><th>Referring AMO</th><th>Admission – discharge</th><th>Diagnosis</th><th>Bills</th><th className="w-[26rem]">Raise bill</th></tr></thead>
            <tbody>{refs.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-medium">{r.referral_no}<div className="text-xs text-slate-400">{fmtDate(r.referral_date)}</div>
                  {r.is_exception && <Badge tone="yellow">Admin exception</Badge>}</td>
                <td>{r.patient_name}<div className="text-xs text-slate-500">{r.patient_category}{r.relationship ? ` · ${r.relationship}` : ''}</div></td>
                <td>{r.employee_name}<div className="text-xs text-slate-500">{r.employee_code} · {r.area_name}</div></td>
                <td>{r.amo_name}</td>
                <td className="text-xs">{fmtDate(r.admission_date)} – {fmtDate(r.discharge_date)}</td>
                <td className="text-xs">{r.diagnosis}</td>
                <td>{r.bill_count > 0 ? <Link className="link" href={`/search?q=${encodeURIComponent(r.referral_no)}`}>{r.bill_count}</Link> : 0}</td>
                <td>{r.status === 'ACTIVE' ? (
                  <ActionForm action={createBill} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="referral_id" value={r.id} />
                    <input name="hospital_bill_no" placeholder="Hospital bill no." required className="w-32" />
                    <input name="bill_date" type="date" defaultValue={today} required className="w-36" />
                    <select name="bill_type" className="w-28"><option value="FINAL">Final</option><option value="INTERIM">Interim</option><option value="SUPPLEMENTARY">Supplementary</option></select>
                    <SubmitButton className="btn-primary btn-sm">Create</SubmitButton>
                  </ActionForm>) : <Badge>{r.status}</Badge>}</td>
              </tr>))}
            </tbody>
          </table></TableWrap>
        )}
      </Card>
    </div>
  );
}
