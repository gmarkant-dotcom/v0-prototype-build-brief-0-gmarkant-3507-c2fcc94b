-- =====================================================================
-- 113 DOWN: removes the role-column guard and set_active_role().
--
-- AUTHORED 2026-10-09 on branch fix/agency-gate-and-leaks. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: after this file A SIGNED-IN USER CAN AGAIN WRITE profiles.role,
--       secondary_role AND active_role FROM A BROWSER. That does not reopen the agency side by
--       itself - G1 is enforced in code from organizations.is_lead_agency / is_paid and reads no
--       role column - but it is the pre-113 state.
--   [ ] The deployed code keeps working: lib/server/active-role-switch.ts sees PGRST202 for the
--       missing function and falls back to the same rule plus a direct write.
--
-- BEGIN is line 24 and COMMIT is line 30.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm 113's V1 still returns one row.
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   113's V1                                                        -- zero rows
--   SELECT to_regprocedure('public.set_active_role(text)');          -- NULL
--   SELECT to_regprocedure('public.profiles_guard_role_columns()');  -- NULL
-- =====================================================================

BEGIN;

DROP TRIGGER IF EXISTS profiles_role_columns_guard ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_guard_role_columns();
DROP FUNCTION IF EXISTS public.set_active_role(text);

COMMIT;
