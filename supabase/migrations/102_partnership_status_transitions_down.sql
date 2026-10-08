-- =====================================================================
-- 102 DOWN: remove the vendor status-transition guard.
--
-- Reverses supabase/migrations/102_partnership_status_transitions.sql
-- exactly: the trigger and its function. It touches no policy, no grant,
-- no column and no other trigger, because 102 did not.
--
-- >>> RUNNING THIS REOPENS THE DEFECT 102 CLOSES. After it, a vendor
-- >>> session can again write ANY status or accepted_at on its own
-- >>> partnership through PostgREST (093's permit list admits both
-- >>> columns by name and never looks at values). Only the application
-- >>> check at app/api/partnerships/route.ts:1072 stands in the way.
--
-- STOP-GATE:
--   [ ] 102 is applied (the trigger exists).
--   [ ] You mean it. There is no data to restore: 102 wrote nothing.
--
-- PRE-FLIGHT (read-only):
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'public.partnerships'::regclass
--     AND tgname = 'partnerships_guard_status_transition';
--   EXPECTED: one row.
--
-- VERIFICATION (after COMMIT):
--   SELECT count(*) FROM pg_trigger
--   WHERE tgrelid = 'public.partnerships'::regclass
--     AND tgname = 'partnerships_guard_status_transition';
--   EXPECTED: 0.
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'partnerships_guard_status_transition';
--   EXPECTED: 0.
--   And partnerships_guard_identity_columns (093) must STILL be listed by P2
--   in the up file: this file does not touch it.

BEGIN;

DROP TRIGGER partnerships_guard_status_transition ON public.partnerships;
DROP FUNCTION public.partnerships_guard_status_transition();

COMMIT;
