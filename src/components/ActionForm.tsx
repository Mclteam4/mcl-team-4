'use client';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import clsx from 'clsx';

export type ActionResult = { error?: string; ok?: string } | null;
export type FormAction = (prev: ActionResult, data: FormData) => Promise<ActionResult>;

/** Form bound to a server action; shows the action's error / success message. */
export function ActionForm({ action, children, className, resetOnSuccess, confirm }: {
  action: FormAction; children: ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      {state?.error && <p role="alert" className="mt-2 rounded bg-red-50 px-2 py-1.5 text-sm text-red-800">{state.error}</p>}
      {state?.ok && <p className="mt-2 rounded bg-green-50 px-2 py-1.5 text-sm text-green-800">{state.ok}</p>}
    </form>
  );
}

export function SubmitButton({ children, className, name, value }: { children: ReactNode; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={clsx('btn', className)}>
      {pending ? 'Please wait…' : children}
    </button>
  );
}
