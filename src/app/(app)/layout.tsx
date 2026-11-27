import { requireUser, ROLE_LABEL } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { signOut } from '../auth-actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sb = await supabaseServer();
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return (
    <div className="min-h-screen">
      <Sidebar role={user.role} name={user.full_name} roleLabel={ROLE_LABEL[user.role]} unread={count ?? 0} signOut={signOut} />
      <main className="px-4 py-6 lg:ml-64 lg:px-8">{children}</main>
    </div>
  );
}
