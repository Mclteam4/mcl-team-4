'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import type { ActionResult } from '@/components/ActionForm';

const safeNext = (n: unknown) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export async function signIn(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ email: z.email(), password: z.string().min(1) }).safeParse({
    email: String(fd.get('email') ?? '').trim().toLowerCase(), password: fd.get('password'),
  });
  if (!parsed.success) return { error: 'Enter a valid email address and password.' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'Invalid email or password.' }; // do not reveal which one
  const { data: { user } } = await sb.auth.getUser();
  const { data: profile } = await sb.from('users').select('active').eq('id', user!.id).maybeSingle();
  if (!profile?.active) { await sb.auth.signOut(); return { error: 'This account is not active. Contact the MCL administrator.' }; }
  redirect(safeNext(fd.get('next')));
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}

export async function requestPasswordReset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  if (!z.email().safeParse(email).success) return { error: 'Enter a valid email address.' };
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const sb = await supabaseServer();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/update-password` });
  return { ok: 'If an account exists for this email, a reset link has been sent.' };
}

export async function updatePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const pw = String(fd.get('password') ?? '');
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return { error: 'Use at least 10 characters with letters and numbers.' };
  if (pw !== fd.get('confirm')) return { error: 'Passwords do not match.' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  redirect('/');
}
