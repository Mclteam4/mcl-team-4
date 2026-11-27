import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { requestPasswordReset } from '../../auth-actions';

export const metadata = { title: 'Reset password' };

export default function ResetPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Reset password</h1>
        <p className="mt-1 text-sm text-slate-500">We will email you a link to set a new password.</p>
        <ActionForm action={requestPasswordReset} className="mt-4 space-y-3">
          <div className="flex flex-col gap-1"><label>Email</label><input name="email" type="email" required /></div>
          <SubmitButton className="btn-primary w-full">Send reset link</SubmitButton>
        </ActionForm>
        <Link href="/login" className="link mt-4 inline-block text-sm">Back to sign in</Link>
      </div>
    </main>
  );
}
