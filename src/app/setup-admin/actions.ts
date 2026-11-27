'use server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { redirect } from 'next/navigation';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';
import type { ActionResult } from '@/components/ActionForm';

const CODE_KEY = 'bootstrap_code_sha256';

/**
 * One-time creation of the FIRST administrator. Works only while no active admin
 * exists AND a one-time setup code (stored only as a SHA-256 hash) is present.
 * The code is deleted before the account is created, so it can never be reused.
 * The person filling the form chooses the password; it is never stored in plain text.
 */
export async function createFirstAdmin(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const code = s('setup_code').toUpperCase();
  const loginId = s('login_id').toLowerCase();
  const fullName = s('full_name') || 'Administrator';
  const email = s('email').toLowerCase();
  const password = String(fd.get('password') ?? '');

  if (!code) return { error: 'Enter the one-time setup code.' };
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(loginId)) return { error: 'User ID: 3–40 lowercase letters or numbers (dot, dash, underscore allowed).' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address (used if you forget the password).' };
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return { error: 'Password: at least 10 characters with both letters and numbers.' };
  if (password !== String(fd.get('confirm') ?? '')) return { error: 'The two passwords do not match.' };

  const db = supabaseAdmin();
  const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true);
  if ((count ?? 0) > 0) return { error: 'Setup is already complete. Please sign in.' };

  const { data: setting } = await db.from('system_settings').select('value').eq('key', CODE_KEY).maybeSingle();
  const expected = typeof setting?.value === 'string' ? setting.value : null;
  if (!expected) return { error: 'Setup is closed.' };
  const got = createHash('sha256').update(code).digest('hex');
  if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return { error: 'The setup code is not correct.' };
  }

  // consume the code first (single use, prevents a second simultaneous setup)
  const { data: consumed } = await db.from('system_settings').delete().eq('key', CODE_KEY).select('key');
  if (!consumed?.length) return { error: 'Setup is closed.' };
  const restore = () => db.from('system_settings').insert({ key: CODE_KEY, value: expected, description: 'One-time first-admin setup code (deleted after use)' });

  const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created?.user) { await restore(); return { error: `Could not create the account: ${error?.message ?? 'unknown error'}` }; }

  const { error: profileError } = await db.from('users').insert({
    id: created.user.id, email, full_name: fullName, role: 'admin', login_id: loginId, designation: 'System Administrator',
  });
  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id);
    await restore();
    return { error: profileError.code === '23505' ? 'That user ID or email is already in use.' : profileError.message };
  }
  await db.from('audit_logs').insert({
    actor_label: `${fullName} (first-time setup)`, entity: 'users', entity_id: created.user.id,
    action: 'FIRST_ADMIN_CREATED', new_data: { login_id: loginId },
  });

  const sb = await supabaseServer();
  await sb.auth.signInWithPassword({ email, password });
  redirect('/admin');
}
