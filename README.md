# MCL Medical Bill Management System
**Hospital Bill Verification & Reimbursement Portal** — Mahanadi Coalfields Limited

Stack: Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Recharts · Supabase (Postgres, Auth, Storage, RLS, pg_cron) · ExcelJS · Vercel

Design, data model, permission matrix and open business rules: [docs/01-requirements-analysis-and-design.md](docs/01-requirements-analysis-and-design.md)

## What's built

| Role | Screens |
|---|---|
| **Hospital** | Dashboard (action required / with AMO / with Finance / paid), referred patients, create bill against referral, item-wise entry, Excel/CSV import, document upload, submit, review AMO decisions, accept or raise item-wise queries (7-day countdown), Finance clarifications |
| **AMO** | Verification dashboard (new, pending, under review, queries, awaiting hospital, verified, overdue), referrals and new referral, **item-wise CGHS verification screen** (colour-coded, filters, approve-all-green, modify qty/rate, disallow with mandatory remarks, name-match suggestions to confirm), query responses, revision rounds |
| **Finance** | Reimbursement queue by status, scrutiny, sanction with TDS/advance/recovery deductions, voucher and SAP document no., payment completion, return to AMO (medical) or hospital (documents) |
| **Management** | Read-only dashboard: 10 summary cards, 7 charts, filters (FY, calendar year, hospital, area, AMO, status, date range), Excel export |
| **Admin** | Users, AMO delegation, areas, hospitals, MOUs, CGHS & medicine rate uploads with versions and activation, exception referrals, settings (rate factors, room rent, query period), audit log |
| **All** | Global search and tracking, bill timeline, notifications (in-app + email outbox), print/PDF statement, Excel export per bill |

Tests: `npm test` (13 engine tests) · `npm run test:sql` (46 workflow, RLS and security tests on an in-memory Postgres).

## Deploying (Vercel + Supabase)

1. **Supabase**: create a project (region **Mumbai, ap-south-1**). Database → Extensions: enable **pg_cron** and **pg_trgm**.
2. SQL Editor: run the six files in `supabase/migrations/` in order (0001 → 0006).
3. Authentication → URL configuration: set Site URL to the Vercel URL and add `<site>/auth/callback` to the redirect URLs.
4. **Vercel** → Project → Settings → Environment Variables:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (**server only — never expose**) |
   | `CRON_SECRET` | any long random string |
   | `APP_URL` | e.g. `https://mcl-team-4-psi.vercel.app` (links in emails) |
   | `EMAIL_PROVIDER`, `SMTP_*`, `EMAIL_FROM` | optional; without them email is skipped and in-app notifications still work |

5. Redeploy. Until the variables are set, the site shows a "Database connection not configured" page.
6. Demo data (optional): copy `.env.example` to `.env.local`, fill in the same values, then run `npm run seed:demo`. Logins go to `demo-credentials.local.txt`, which is git-ignored.

## Demo walkthrough (master brief §21)

1. **Hospital** (ABC billing desk): open draft bill `ABC/IPD/2026/7781` (₹2,50,000; 20 medicines, 5 investigations, 3 procedures) → **Submit to MCL**.
2. **AMO** (Dr. Sharma): New bills → **Start verification**. The engine flags 6 red items. **Approve all green**, ✓ each red item (restricted to rate), ✗ disallow "Protein supplement powder" with a remark. Admissible = **₹2,10,000** → **Submit to hospital**.
3. **Hospital**: **Raise query** on the PTCA line.
4. **AMO**: respond to the query → **Start revision round** → revise PTCA → submit.
5. **Hospital**: **Accept verified bill**. It moves to Finance automatically.
6. **Finance**: approve the sanction → enter voucher and SAP number → **Mark payment completed**.
7. **Management**: see the bill counted in the dashboards and in the exports.

> Demo rate schedules are labelled `DEMO-…` and are **not official CGHS rates**. Upload the official schedules from Admin → CGHS rate master before real use.

## Local development

```powershell
npm install
copy .env.example .env.local   # then fill values
npm run dev
```

> This PC has Windows Smart App Control enabled, which blocks some unsigned native Node modules. For that reason tests use Node's built-in runner rather than Vitest. Next.js and Tailwind are not affected.

## Important rules built into the database

- A bill requires a valid referral; the referring AMO (or an active delegate) receives it automatically.
- Hospitals see only their own referrals and bills. AMOs see only their own patients.
- Bill status changes only through workflow functions. Nobody can `UPDATE status` directly.
- The matched CGHS rate is written only by the server engine. AMOs can edit only decision columns.
- Remarks are mandatory for every disallowance and every modification. Grey and yellow items can't be approved without a remark.
- Submitted verification rounds are immutable. Each query cycle creates a new round.
- Forwarding to Finance is idempotent (`UNIQUE(bill_id)` plus a status guard). The 7-day deemed acceptance runs in pg_cron every 15 minutes; the Vercel cron is a daily backup.
- Finance can't exceed the medically admissible amount or change AMO decisions.
- The audit log is append-only. CGHS rates and rule factors are admin-controlled data, never constants in code.
