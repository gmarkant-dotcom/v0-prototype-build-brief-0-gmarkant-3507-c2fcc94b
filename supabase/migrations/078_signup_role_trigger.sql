-- =====================================================================
-- Migration 078: handle_new_user() records the role the user chose,
--                pins search_path, and stops granting access at signup.
--
-- AUTHORED, NOT APPLIED. Greg runs this in the Supabase SQL Editor.
--
-- NUMBERING NOTE
-- An earlier note reserved 078 for the Organizations M1 migration. That
-- reservation is superseded: 078 is this trigger fix, and Organizations M1
-- takes 079. docs/schema-truth.md section 2 records the change. This file
-- replaces docs/proposed-migration-role-trigger.sql, which was deliberately
-- unnumbered and has been deleted so there is one copy, not two.
--
-- ---------------------------------------------------------------------
-- THE LIVE FUNCTION, CONFIRMED
-- ---------------------------------------------------------------------
-- Appendix query A8 (docs/organizations-m1-discovery.md) has now been run
-- against production. The diagnosis is no longer inferred from the shape of
-- the data. The live public.handle_new_user is:
--
--   * SECURITY DEFINER, with proconfig NULL - no search_path pin at all;
--   * its INSERT hardcodes role = 'agency', active_role = 'agency',
--     secondary_role = 'partner' for every signup;
--   * it hardcodes is_paid = TRUE for every signup;
--   * it sets is_admin by a literal comparison of NEW.email against the
--     string 'greg@withligament.com';
--   * it never reads raw_user_meta_data->>'role', which is where the signup
--     form puts the role the person actually selected.
--
-- Measured read-only against production on 2026-08-17 (GoTrue admin API
-- joined to public.profiles): 15 accounts exist, 7 of them chose 'partner' at
-- signup and carry role='agency'. Four are still sitting in the lead agency
-- portal. Full table in docs/m1-prework-report.md, Item 1.
--
-- ---------------------------------------------------------------------
-- WHAT THIS FILE CHANGES ABOUT IT
-- ---------------------------------------------------------------------
-- 1. Pins SET search_path = public, pg_temp. A SECURITY DEFINER function
--    with proconfig NULL resolves unqualified names against the caller's
--    search_path.
-- 2. Reads raw_user_meta_data->>'role' and writes it to role and
--    active_role. Anything that is not exactly 'partner' falls back to
--    'agency', so a malformed or absent value behaves as it does today.
-- 3. Derives secondary_role as the OPPOSITE of the chosen role, instead of
--    the unconditional literal 'partner'.
-- 4. Removes is_paid, is_admin and demo_access from the INSERT entirely.
--    All three are boolean columns that default to FALSE, so new signups
--    land unpaid, non-admin, without demo access. Both hardcoded
--    greg@withligament.com comparisons leave the database with this file.
--    Access is granted from the admin panel, per account, deliberately.
-- 5. Removes email_verified, which DOES NOT EXIST on public.profiles. This
--    is the bug that would have aborted the previous draft of this file on
--    execution. See the column check below.
--
-- ---------------------------------------------------------------------
-- NEW SIGNUPS LAND UNPAID, AND THE NOTIFICATION IS WHAT SURFACES THEM
-- ---------------------------------------------------------------------
-- After this file runs, a new account has is_paid = FALSE and cannot reach
-- paid surfaces until Greg grants access. The only thing that tells anyone a
-- new account is waiting is the signup notification email sent by
-- app/api/admin/notify-new-user.
--
-- That notification was SILENTLY DEAD from 2025-07-28 until 2026-08-17.
-- Commit 241cc40 added a shared-secret gate to the route on 2025-07-28, but
-- the WEBHOOK_SECRET environment variable was never created in Vercel, so
-- the route returned 401 to the Supabase database webhook on every signup
-- and no email was ever sent. The secret has now been set on both sides,
-- rotated, and proven working by curl in both directions.
--
-- This is why landing unpaid is safe now and was not before. Do not apply
-- this migration to an environment where that notification is not confirmed
-- working: unpaid accounts would arrive with nothing to announce them.
--
-- ---------------------------------------------------------------------
-- FORWARD BEHAVIOUR ONLY. NOTHING HERE IS RETROACTIVE.
-- ---------------------------------------------------------------------
-- This file changes what happens at the NEXT signup and nothing else. The
-- fifteen accounts that already exist keep whatever is_paid, is_admin and
-- demo_access values they have today. Removing is_paid = TRUE from the
-- INSERT does not un-pay anybody, and removing the is_admin comparison does
-- not demote anybody.
--
-- It also does not backfill any existing role. Forward behaviour and
-- historical data are two separate decisions and the second one is Greg's,
-- per account. The per-account UPDATE statements, each with a
-- before-and-after read-only SELECT, are in docs/m1-prework-report.md,
-- Item 1.
--
-- ---------------------------------------------------------------------
-- EVERY COLUMN IN THE INSERT WAS CHECKED AGAINST THE LIVE DATABASE
-- ---------------------------------------------------------------------
-- The previous draft of this file failed precisely because a column was
-- assumed rather than checked. Run this before applying, and confirm seven
-- rows come back and that email_verified is absent:
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles'
--     AND column_name IN (
--       'id','email','full_name','company_name',
--       'role','active_role','secondary_role','email_verified'
--     )
--   ORDER BY column_name;
--
-- Executed check already performed, 2026-08-17, read-only against the live
-- database: each column below was resolved by the Postgres planner through
-- a zero-row SELECT. id, email, full_name, company_name, role, active_role,
-- secondary_role, is_paid, is_admin, demo_access and company_website all
-- resolved. email_verified returned SQLSTATE 42703, "column
-- profiles.email_verified does not exist". Output in
-- docs/078-amendment-note.md.
--
-- ---------------------------------------------------------------------
-- WHAT IT DELIBERATELY KEEPS
-- ---------------------------------------------------------------------
-- secondary_role is still granted, as 056 intended - but as the OPPOSITE of
-- the chosen role rather than always 'partner'. A vendor-primary account whose
-- secondary_role is also 'partner' can never reach the other portal at all,
-- because POST /api/profile/switch-role tests
-- `role = 'agency' OR secondary_role = 'agency' OR is_admin`.
--
-- That test also means secondary_role='agency' on a vendor signup grants the
-- lead agency portal for free. This file writes it anyway, because that is
-- exactly the access every signup already has today (056 writes role='agency'
-- to everyone, which satisfies the same test through the first clause). Closing
-- that door is a billing decision, it belongs with the Organizations work in
-- 079 where entitlement moves onto the organization, and doing it here would
-- silently change what a plan includes.
--
-- The ON CONFLICT (id) DO UPDATE clause is kept exactly as 056 had it, with
-- the three role columns deliberately omitted from the update list.
--
-- This is CREATE OR REPLACE: it overwrites whatever is actually there.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- The role the person actually selected on the signup form. Anything that is
  -- not exactly 'partner' or 'agency' falls back to 'agency', so a malformed or
  -- absent value behaves exactly as it does today.
  chosen_role text;
  other_role  text;
