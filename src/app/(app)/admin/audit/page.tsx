import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { Card, PageHeader, TableWrap } from '@/components/ui';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  await requireUser('admin', 'management');
  const { action = '', page = '1' } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const sb = await supabaseServer();
  let q = sb.from('audit_logs').select('*').order('at', { ascending: false }).range((p - 1) * 100, p * 100 - 1);
  if (action) q = q.ilike('action', `%${action.replace(/[%_]/g, '')}%`);
  const { data } = await q;
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Append-only record of every workflow action, override and master-data change" />
      <form><input name="action" defaultValue={action} placeholder="Filter by action, e.g. OVERRIDE, FINANCE, DEEMED" className="w-full max-w-sm" /></form>
      <Card>
        <TableWrap><table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>{data?.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(a.at)}</td><td className="text-xs">{a.actor_label}</td>
              <td className="text-xs font-semibold">{a.action}</td>
              <td className="text-xs">{a.bill_id ? <Link className="link" href={`/bills/${a.bill_id}`}>{a.entity}</Link> : a.entity}</td>
              <td className="max-w-xl"><code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-600">
                {a.old_data ? `old: ${JSON.stringify(a.old_data).slice(0, 300)}\n` : ''}{a.new_data ? `new: ${JSON.stringify(a.new_data).slice(0, 400)}` : ''}</code></td>
            </tr>))}
          </tbody>
        </table></TableWrap>
      </Card>
      <div className="flex gap-2">
        {p > 1 && <a className="btn btn-sm" href={`?action=${action}&page=${p - 1}`}>Newer</a>}
        {(data?.length ?? 0) === 100 && <a className="btn btn-sm" href={`?action=${action}&page=${p + 1}`}>Older</a>}
      </div>
    </div>
  );
}
