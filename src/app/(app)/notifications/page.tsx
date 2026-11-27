import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { requireUser, ROLE_LABEL, type Role } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDateTime, inr } from '@/lib/format';
import { Card, PageHeader, Empty, Badge, Tabs } from '@/components/ui';
import { markAllRead, markRead } from '../bills/actions';

export const metadata = { title: 'Notifications' };

type Details = {
  reference?: string; event?: string; referral?: string | null; raised_by?: string | null; raised_by_party?: string | null;
  raised_to?: string | null; amount?: number | string | null; note?: string | null; your_side?: 'raised_by' | 'raised_to';
};
type Recipient = { full_name: string; role: Role; login_id: string | null };
type Note = {
  id: string; user_id: string; event: string; title: string; body: string | null; link: string | null; read_at: string | null;
  email_status: string; created_at: string; details: Details | null; users: Recipient | Recipient[] | null;
};

const TABS = ['all', 'to', 'by', 'unread', 'monitor'] as const;
type Tab = (typeof TABS)[number];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === 'admin';
  const sp = await searchParams;
  const allowed: Tab[] = isAdmin ? [...TABS] : ['all', 'to', 'by', 'unread'];
  const tab: Tab = allowed.includes(sp.tab as Tab) ? (sp.tab as Tab) : isAdmin ? 'monitor' : 'all';
  const sb = await supabaseServer();

  const own = () => sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  const [all, to, by, unread, everyone] = await Promise.all([
    own(), own().eq('details->>your_side', 'raised_to'), own().eq('details->>your_side', 'raised_by'), own().is('read_at', null),
    isAdmin ? sb.from('notifications').select('id', { count: 'exact', head: true }) : Promise.resolve({ count: 0 }),
  ]);

  let q = sb.from('notifications').select('*, users(full_name, role, login_id)').order('created_at', { ascending: false }).limit(200);
  if (tab !== 'monitor') q = q.eq('user_id', user.id);
  if (tab === 'to') q = q.eq('details->>your_side', 'raised_to');
  if (tab === 'by') q = q.eq('details->>your_side', 'raised_by');
  if (tab === 'unread') q = q.is('read_at', null);
  const { data } = await q;
  const notes = (data ?? []) as Note[];

  const items = [
    { key: 'all', label: 'All mine', count: all.count ?? 0 },
    { key: 'to', label: 'Raised to me', count: to.count ?? 0 },
    { key: 'by', label: 'Raised by me', count: by.count ?? 0 },
    { key: 'unread', label: 'Unread', count: unread.count ?? 0 },
    ...(isAdmin ? [{ key: 'monitor', label: 'All users (monitor)', count: everyone.count ?? 0 }] : []),
  ].map((t) => ({ ...t, href: `/notifications?tab=${t.key}` }));

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={tab === 'monitor'
          ? 'Every notice sent to every user: both the office that raised each action and the office it was raised to.'
          : 'Every bill movement you raised, and every one raised to you, with its reference number.'}
        actions={(unread.count ?? 0) > 0 ? <form action={markAllRead}><button className="btn">Mark all as read</button></form> : undefined} />
      <Tabs active={tab} items={items} />
      <Card bodyClass="p-0">
        {!notes.length ? (
          <div className="p-4"><Empty>{tab === 'monitor' ? 'No notifications yet.' : 'Nothing here yet. Notices appear when you raise a bill action or one is raised to you.'}</Empty></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notes.map((n) => {
              const d = n.details ?? {};
              const recipient = Array.isArray(n.users) ? n.users[0] : n.users;
              const mine = n.user_id === user.id;
              const extra = [d.amount !== null && d.amount !== undefined ? inr(d.amount) : null, d.note,
                d.referral ? `Referral ${d.referral}` : null].filter(Boolean).join(' · ');
              return (
                <li key={n.id} className={clsx('px-4 py-3', mine && !n.read_at && 'bg-navy-50')}>
                  <div className="flex flex-wrap items-center gap-2">
                    {mine && !n.read_at && <span className="h-2 w-2 rounded-full bg-red-600" aria-label="Unread" />}
                    {d.your_side === 'raised_to' && <Badge tone="blue">{mine ? 'Raised to you' : 'Raised to them'}</Badge>}
                    {d.your_side === 'raised_by' && <Badge tone="green">{mine ? 'You raised' : 'They raised'}</Badge>}
                    {!d.your_side && <Badge tone="yellow">{n.event === 'QUERY_DEADLINE_NEAR' ? 'Reminder' : 'Notice'}</Badge>}
                    {d.reference && n.link
                      ? <Link href={n.link} className="font-mono text-sm font-bold text-navy-800 hover:underline">{d.reference}</Link>
                      : null}
                    <span className="ml-auto text-xs text-slate-400">{fmtDateTime(n.created_at)}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{d.event ?? n.title}</div>
                  {d.raised_by_party ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
                      <span><span className="text-slate-400">From</span> <b className="font-medium text-slate-800">{d.raised_by_party}</b>
                        {d.raised_by && !d.raised_by_party.startsWith(d.raised_by) ? ` (by ${d.raised_by})` : ''}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                      <span><span className="text-slate-400">To</span> <b className="font-medium text-slate-800">{d.raised_to}</b></span>
                    </div>
                  ) : n.body ? <div className="mt-0.5 text-sm text-slate-600">{n.body}</div> : null}
                  {extra && <div className="mt-0.5 text-xs text-slate-500">{extra}</div>}
                  {tab === 'monitor' && recipient && (
                    <div className="mt-0.5 text-xs text-slate-500">
                      Sent to <b>{recipient.full_name}</b> ({ROLE_LABEL[recipient.role] ?? recipient.role}{recipient.login_id ? `, ${recipient.login_id}` : ''})
                      {' · '}email {n.email_status.toLowerCase()}{!n.read_at ? ' · unread' : ''}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-4 text-sm">
                    {n.link && <Link className="link" href={n.link}>Open bill</Link>}
                    {mine && !n.read_at && (
                      <form action={markRead}><input type="hidden" name="id" value={n.id} /><button className="link">Mark as read</button></form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {notes.length === 200 && <p className="mt-2 text-xs text-slate-400">Showing the latest 200.</p>}
    </div>
  );
}
