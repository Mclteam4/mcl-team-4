import { redirect } from 'next/navigation';
import { getUser, ROLE_HOME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const u = await getUser();
  redirect(u ? ROLE_HOME[u.role] : '/login');
}
