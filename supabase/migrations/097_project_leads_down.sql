-- =====================================================================
-- Migration 097 ROLLBACK: 097_project_leads_down.sql
--
-- THIS IS THE DOWN FILE. IT DESTROYS THE PROJECT LEADERSHIP HISTORY.
-- IF YOU MEANT TO APPLY 097, THE FILE YOU WANT IS
-- 097_project_leads.sql - NO `_down`.
--
-- >>> THIS NAME SORTS FIRST UNDER A `097_*.sql` GLOB. That is exactly how
-- >>> a down file got applied by mistake this week. If you reached this
-- >>> file by expanding a glob rather than by typing its name, STOP.
--
-- =====================================================================
-- WHAT RUNNING THIS COSTS
-- =====================================================================
--
-- DROP TABLE takes the ROWS WITH IT. Every "Chris led it until March,
-- Dana leads it now" this table has recorded is gone, and nothing else
-- in the schema holds that fact - `projects` has no creator or owner
-- column and never has (see docs/097-phase0-baseline.md section 3), so
-- there is nothing to reconstruct it from.
--
-- BEFORE RUNNING THIS, IF ANY LEAD HAS EVER BEEN SET, take a copy:
--
--     SELECT * FROM public.project_leads ORDER BY project_id, started_at;
--
-- and keep the output. It is small and it is the only record.
--
-- RUN THE ROW COUNT FIRST. If it is zero, this rollback is free:
--
--     SELECT count(*) FROM public.project_leads;
--
-- =====================================================================
-- WHAT THIS RESTORES
-- =====================================================================
--
-- The database exactly as 096 left it: 117 policies, no project_leads
-- table, no set_project_lead function, no project_leads_guard_membership
-- function. 097 created only new objects - it altered no existing table,
-- dropped no policy and changed no function - so removing them restores
-- the prior state completely, with the single, permanent exception of the
-- rows above.
--
-- THE DEPLOYED CODE WILL BREAK, LOUDLY, AND THAT IS CORRECT.
-- `components/project-lead-picker.tsx` has NO fallback path, on purpose
-- (the 082 fallback blocks are the cautionary tale). After this runs the
-- picker shows PostgREST's 42P01 / 42883 on every project surface. If
-- you are rolling back the migration, roll back the deploy too - revert
-- the Phase 4 commit - rather than leaving the picker calling objects
-- that no longer exist.
--
-- TRANSACTION CONTROL. One explicit BEGIN; on LINE 78 and one explicit
-- COMMIT; on LINE 91. There are no plpgsql blocks in this file.
--
--     grep -n 'BEGIN;'  supabase/migrations/097_project_leads_down.sql
--     grep -n 'COMMIT;' supabase/migrations/097_project_leads_down.sql
--
-- =====================================================================
-- ORDER OF OPERATIONS
-- =====================================================================
--
-- The trigger goes before its function, and the table goes before
-- nothing - DROP TABLE removes its own policies, its own indexes, its
-- own constraints and its own trigger with it. The explicit DROP TRIGGER
-- is therefore redundant and is kept anyway, so that a partial 097 - one
-- that created the trigger and then failed - still rolls back cleanly.
--
-- DROP FUNCTION ... (uuid, uuid) NAMES THE ARGUMENT TYPES. An unqualified
-- DROP FUNCTION raises 42725 when overloads exist, and naming the
-- signature means this cannot remove a differently-shaped function that
-- happens to share the name.
--
-- NO `CASCADE` ANYWHERE. If something outside 097 has come to depend on
-- these objects, this file must FAIL and tell you, not quietly remove
-- whatever that was.
-- =====================================================================


BEGIN;


DROP TRIGGER IF EXISTS project_leads_membership_guard ON public.project_leads;

-- Removes the table, its three policies, its four indexes, its check
-- constraint and both its foreign keys in one statement.
DROP TABLE IF EXISTS public.project_leads;

DROP FUNCTION IF EXISTS public.set_project_lead(uuid, uuid);
DROP FUNCTION IF EXISTS public.project_leads_guard_membership();


COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLBACK. RUN AFTER APPLYING. READ ONLY.
-- =====================================================================
--
-- R1. THE TABLE IS GONE.
--
--       SELECT count(*) AS still_there
--       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = 'public' AND c.relname = 'project_leads';
--       -- EXPECTED: 0.
--
-- R2. BOTH FUNCTIONS ARE GONE.
--
--       SELECT p.proname
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('project_leads_guard_membership', 'set_project_lead');
--       -- EXPECTED: 0 rows.
--
-- R3. THE POLICY COUNT IS BACK TO WHERE 096 LEFT IT.
--
--       SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117.
--       -- 120 means the DROP TABLE did not run. 114 means something
--       -- other than this file dropped policies - stop and read.
--
-- R4. NOTHING ELSE MOVED. The two SQLSTATEs 097 introduced, LG010 and
--     LG011, are raised nowhere else, so there is no other function to
--     check. Confirm the helper family is untouched:
--
--       SELECT p.proname
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--       -- EXPECTED: the same 9 rows 096's V6 lists. 097 created none of
--       -- them and this file drops none of them.
-- =====================================================================
