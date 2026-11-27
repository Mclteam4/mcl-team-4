import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { Card, PageHeader, TableWrap, Empty, Badge } from '@/components/ui';

export const metadata = { title: 'My referrals' };

export default async function AmoReferrals({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser('amo', 'admin');
  const { q = '' } = await searchParams;
  const sb = await supabaseServer();
  let query = sb.from('referral_overview').select('*').order('referral_date', { ascending: false }).limit(300);
  if (user.role === 'amo') query = query.eq('referring_amo_id', user.id);
  if (q) query = query.ilike('search_text', `%${q.toLowerCase().replace(/[%_]/g, '')}%`);
  const { data: refs } = await query;

  return (
    <div>
      <PageHeader title="Patients referred by me" actions={<Link href="/amo/referrals/new" className="btn btn-primary">New referral</Link>} />
      <form className="mb-3"><input name="q" defaultValue={q} placeholder="Search referral, patient, employee ID, hospital…" className="w-full max-w-md" /></form>
      <Card>
        {!refs?.length ? <Empty>No referrals yet.</Empty> : (
          <TableWrap><table>
            <thead><tr><th>Referral</th><th>Patient</th><th>Employee</th><th>Hospital</th><th>Admission – discharge</th><th>Diagnosis</th><th>MOU</th><th>Bills</th><th>Status</th></tr></thead>
            <tbody>{refs.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-medium">{r.referral_no}<div className="text-xs text-slate-400">{fmtDate(r.referral_date)}</div></td>
                <td>{r.patient_name}<div className="text-xs text-slate-500">{r.patient_category}{r.relationship ? ` · ${r.relationship}` : ''}</div></td>
                <td>{r.employee_name}<div className="text-xs text-slate-500">{r.employee_code}</div></td>
                <td>{r.hospital_name}</td>
                <td className="text-xs">{fmtDate(r.admission_date)} – {fmtDate(r.discharge_date)}</td>
                <td className="text-xs">{r.diagnosis}</td>
                <td className="text-xs">{r.mou_no ?? <span className="text-red-700">none</span>}</td>
                <td>{r.bill_count > 0 ? <Link className="link" href={`/search?q=${encodeURIComponent(r.referral_no)}`}>{r.bill_count}</Link> : 0}</td>
                <td><Badge tone={r.status === 'ACTIVE' ? 'green' : 'grey'}>{r.status}</Badge></td>
              </tr>))}
            </tbody>
          </table></TableWrap>
        )}
      </Card>
    </div>
  );
}
