import 'server-only';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabase/server';

/**
 * Email outbox. The database writes a notification row for EACH party of a bill
 * movement (who raised it and to whom it was raised) in the same transaction as
 * the change; this sends any PENDING rows. It runs right after every workflow
 * action (next/server `after`) and from the /api/cron route.
 *
 * Recipient = the user's "notification email" (Admin → Users), else login email.
 */
type Details = {
  reference?: string; event?: string; referral?: string | null; hospital?: string | null; hospital_bill_no?: string | null;
  amo?: string | null; area?: string | null; raised_by?: string | null; raised_by_party?: string | null; raised_to?: string | null;
  amount?: number | string | null; note?: string | null; at?: string; your_side?: 'raised_by' | 'raised_to';
};
type Row = {
  id: string; title: string; body: string | null; link: string | null; details: Details | null;
  users: { email: string; notify_email: string | null; full_name: string } | { email: string; notify_email: string | null; full_name: string }[] | null;
};

// addresses that can never receive mail (demo / reserved domains)
const UNDELIVERABLE = /@([^@]+\.)?(example|invalid|test|localhost)(\.[a-z]+)?$/i;

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (v: unknown) =>
  v === null || v === undefined || v === '' ? '' : 'Rs ' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ist = (v?: string) =>
  v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST' : '';

/** Builds the subject, plain-text and HTML versions of one notification email. */
export function renderEmail(n: Pick<Row, 'title' | 'body' | 'link' | 'details'>, recipientName: string, baseUrl: string) {
  const d = n.details ?? {};
  const url = baseUrl + (n.link ?? '/');
  const subject = d.reference ? `[${d.reference}] ${d.event ?? n.title}` : n.title;
  const intro = d.your_side === 'raised_by'
    ? 'This is a copy for your records: your office has raised the action below.'
    : d.your_side === 'raised_to'
      ? 'The action below has been raised to your office.'
      : 'Please note the update below.';
  const rows: [string, string][] = ([
    ['Reference number', d.reference ?? ''],
    ['Update', d.event ?? n.title],
    ['Raised by', [d.raised_by_party,
      d.raised_by && !(d.raised_by_party ?? '').startsWith(d.raised_by) ? `- by ${d.raised_by}` : ''].filter(Boolean).join(' ')],
    ['Raised to', d.raised_to ?? ''],
    ['Hospital', [d.hospital, d.hospital_bill_no ? `bill no. ${d.hospital_bill_no}` : ''].filter(Boolean).join(', ')],
    ['AMO / Area', [d.amo, d.area].filter(Boolean).join(', ')],
    ['Referral ID', d.referral ?? ''],
    ['Amount', money(d.amount)],
    ['Details', d.note ?? (d.reference ? '' : n.body ?? '')],
    ['Date & time', ist(d.at)],
  ] as [string, string][]).filter(([, v]) => v);

  const text = [
    `Dear ${recipientName},`, '', intro, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    `Open in the portal: ${url}`, '',
    '- MCL Medical Bill Management System (automated message - please do not reply)',
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
<tr><td style="background:#0f1f45;color:#ffffff;padding:16px 20px">
  <div style="font-size:11px;letter-spacing:2px;color:#7dd3fc;font-weight:600">MAHANADI COALFIELDS LIMITED</div>
  <div style="font-size:16px;font-weight:700;margin-top:2px">MCL Medical Bill Management System</div>
</td></tr>
<tr><td style="padding:20px">
  <p style="margin:0 0 8px">Dear ${esc(recipientName)},</p>
  <p style="margin:0 0 16px;color:#334155">${esc(intro)}</p>
  ${d.reference ? `<div style="background:#e6ecf8;border-radius:6px;padding:10px 14px;margin-bottom:16px"><div style="font-size:11px;color:#475569">REFERENCE NUMBER</div><div style="font-size:20px;font-weight:700;color:#0f1f45;font-family:Consolas,monospace">${esc(d.reference)}</div></div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    ${rows.filter(([k]) => k !== 'Reference number').map(([k, v]) => `<tr><td style="padding:7px 10px 7px 0;color:#64748b;white-space:nowrap;vertical-align:top;border-top:1px solid #f1f5f9">${esc(k)}</td><td style="padding:7px 0;border-top:1px solid #f1f5f9;font-weight:${k === 'Update' ? 700 : 400}">${esc(v)}</td></tr>`).join('')}
  </table>
  <p style="margin:20px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#16295a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Open in the portal</a></p>
</td></tr>
<tr><td style="padding:12px 20px;background:#f8fafc;color:#94a3b8;font-size:12px">Automated message from the MCL Medical Bill Management System. Please do not reply to this email.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

export async function flushEmails(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const res = { sent: 0, failed: 0, skipped: 0 };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res;
  const db = supabaseAdmin();
  const { data } = await db.from('notifications')
    .select('id,title,body,link,details,users(email,notify_email,full_name)').eq('email_status', 'PENDING')
    .order('created_at').limit(limit);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return res;

  const skip = async (ids: string[], why: string) => {
    if (!ids.length) return;
    await db.from('notifications').update({ email_status: 'SKIPPED', email_error: why }).in('id', ids);
    res.skipped += ids.length;
  };

  const provider = process.env.EMAIL_PROVIDER ?? 'none';
  if (provider === 'none' || !process.env.SMTP_HOST) {
    await skip(rows.map((r) => r.id), 'Email not configured');
    return res;
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  const from = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `MCL Medical Bills <${process.env.SMTP_USER}>` : undefined);
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '');

  for (const n of rows) {
    const u = Array.isArray(n.users) ? n.users[0] : n.users;
    const to = (u?.notify_email || u?.email || '').trim();
    if (!to || UNDELIVERABLE.test(to)) { await skip([n.id], 'No deliverable email address'); continue; }
    try {
      const { subject, text, html } = renderEmail(n, u?.full_name ?? 'Sir/Madam', base);
      await transport.sendMail({ from, to, subject, text, html });
      await db.from('notifications').update({ email_status: 'SENT', email_error: null }).eq('id', n.id);
      res.sent++;
    } catch (e) {
      await db.from('notifications').update({ email_status: 'FAILED', email_error: String(e).slice(0, 500) }).eq('id', n.id);
      res.failed++;
    }
  }
  return res;
}
