-- =====================================================================
-- Migration 101 DOWN: 101_partnership_write_guard_down.sql
--
-- >>> THIS IS THE ROLLBACK FILE. Its sibling, the migration, is
-- >>> 101_partnership_write_guard.sql. A `101_*.sql` glob matches THIS file
-- >>> first. Read this line, then read the first line of whatever you are
-- >>> about to run.
--
-- WHAT IT RESTORES. 101 altered no policy, so there is no policy text to
-- restore byte for byte: "Partners can update partnership status",
-- "Partners can claim partnership by email" and "Agencies can update their
-- partnerships" are exactly as they were before 101 and exactly as they are
-- after this file. The only catalog change 101 made to a policy was its
-- COMMENT, and this file puts that back to NULL, which is what pre-flight P7
-- recorded. IF P7 RETURNED A NON-NULL COMMENT, EDIT THE LAST STATEMENT BELOW
-- TO RESTORE IT BEFORE RUNNING.
--
-- WHAT RUNNING IT RE-OPENS. Dropping the trigger makes status and
-- accepted_at writable by any vendor session again, so Suspend and
-- Terminate become advisory against a vendor holding a console. That is the
-- state of the system before 101. Roll back only to fix a vendor write
-- 101 broke, and then re-apply.
--
-- TRANSACTION CONTROL. An explicit BEGIN; on LINE 29 and an explicit
-- COMMIT; on LINE 37. To dry run, change the COMMIT; to ROLLBACK;
-- and then prove it with V1 below: it must still return ONE row.
-- =====================================================================

BEGIN;

DROP TRIGGER partnerships_guard_vendor_state ON public.partnerships;

DROP FUNCTION public.partnerships_guard_vendor_state();

COMMENT ON POLICY "Partners can update partnership status" ON public.partnerships IS NULL;

COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER A REAL ROLLBACK. READ ONLY.
-- =====================================================================
--
-- V1. THE TRIGGER IS GONE.
--
--       SELECT count(*) FROM pg_trigger
--       WHERE tgrelid = 'public.partnerships'::regclass
--         AND tgname = 'partnerships_guard_vendor_state';
--       -- EXPECTED AFTER A REAL ROLLBACK: 0.
--       -- EXPECTED AFTER A DRY RUN OF THIS FILE: 1 (the trigger survived).
--
-- V2. 087/093's TRIGGER IS UNTOUCHED.
--
--       SELECT count(*) FROM pg_trigger
--       WHERE tgrelid = 'public.partnerships'::regclass
--         AND tgname = 'partnerships_guard_identity_columns';
--       -- EXPECTED: 1.
--
-- V3. THE POLICIES ARE THE ONES YOU WROTE DOWN AT P2.
--
--       SELECT policyname, md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) AS fp
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partnerships' AND cmd = 'UPDATE'
--       ORDER BY policyname;
--       -- EXPECTED: the same three fp values as P2.
