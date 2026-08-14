-- =====================================================================
-- PROPOSED MIGRATION - DELIBERATELY UNNUMBERED. DO NOT RUN YET.
--
-- WHY THERE IS NO NUMBER ON THIS FILE
-- 078 is the next unused migration number and is reserved for the
-- Organizations M1 migration (docs/schema-truth.md section 2). Numbering
-- this file now would claim 078 and collide with that work. Give it a
-- number at the moment it is scheduled, not before, and move it into
-- supabase/migrations/ at the same time.
--
-- WHAT IT FIXES
-- handle_new_user() hardcodes role='agency', active_role='agency' for every
-- signup and never reads the role the person actually chose, which the
-- signup form puts in raw_user_meta_data->>'role'. Migration 056 introduced
-- this when it replaced the function to grant dual-role access by default.
--
-- Measured read-only against production on 2026-08-14, via the GoTrue admin
-- API joined to profiles: 7 of 14 accounts chose 'partner' at signup and are
-- stored as role='agency'. Four of those seven are still sitting in the
-- agency portal (active_role='agency') despite having signed up as vendors:
--   mariannafayn@gmail.com, victoriacaro91@gmail.com,
--   andrea@crescestudio.com, marcusliwag@gmail.com
-- The other three later flipped active_role to 'partner' by hand
--   gmarkant+partner23@gmail.com, info@ceoofgeo.com,
--   gmarkant+partner70@gmail.com
--
-- It also adds the missing `SET search_path`. The function is SECURITY
-- DEFINER and currently runs with whatever search_path the caller has, which
-- is a privilege-escalation surface. The function is being rewritten anyway,
-- so this costs nothing to fix here.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- It does NOT backfill any existing role. Forward behaviour and historical
-- data are two separate decisions, and the second one is Greg's per account -
-- some of those seven may have legitimately become lead agencies since
-- signing up. The backfill statements are in
-- docs/schema-truth-and-m1-prep-report.md, one per account, to be run
-- individually after Greg rules on which to touch.
--
-- BEFORE RUNNING THIS
-- The on-disk text of 056 is NOT proof of what the live function contains
-- (docs/schema-truth.md). Run appendix query A8 from
-- docs/organizations-m1-discovery.md first and diff the live body against
-- what this file replaces:
--
--   SELECT p.proname, pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
--
-- If the live body differs from migration 056's, reconcile before replacing:
-- this is CREATE OR REPLACE, so it overwrites whatever is there.
--
-- INTERACTION WITH ORGANIZATIONS M1
-- Judgment call 7.4 in docs/organizations-m1-discovery.md proposes passing an
-- org invite token through raw_user_meta_data so this same trigger can enrol
-- an invited colleague. That change lands in the same function. If M1 is
-- close, do both in one migration rather than replacing this function twice.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- The role the person actually selected on the signup form. Anything that
  -- is not exactly 'partner' or 'agency' falls back to 'agency', so a
  -- malformed or absent value behaves exactly as it does today.
  chosen_role text;
  other_role  text;
BEGIN
  chosen_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'partner' THEN 'partner'
    ELSE 'agency'
  END;

  -- Dual-role access by default is preserved, which was the point of 056 -
  -- but the secondary role is now the OPPOSITE of the chosen one rather than
  -- always 'partner'. A vendor-primary account whose secondary_role is also
  -- 'partner' can never switch portals.
  other_role := CASE WHEN chosen_role = 'partner' THEN 'agency' ELSE 'partner' END;

  INSERT INTO public.profiles (
    id, email, full_name, company_name,
    role, active_role, secondary_role,
    is_paid, is_admin, demo_access, email_verified
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    chosen_role,
    chosen_role,
    other_role,
    true,
    CASE WHEN NEW.email = 'greg@withligament.com' THEN true ELSE false END,
    CASE WHEN NEW.email = 'greg@withligament.com' THEN true ELSE false END,
    COALESCE(NEW.email_confirmed_at IS NOT NULL, false)
  )
  ON CONFLICT (id) DO UPDATE SET
    email        = EXCLUDED.email,
    full_name    = COALESCE(EXCLUDED.full_name, profiles.full_name),
    company_name = COALESCE(EXCLUDED.company_name, profiles.company_name);
    -- role/active_role/secondary_role are deliberately absent from the DO
    -- UPDATE list, exactly as in 056: a re-fired trigger on an existing
    -- profile must never rewrite a role the user has since changed.

  RETURN NEW;
END;
$$;

-- No backfill in this file. See the header.

-- ---------------------------------------------------------------------
-- VERIFICATION, after running the above. Read-only, safe to re-run.
-- ---------------------------------------------------------------------
-- 1. The function now pins search_path and reads the chosen role:
--
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
--
-- 2. The trigger is still attached (CREATE OR REPLACE FUNCTION does not
--    touch the trigger, but confirm rather than assume):
--
--   SELECT tgname, tgrelid::regclass, tgenabled
--   FROM pg_trigger
--   WHERE NOT tgisinternal
--     AND tgfoid = 'public.handle_new_user'::regproc;
--
-- 3. Then create one throwaway account choosing "vendor" on the signup form
--    and confirm the new profile row reads role='partner',
--    active_role='partner', secondary_role='agency'.
