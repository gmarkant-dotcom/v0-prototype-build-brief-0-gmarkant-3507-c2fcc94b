-- =====================================================================
-- Migration 078: handle_new_user() records the role the user chose,
--                and pins search_path.
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
-- WHAT IT FIXES
-- Migration 056 rewrote handle_new_user() to hardcode role='agency',
-- active_role='agency', secondary_role='partner' for every signup. It never
-- reads raw_user_meta_data->>'role', which is where the signup form puts the
-- role the person actually selected. It also dropped the SET search_path that
-- a SECURITY DEFINER function needs.
--
-- Measured read-only against production on 2026-08-17 (GoTrue admin API
-- joined to public.profiles): 15 accounts exist, 7 of them chose 'partner' at
-- signup and carry role='agency'. Four are still sitting in the lead agency
-- portal. Full table in docs/m1-prework-report.md, Item 1.
--
-- STATUS OF THE DIAGNOSIS: the live function body has NOT been read.
-- Appendix query A8 (docs/organizations-m1-discovery.md) has never been run,
-- and this run could not run it - PostgREST cannot reach pg_proc and no
-- SQL-exec RPC is exposed. Everything above is therefore inferred from the
-- shape of the data, strongly but indirectly:
--
--   * every profile created after 056 carries secondary_role='partner',
--     including the two whose role is 'partner' - which is 056's unconditional
--     write, not a value any other code path produces;
--   * the one pre-056 partner account (gmarkant@icloud.com, 2026-03-26)
--     carries secondary_role='agency', the 047-era shape.
--
-- RUN A8 FIRST AND DIFF THE RESULT AGAINST WHAT THIS FILE REPLACES. This is
-- CREATE OR REPLACE: it overwrites whatever is actually there.
--
--   SELECT p.proname,
--          p.prosecdef AS security_definer,
--          p.proconfig AS config_settings,
--          pg_get_functiondef(p.oid) AS definition
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- It does not backfill any existing role. Forward behaviour and historical
-- data are two separate decisions and the second one is Greg's, per account.
-- The per-account UPDATE statements, each with a before-and-after read-only
-- SELECT, are in docs/m1-prework-report.md, Item 1.
--
-- WHAT IT DELIBERATELY KEEPS
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
    -- UPDATE list, exactly as in 056: a re-fired trigger on an existing profile
    -- must never rewrite a role the user has since changed.

  RETURN NEW;
END;
$$;

-- No backfill in this file. See the header.

-- ---------------------------------------------------------------------
-- VERIFICATION, after running the above. Read-only, safe to re-run.
-- ---------------------------------------------------------------------
-- 1. The function now pins search_path and reads the chosen role.
--    Expect proconfig = {search_path=public, pg_temp}, not null:
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
--    secondary_role='agency':
--
--   SELECT email, role, active_role, secondary_role, created_at
--   FROM public.profiles
--   ORDER BY created_at DESC
--   LIMIT 3;
