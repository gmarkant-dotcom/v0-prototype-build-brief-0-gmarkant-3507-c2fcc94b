-- =====================================================================
-- Migration 086 DOWN.
--
-- Reverses all three sections of 086. THE THREE ARE INDEPENDENT: if only
-- one of them is wrong, run only that section. They are ordered here so
-- that running the whole file is also safe.
--
--   Section 2 alone (the recursion case, the only one likely to need this):
--     DROP POLICY "Members read their organization roster" ON public.org_members;
--   Section 3 alone:
--     DROP TABLE IF EXISTS public.org_invitations;
--   Section 1 alone: see the warning below. It is the one that destroys data.
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- DATA LOSS WARNING, SECTION 1. Dropping profiles.title destroys every job
-- title anybody has typed. There is nowhere else it is stored and no
-- backfill can recover it. If the rollback is only about the roster policy
-- or the invitations table, DO NOT RUN SECTION 1. It is placed last in this
-- file so that a partial run stops before reaching it.
--
-- The application code tolerates the column being absent: every read of
-- profiles.title is guarded for PostgREST 42703, so leaving the column in
-- place while rolling back the rest costs nothing.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Section 3 reversed: the invitations table.
--
-- DROP TABLE takes its policies and indexes with it. Nothing references
-- org_invitations, so there is no dependency to unwind first. It has no
-- write policy, so under normal operation it holds zero rows and this
-- destroys nothing. If it holds rows, somebody added a write policy this
-- migration did not author - read them before dropping.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.org_invitations;

-- ---------------------------------------------------------------------
-- Section 2 reversed: the roster read.
--
-- "Members read their own membership row" is NOT touched. 086 kept it and
-- this keeps it. After this statement org_members returns exactly one row
-- per caller again and the team roster shows one person.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Members read their organization roster" ON public.org_members;

COMMIT;


-- =====================================================================
-- SECTION 1 REVERSED. SEPARATE TRANSACTION, DELIBERATELY NOT ABOVE.
-- THIS DESTROYS DATA. RUN IT ONLY IF YOU MEAN TO.
-- =====================================================================
--
-- BEGIN;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS title;
-- COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLBACK. READ ONLY. EXPECTED VALUES STATED.
-- =====================================================================
--
-- D1. The table is gone, the policy is gone, and the original policy is not.
--
--       SELECT
--         (SELECT count(*) FROM information_schema.tables
--           WHERE table_schema='public' AND table_name='org_invitations') AS invitations_table,
--         (SELECT count(*) FROM pg_policies
--           WHERE schemaname='public' AND tablename='org_members')        AS org_member_policies;
--
--     EXPECTED: invitations_table = 0, org_member_policies = 3.
--
-- D2. The surviving org_members policies are the 079 three.
--
--       SELECT policyname, cmd FROM pg_policies
--       WHERE schemaname='public' AND tablename='org_members' ORDER BY policyname;
--
--     EXPECTED: "Members read their own membership row" SELECT,
--     "Org admins add members" INSERT, "Org admins remove members" DELETE.
--
-- D3. Only if section 1 was run: the column is gone.
--
--       SELECT count(*) FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='profiles' AND column_name='title';
--
--     EXPECTED: 0. Nothing in the application breaks - the reads are 42703
--     guarded and the writes are behind the same guard.
