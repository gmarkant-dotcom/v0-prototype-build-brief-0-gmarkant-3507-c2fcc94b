-- =====================================================================
-- Migration 085 DOWN: restore the pre-085 counterparty boundary.
--
-- Reverses 085 exactly. After this runs, a counterparty at ANY status -
-- including terminated and removed - reads the whole profiles row again,
-- which is the live exposure 085 exists to close. Run it only because
-- something in 085's verification block disagreed, and say what.
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- ORDER MATTERS AND IT IS THE OPPOSITE OF THE UP MIGRATION.
-- current_user_visible_profile_ids() CALLS
-- current_user_commercial_counterparty_org_ids(), so the caller is
-- restored to its pre-085 body FIRST and the callee is dropped SECOND.
-- Dropping the callee first raises 2BP01 (dependent objects still exist)
-- and aborts the transaction, which is safe but confusing.
--
-- THE CODE FIX DOES NOT NEED REVERTING. The decline path's reordering -
-- resolving the notification recipient before the status moves - is
-- correct with or without 085 and is a pure reordering. Leave it.
-- =====================================================================

BEGIN;

-- 1. Restore current_user_visible_profile_ids() to its 079 PHASE 6 body,
--    transcribed from supabase/migrations/079_organizations.sql line 766
--    rather than reconstructed from memory.
CREATE OR REPLACE FUNCTION public.current_user_visible_profile_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.user_id
  FROM public.org_members m
  WHERE m.org_id IN (SELECT public.current_user_org_ids())
     OR m.org_id IN (SELECT public.current_user_counterparty_org_ids());
$$;

COMMENT ON FUNCTION public.current_user_visible_profile_ids() IS
  'Every profile the caller may see: their own colleagues, plus everybody at every '
  'counterparty organization. Restored to the 079 body by 085_down: the counterparty half '
  'admits EVERY partnership status again, including terminated and removed.';

-- 2. Now the callee has no dependents and can go.
DROP FUNCTION IF EXISTS public.current_user_commercial_counterparty_org_ids();

COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLBACK. READ ONLY. EXPECTED VALUES STATED.
-- =====================================================================
--
-- D1. The new function is gone and the other five remain.
--
--       SELECT p.proname
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--
--     EXPECTED: 5 rows, and current_user_commercial_counterparty_org_ids
--     is NOT among them.
--
-- D2. The two tiers are the same set again.
--     Run AS A REAL AUTHENTICATED USER, not as postgres.
--
--       SELECT
--         (SELECT count(*) FROM public.current_user_counterparty_org_ids())  AS name_tier,
--         (SELECT count(*) FROM public.current_user_visible_profile_ids())   AS visible_profiles;
--
--     EXPECTED: both non-zero for an account with any partnership, and
--     visible_profiles is back to its pre-085 value.
--
-- D3. The profiles policy was never touched by either direction.
--
--       SELECT policyname, cmd FROM pg_policies
--       WHERE schemaname='public' AND tablename='profiles'
--       ORDER BY policyname;
--
--     EXPECTED: the same four policies as before 085, unchanged.
