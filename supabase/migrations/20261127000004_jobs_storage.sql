-- =============================================================================
-- 0004 Server-side scheduled jobs (pg_cron) and private document storage
-- =============================================================================

-- pg_cron is available on Supabase (Dashboard → Database → Extensions → pg_cron)
create extension if not exists pg_cron;

-- Deemed acceptance + forwarding to Finance: every 15 minutes. Idempotent.
select cron.schedule('mcl-forward-expired-bills', '*/15 * * * *', $$select public.job_forward_expired_bills()$$);
-- Deadline reminders (48 h and 24 h before): every 30 minutes, each sent once per round.
select cron.schedule('mcl-deadline-reminders', '*/30 * * * *', $$select public.job_send_deadline_reminders()$$);

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mcl-documents', 'mcl-documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Object path convention: bills/<bill_id>/<uuid>-<filename> | referrals/<referral_id>/... | rates/<version_id>/...
create policy "mcl docs read" on storage.objects for select to authenticated using (
  bucket_id = 'mcl-documents' and (
    ((storage.foldername(name))[1] = 'bills' and app.can_read_bill(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1] = 'referrals' and app.can_read_referral(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1] = 'rates' and app.has_role('admin'))));

create policy "mcl docs upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'mcl-documents' and (
    ((storage.foldername(name))[1] = 'bills' and app.can_read_bill(((storage.foldername(name))[2])::uuid)
       and app.has_role('hospital', 'amo', 'admin'))
    or ((storage.foldername(name))[1] = 'referrals' and app.can_read_referral(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1] = 'rates' and app.has_role('admin'))));
-- no update/delete policies: uploaded evidence is immutable
