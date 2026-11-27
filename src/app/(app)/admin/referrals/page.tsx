import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { Card, PageHeader, TableWrap, Badge } from '@/components/ui';
import { ReferralForm } from '@/components/ReferralForm';

export const metadata = { title: 'Referrals & exceptions' };

export default async function AdminReferrals() {
  await requireUser('admin');
  const sb = await supabaseServer();
  const [{ data: refs }, { data: hospitals }, { data: amos }, { data: areas }] = await Promise.all([
    sb.from('referral_overview').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('hospitals').select('id, name').eq('active', true).order('name'),
    sb.from('users').select('id, full_name').eq('role', 'amo').eq('active', true).order('full_name'),
    sb.from('areas').select('id, name').order('name'),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="Referrals & authorised exceptions" subtitle="Use an exception referral only where a bill must be accepted without a prior AMO referral (e.g. emergency)." />
      <Card title={`Recent referrals (${refs?.length ?? 0})`}>
        <TableWrap><table>
          <thead><tr><th>Referral</th><th>Patient</th><th>Hospital</th><th>AMO</th><th>Date</th><th>Bills</th><th></th></tr></thead>
          <tbody>{refs?.map((r) => (
            <tr key={r.id}><td className="font-medium">{r.referral_no}</td><td>{r.patient_name}<div className="text-xs text-slate-500">{r.employee_code}</div></td>
              <td>{r.hospital_name}</td><td>{r.amo_name}</td><td className="text-xs">{fmtDate(r.referral_date)}</td><td>{r.bill_count}</td>
              <td>{r.is_exception && <Badge tone="yellow" className="whitespace-normal">Exception: {r.exception_reason}</Badge>}</td></tr>))}
          </tbody>
        </table></TableWrap>
      </Card>
      <h2 className="text-base font-semibold">Create exception referral</h2>
      <ReferralForm hospitals={(hospitals ?? []).map((h) => ({ id: h.id, name: h.name }))}
        admin={{ amos: (amos ?? []).map((a) => ({ id: a.id, name: a.full_name })), areas: (areas ?? []).map((a) => ({ id: a.id, name: a.name })) }} />
    </div>
  );
}
