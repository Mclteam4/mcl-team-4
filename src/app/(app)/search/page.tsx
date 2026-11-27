import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { Card, PageHeader, TableWrap, Empty } from '@/components/ui';
import { BillTable } from '@/components/BillTable';

export const metadata = { title: 'Search & track' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = '' } = await searchParams;
  const term = q.trim().toLowerCase().replace(/[%_]/g, '');
  const sb = await supabaseServer();
  const [bills, refs] = term.length >= 2 ? await Promise.all([
    sb.from('bill_overview').select('*').ilike('search_text', `%${term}%`).order('updated_at', { ascending: false }).limit(100),
    user.role === 'finance' ? Promise.resolve({ data: [] as Record<string, string>[] })
      : sb.from('referral_overview').select('*').ilike('search_text', `%${term}%`).order('referral_date', { ascending: false }).limit(50),
  ]) : [{ data: [] }, { data: [] }];

  return (
    <div className="space-y-5">
      <PageHeader title="Search & track" subtitle="Bill ID, referral ID, patient name, employee ID, hospital, AMO or SAP document number" />
      <form><input name="q" defaultValue={q} autoFocus placeholder="e.g. MCL/BILL/2026/000001, MCL/2020/001, Rajesh, 5100001234" className="w-full max-w-2xl text-base" /></form>
      {term.length >= 2 && (<>
        <Card title={`Bills (${bills.data?.length ?? 0})`}><BillTable bills={bills.data ?? []} show={['hospital', 'amo', 'finance']} /></Card>
        {user.role !== 'finance' && (
          <Card title={`Referrals (${refs.data?.length ?? 0})`}>
            {!refs.data?.length ? <Empty>No referrals match.</Empty> : (
              <TableWrap><table>
                <thead><tr><th>Referral</th><th>Patient</th><th>Employee</th><th>Hospital</th><th>AMO</th><th>Date</th><th>Bills</th></tr></thead>
                <tbody>{refs.data.map((r: Record<string, string>) => (
                  <tr key={r.id}><td className="font-medium">{r.referral_no}</td><td>{r.patient_name}</td><td>{r.employee_code}</td>
                    <td>{r.hospital_name}</td><td>{r.amo_name}</td><td>{fmtDate(r.referral_date)}</td><td>{r.bill_count}</td></tr>))}
                </tbody>
              </table></TableWrap>
            )}
          </Card>
        )}
      </>)}
      {term.length > 0 && term.length < 2 && <p className="text-sm text-slate-500">Type at least 2 characters.</p>}
      <p className="text-xs text-slate-400">Results only include records you are authorised to see. Open a bill to view its complete movement timeline. <Link href="/" className="link">Back to dashboard</Link></p>
    </div>
  );
}
