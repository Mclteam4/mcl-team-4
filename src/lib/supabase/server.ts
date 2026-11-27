import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = () => Boolean(url() && anon());

/** Per-request client acting as the signed-in user — RLS always applies. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(url(), anon(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* called from a Server Component: the proxy refreshes the session instead */ }
      },
    },
  });
}

/**
 * Service-role client — bypasses RLS. Use ONLY after the caller's identity and
 * authority have been verified, and only for: running the verification engine
 * (rpc_create_round), creating auth users, the email outbox and scheduled jobs.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
