import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { flushEmails } from '@/lib/email';

/**
 * Backup scheduler + email outbox. The primary 7-day job runs inside Postgres
 * (pg_cron, every 15 min). This endpoint is idempotent, so running it too is safe.
 * Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new NextResponse('Unauthorised', { status: 401 });
  const db = supabaseAdmin();
  const [fwd, rem] = await Promise.all([db.rpc('job_forward_expired_bills'), db.rpc('job_send_deadline_reminders')]);
  const email = await flushEmails(200);
  return NextResponse.json({ forwarded: fwd.data ?? fwd.error?.message, reminders: rem.data ?? rem.error?.message, email });
}
