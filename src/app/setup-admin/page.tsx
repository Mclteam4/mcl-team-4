import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/server';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { createFirstAdmin } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'First-time setup' };

async function setupOpen(): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const [{ count }, { data }] = await Promise.all([
      db.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true),
      db.from('system_settings').select('key').eq('key', 'bootstrap_code_sha256').maybeSingle(),
    ]);
    return (count ?? 0) === 0 && !!data;
  } catch {
    return false;
  }
}

export default async function SetupAdminPage() {
  const open = await setupOpen();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-navy-700">Mahanadi Coalfields Limited</div>
        <h1 className="mt-1 text-lg font-bold">Create the first administrator</h1>
        {!open ? (
          <>
            <p className="mt-2 text-sm text-slate-600">Setup is already complete or closed. Administrators create all other users from inside the portal.</p>
            <Link href="/login" className="btn btn-primary mt-4">Go to sign in</Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">One-time setup. This page locks itself after the first administrator is created.</p>
            <ActionForm action={createFirstAdmin} className="mt-4 space-y-3">
              <div className="flex flex-col gap-1"><label htmlFor="setup_code">One-time setup code</label>
                <input id="setup_code" name="setup_code" required autoComplete="off" autoCapitalize="characters" placeholder="MCL-XXXX-XXXX-XXXX" /></div>
              <div className="flex flex-col gap-1"><label htmlFor="login_id">User ID (used to sign in)</label>
                <input id="login_id" name="login_id" required defaultValue="admin" autoCapitalize="none" /></div>
              <div className="flex flex-col gap-1"><label htmlFor="full_name">Your name</label>
                <input id="full_name" name="full_name" defaultValue="Administrator" /></div>
              <div className="flex flex-col gap-1"><label htmlFor="email">Email (for password reset)</label>
                <input id="email" name="email" type="email" required autoComplete="email" /></div>
              <div className="flex flex-col gap-1"><label htmlFor="password">Choose a password</label>
                <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
                <span className="text-xs text-slate-400">At least 10 characters, with letters and numbers</span></div>
              <div className="flex flex-col gap-1"><label htmlFor="confirm">Type the password again</label>
                <input id="confirm" name="confirm" type="password" required autoComplete="new-password" /></div>
              <SubmitButton className="btn-primary w-full">Create administrator and sign in</SubmitButton>
            </ActionForm>
          </>
        )}
      </div>
    </main>
  );
}
