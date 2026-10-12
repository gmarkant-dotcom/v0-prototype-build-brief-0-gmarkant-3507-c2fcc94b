-- =====================================================================
-- 115 DOWN: restores the whole-row discoverable policy and removes discoverable_profiles().
--
-- AUTHORED 2026-10-12 on branch fix/guest-profiles-records. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: after this file ANY SIGNED-IN USER CAN AGAIN READ EVERY COLUMN OF
--       EVERY DISCOVERABLE PROFILE (legal_ein, legal_address, rate_info, default_terms, is_paid,
--       is_admin, demo_access, ...) through PostgREST. That is the pre-115 state.
--   [ ] The deployed code keeps working: lib/server/discoverable-profiles.ts sees PGRST202 for
--       the missing function and falls back to the direct select, which the restored policy
--       admits, with the same column allow-list.
--
-- BEGIN is line 26 and COMMIT is line 37.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm 115's V1 still returns zero rows.
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT policyname, cmd, roles, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'profiles'
--      AND policyname = 'Authenticated users can read discoverable profiles';
--     -- one row: SELECT, {authenticated}, (is_discoverable = true)
--   SELECT to_regprocedure('public.discoverable_profiles(text, uuid[])');   -- NULL
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can read discoverable profiles" ON public.profiles;
CREATE POLICY "Authenticated users can read discoverable profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (is_discoverable = TRUE);

DROP FUNCTION IF EXISTS public.discoverable_profiles(text, uuid[]);

COMMIT;
