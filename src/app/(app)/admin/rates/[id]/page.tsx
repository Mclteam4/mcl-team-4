import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { inr, fmtDate } from '@/lib/format';
import { categoryLabel } from '@/lib/status';
import { Card, PageHeader, TableWrap, Badge } from '@/components/ui';

export const metadata = { title: 'Rate schedule' };

export default async function RateVersion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const { q = '', page = '1' } = await searchParams;
  await requireUser('admin', 'amo', 'finance', 'management');
  const sb = await supabaseServer();
  const { data: v } = await sb.from('cghs_rate_versions').select('*').eq('id', id).maybeSingle();
  if (!v) notFound();
  const p = Math.max(1, Number(page) || 1);
  let query = sb.from('cghs_rate_master').select('*', { count: 'exact' }).eq('version_id', id).order('code').range((p - 1) * 100, p * 100 - 1);
  if (q) query = query.or(`code.ilike.%${q.replace(/[%,()]/g, '')}%,name.ilike.%${q.replace(/[%,()]/g, '')}%`);
  const { data: rows, count } = await query;

  return (
    <div className="space-y-4">
      <PageHeader title={`${v.rate_type} · ${v.version_label}`} subtitle={<><Badge tone={v.status === 'ACTIVE' ? 'green' : 'yellow'}>{v.status}</Badge> {v.notification_ref} · effective {fmtDate(v.effective_from)} – {v.effective_to ? fmtDate(v.effective_to) : 'open'} · {count} rates</>} />
      <form><input name="q" defaultValue={q} placeholder="Search code or name" className="w-full max-w-sm" /></form>
      <Card>
        <TableWrap><table>
          <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Specification</th><th>Unit</th><th>City</th><th className="text-right">Base rate</th><th>Pkg days</th></tr></thead>
          <tbody>{rows?.map((r) => (
            <tr key={r.id}><td className="font-mono text-xs">{r.code}</td><td>{r.name}</td><td>{categoryLabel(r.category)}</td><td>{r.specification}</td><td>{r.unit}</td>
              <td className="text-xs">{r.city_class ?? 'All'}</td><td className="text-right tabular-nums">{inr(r.base_rate)}</td><td>{r.package_days ?? ''}</td></tr>))}
          </tbody>
        </table></TableWrap>
      </Card>
      <div className="flex gap-2 text-sm">
        {p > 1 && <a className="btn btn-sm" href={`?q=${encodeURIComponent(q)}&page=${p - 1}`}>Previous</a>}
        {(count ?? 0) > p * 100 && <a className="btn btn-sm" href={`?q=${encodeURIComponent(q)}&page=${p + 1}`}>Next</a>}
      </div>
    </div>
  );
}
