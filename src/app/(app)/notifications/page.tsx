import Link from 'next/link';
import clsx from 'clsx';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { Card, PageHeader, Empty, Badge } from '@/components/ui';
import { markAllRead } from '../bills/actions';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  await requireUser();
  const sb = await supabaseServer();
  const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(200);
  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return (
    <div>
      <PageHeader title="Notifications" subtitle={`${unread} unread · in-app and email history`}
        actions={unread ? <form action={markAllRead}><button className="btn">Mark all as read</button></form> : undefined} />
      <Card bodyClass="p-0">
        {!data?.length ? <div className="p-4"><Empty>No notifications yet.</Empty></div> : (
          <ul className="divide-y divide-slate-100">
            {data.map((n) => (
              <li key={n.id} className={clsx('flex flex-wrap items-start justify-between gap-2 px-4 py-3', !n.read_at && 'bg-navy-50')}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-600" />}{n.title}</div>
                  <div className="text-sm text-slate-600">{n.body}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{fmtDateTime(n.created_at)} · email {n.email_status.toLowerCase()}</div>
                </div>
                <div className="flex items-center gap-2"><Badge>{n.event.replaceAll('_', ' ').toLowerCase()}</Badge>{n.link && <Link className="link text-sm" href={n.link.replace(/^\/(amo|hospital|finance)\/bills\//, '/bills/')}>Open</Link>}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