BEGIN
  chosen_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'partner' THEN 'partner'
    ELSE 'agency'
  END;

  other_role := CASE WHEN chosen_role = 'partner' THEN 'agency' ELSE 'partner' END;

  -- is_paid, is_admin and demo_access are deliberately absent from this column
  -- list. All three are boolean columns defaulting to FALSE, which is the ruled
  -- behaviour: a new signup lands unpaid, non-admin, without demo access, and
  -- Greg grants access from the admin panel. No email address is compared
  -- anywhere in this function.
  INSERT INTO public.profiles (
    id, email, full_name, company_name,
    role, active_role, secondary_role
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    chosen_role,
    chosen_role,
    other_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email        = EXCLUDED.email,
    full_name    = COALESCE(EXCLUDED.full_name, profiles.full_name),
    company_name = COALESCE(EXCLUDED.company_name, profiles.company_name);
    -- role/active_role/secondary_role are deliberately absent from the DO
    -- UPDATE list, exactly as in 056: a re-fired trigger on an existing profile
    -- must never rewrite a role the user has since changed.

  RETURN NEW;
END;
$$;

-- No backfill in this file. See the header.

-- ---------------------------------------------------------------------
-- VERIFICATION, after running the above. Read-only, safe to re-run.
-- ---------------------------------------------------------------------
-- 1. The function now pins search_path, reads the chosen role, and contains
--    no email literal. Expect proconfig = {search_path=public, pg_temp},
--    not null, and no occurrence of 'greg@withligament.com' or 'is_paid'
--    in the definition:
--
--   SELECT p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
--
-- 2. The trigger is still attached. CREATE OR REPLACE FUNCTION does not touch
--    the trigger, but confirm rather than assume:
--
--   SELECT tgname, tgrelid::regclass, tgenabled
--   FROM pg_trigger
--   WHERE NOT tgisinternal
--     AND tgfoid = 'public.handle_new_user'::regproc;
--
-- 3. Then create one throwaway account choosing "vendor" on the signup form and
--    confirm the new profile row reads role='partner', active_role='partner',
--    secondary_role='agency', and is_paid=false:
--
--   SELECT email, role, active_role, secondary_role, is_paid, is_admin,
--          demo_access, created_at
--   FROM public.profiles
--   ORDER BY created_at DESC
--   LIMIT 3;
--
-- 4. Confirm the signup notification email for that throwaway account arrived,
--    naming it. If it did not, the account is invisible and unpaid - fix the
--    notification before any further signups.
