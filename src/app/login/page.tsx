import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { signIn } from '../auth-actions';
import { ShieldCheck } from 'lucide-react';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-navy-900 p-10 text-white lg:flex">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">Mahanadi Coalfields Limited</div>
          <div className="text-xs text-slate-400">A Subsidiary of Coal India Limited</div>
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight text-white">MCL MEDICAL BILL<br />MANAGEMENT SYSTEM</h1>
          <p className="mt-3 text-lg text-slate-300">Hospital Bill Verification &amp; Reimbursement Portal</p>
          <ul className="mt-8 space-y-2 text-sm text-slate-300">
            <li>• Online bill submission by empanelled hospitals</li>
            <li>• Item-wise verification against CGHS rates</li>
            <li>• 7-day query window with automatic forwarding</li>
            <li>• Transparent reimbursement tracking</li>
          </ul>
        </div>
        <p className="text-xs text-slate-500">Authorised users only. All activity is logged.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <div className="text-xs font-semibold uppercase tracking-widest text-navy-700">Mahanadi Coalfields Limited</div>
            <h1 className="text-lg font-bold">MCL Medical Bill Management System</h1>
          </div>
          <h2 className="text-xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Hospitals, AMOs, Finance and Management users</p>
          <ActionForm action={signIn} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next ?? '/'} />
            <div className="flex flex-col gap-1"><label htmlFor="login">User ID or email</label>
              <input id="login" name="login" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></div>
            <div className="flex flex-col gap-1"><label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
          </ActionForm>
          <div className="mt-4 flex items-center justify-between text-sm">
            <Link href="/auth/reset" className="link">Forgot password?</Link>
            <span className="flex items-center gap-1 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Secure session</span>
          </div>
        </div>
      </section>
    </main>
  );
}
