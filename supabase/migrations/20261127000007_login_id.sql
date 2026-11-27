-- =============================================================================
-- 0007 Sign-in by user ID (e.g. "dr.sharma") as well as by email.
-- Supabase Auth still authenticates by email; the server maps a user ID to the
-- email with the service role, so IDs and emails are never exposed to browsers.
-- =============================================================================
alter table public.users add column login_id text;
alter table public.users add constraint users_login_id_format
  check (login_id is null or login_id ~ '^[a-z0-9][a-z0-9._-]{2,39}$');
create unique index users_login_id_key on public.users (login_id) where login_id is not null;

-- admins may set / change user IDs (existing users_admin_upd policy limits this to admins)
grant update (login_id) on public.users to authenticated;
