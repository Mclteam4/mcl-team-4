import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { updatePassword } from '../../auth-actions';

export const metadata = { title: 'Set new password' };

export default function UpdatePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <ActionForm action={updatePassword} className="mt-4 space-y-3">
          <div className="flex flex-col gap-1"><label>New password</label><input name="password" type="password" autoComplete="new-password" required minLength={10} /></div>
          <div className="flex flex-col gap-1"><label>Confirm password</label><input name="confirm" type="password" autoComplete="new-password" required /></div>
          <SubmitButton className="btn-primary w-full">Save password</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
