-- =============================================================================
-- 0006 Privileges for the server-side service role (Next.js server, seed script,
-- email outbox, cron). Newer Supabase projects no longer grant these by default.
-- service_role already bypasses RLS; it is never exposed to browsers.
-- =============================================================================
grant usage on schema public, app to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
