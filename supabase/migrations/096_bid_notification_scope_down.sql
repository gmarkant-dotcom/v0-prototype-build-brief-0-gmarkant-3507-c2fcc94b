-- =====================================================================
-- Migration 096 DOWN: 096_bid_notification_scope_down.sql
--
-- ROLLS BACK 096_bid_notification_scope.sql AND NOTHING ELSE.
--
--   ALTER  POLICY "Scoped insert notifications" back to 094's THREE arms
--   DROP   public.current_user_commercial_counterparty_user_ids()
--
-- =====================================================================
-- READ THIS FIRST: THIS IS THE DOWN FILE.
-- =====================================================================
--
-- >>> IF YOU MEANT TO APPLY 096, THE FILE YOU WANT IS
-- >>> supabase/migrations/096_bid_notification_scope.sql
-- >>> - WITHOUT the _down.
--
-- `096_*.sql` SORTS THIS FILE FIRST. A 094_*.sql glob matched the down
-- file first this week and the down file was applied by mistake. If you
-- reached this file from a glob, a tab completion or an editor's file
-- list rather than by typing the full name, STOP AND CHECK.
--
-- Applying this file when 096 has never been applied is not harmful -
-- the ALTER restores a predicate that is already live and the DROP finds
-- nothing - but it is also not a rollback of anything, and it will report
-- "Success. No rows returned" either way.
--
-- =====================================================================
-- WHAT THIS RESTORES
-- =====================================================================
--
-- The policy predicate goes back to EXACTLY what 094 left live: three
-- arms, restated here character for character from 094:331-336.
--
--     user_id = auth.uid()
--     OR user_id IN (SELECT public.current_user_org_member_user_ids())
--     OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
--
-- 094 IS NOT UNDONE. Its arm - current_user_org_member_user_ids() - is
-- restated above and its function is NOT dropped. Colleague notifications
-- keep working after this rollback. If you want 094 undone too, that is
-- 094_notifications_colleague_scope_down.sql, run AFTER this one.
--
-- 079's HELPER IS NOT TOUCHED, in this file or in 096. It was never
-- modified, so there is nothing to restore.
--
-- WHAT COMES BACK WITH IT: the defect. After this file runs, a vendor
-- bidding across a PENDING partnership is refused again,
-- createOrgNotification() returns false again, all three call sites
-- discard it again, and the agency's bell stays silent again. That is the
-- correct outcome for a rollback and it is stated here so nobody has to
-- infer it.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 067
-- and an explicit COMMIT; on LINE 098. Those are the only EXECUTABLE
-- lines that begin with either word.
--
--     grep -n 'BEGIN;'  supabase/migrations/096_bid_notification_scope_down.sql
--     grep -n 'COMMIT;' supabase/migrations/096_bid_notification_scope_down.sql
--
-- ORDER MATTERS INSIDE THE TRANSACTION. The ALTER comes first and the
-- DROP second. Reversed, the DROP would fail on the dependency the policy
-- still holds - which is a safe failure, but a confusing one. This way
-- the function is unreferenced by the time it is dropped.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE POLICY, BACK TO THREE ARMS.
--
-- ALTER, not DROP/CREATE, for the same reason 094 and 096 used ALTER: a
-- DROP on a policy name that is not live SILENTLY NO-OPS against this
-- database, and several live policies here exist under names that appear
-- nowhere in this repository. ALTER raises 42704 instead, which is what a
-- rollback wants.
-- ---------------------------------------------------------------------
ALTER POLICY "Scoped insert notifications"
  ON public.notifications
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (SELECT public.current_user_org_member_user_ids())
    OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
  );


-- ---------------------------------------------------------------------
-- 2. THE FUNCTION. Now unreferenced, so it drops cleanly.
--
-- NOT `DROP ... CASCADE`. If anything else has come to depend on this
-- function since 096 landed, this statement must FAIL and tell you, not
-- quietly remove whatever that was.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.current_user_commercial_counterparty_user_ids();


COMMIT;


-- =====================================================================
-- 3. VERIFICATION OF THE ROLLBACK. RUN AFTER. READ ONLY.
-- =====================================================================
--
-- R1. THE POLICY IS 094's AGAIN.
--
--       SELECT with_check FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'notifications'
--         AND policyname = 'Scoped insert notifications';
--       -- EXPECTED: contains current_user_org_member_user_ids and
--       -- current_user_active_counterparty_user_ids, and does NOT contain
--       -- current_user_commercial_counterparty_user_ids.
--       --
--       -- If current_user_org_member_user_ids is missing, this rollback
--       -- also undid 094 and colleague notifications have stopped. That
--       -- would mean this file was edited. Restore it from git.
--
-- R2. THE FUNCTION IS GONE, AND ONLY THAT ONE.
--
--       SELECT p.proname
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--       -- EXPECTED: 8 rows, current_user_commercial_counterparty_user_ids
--       -- absent and every other name from 079/085/089/094 present:
--       --   current_user_active_counterparty_user_ids
--       --   current_user_admin_org_ids
--       --   current_user_commercial_counterparty_org_ids
--       --   current_user_counterparty_org_ids
--       --   current_user_email
--       --   current_user_org_ids
--       --   current_user_org_member_user_ids
--       --   current_user_visible_profile_ids
--
-- R3. THE POLICY COUNT STILL DID NOT MOVE.
--
--       SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117.
-- =====================================================================
