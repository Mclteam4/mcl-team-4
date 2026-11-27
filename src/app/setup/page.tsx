import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Shown only while the deployment has no Supabase configuration. */
export default function SetupPage() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect('/login');
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-xl p-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-navy-700">Mahanadi Coalfields Limited</div>
        <h1 className="mt-1 text-xl font-bold">MCL Medical Bill Management System</h1>
        <p className="mt-1 text-sm text-slate-500">Hospital Bill Verification &amp; Reimbursement Portal</p>
        <div className="mt-5 rounded-md bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/30">
          <p className="font-semibold">Database connection not configured</p>
          <p className="mt-1">Set these environment variables in the hosting project (Vercel → Settings → Environment Variables) and redeploy:</p>
          <ul className="mt-2 list-disc pl-5 font-mono text-xs">
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
            <li>SUPABASE_SERVICE_ROLE_KEY</li>
            <li>CRON_SECRET</li>
          </ul>
          <p className="mt-2">Then run the SQL migrations in <span className="font-mono">supabase/migrations</span>. See the README for full steps.</p>
        </div>
      </div>
    </main>
  );
}
