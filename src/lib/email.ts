import 'server-only';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabase/server';

/**
 * Email outbox: notifications are written by the database in the same
 * transaction as the workflow change; this sends any PENDING ones.
 * Called after workflow actions (via next/server `after`) and by the cron route.
 */
export async function flushEmails(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const res = { sent: 0, failed: 0, skipped: 0 };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res;
  const db = supabaseAdmin();
  const { data: rows } = await db.from('notifications')
    .select('id,title,body,link,users(email,full_name)').eq('email_status', 'PENDING')
    .order('created_at').limit(limit);
  if (!rows?.length) return res;

  const provider = process.env.EMAIL_PROVIDER ?? 'none';
  if (provider === 'none' || !process.env.SMTP_HOST) {
    await db.from('notifications').update({ email_status: 'SKIPPED' }).in('id', rows.map((r) => r.id));
    res.skipped = rows.length;
    return res;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  const base = process.env.APP_URL ?? '';
  for (const n of rows) {
    const u = (Array.isArray(n.users) ? n.users[0] : n.users) as { email: string; full_name: string } | null;
    if (!u?.email) { await db.from('notifications').update({ email_status: 'SKIPPED' }).eq('id', n.id); res.skipped++; continue; }
    try {
      await transport.sendMail({
        from: process.env.EMAIL_FROM, to: u.email, subject: `[MCL Medical Bills] ${n.title}`,
        text: `Dear ${u.full_name},\n\n${n.body ?? ''}\n\n${n.link ? `Open: ${base}${n.link}\n\n` : ''}— MCL Medical Bill Management System (automated message)`,
      });
      await db.from('notifications').update({ email_status: 'SENT' }).eq('id', n.id);
      res.sent++;
    } catch (e) {
      await db.from('notifications').update({ email_status: 'FAILED', email_error: String(e).slice(0, 500) }).eq('id', n.id);
      res.failed++;
    }
  }
  return res;
}
