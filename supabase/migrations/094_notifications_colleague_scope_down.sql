-- =====================================================================
-- Migration 094 ROLLBACK: 094_notifications_colleague_scope_down.sql
--
--   ALTER POLICY "Scoped insert notifications" back to its 079 predicate
--   DROP  public.current_user_org_member_user_ids()
--
-- TWO STATEMENTS. THE ORDER IS LOAD-BEARING AND IT IS THE ORDER ABOVE.
--
-- The policy references the function. Dropping the function while the
-- policy still names it fails on the dependency (2BP01,
-- dependent_objects_still_exist) and leaves the widened policy in place -
-- a rollback that stops halfway, having changed nothing it was for. The
-- policy comes off the function FIRST, and only then is the function
-- droppable.
--
-- =====================================================================
-- THIS ONE DESTROYS NO DATA. IT DESTROYS DELIVERY.
-- =====================================================================
--
-- 092's rollback dropped a column and took a backfill with it. This file
-- drops nothing that holds a value. Every notifications row written while
-- 094 was live SURVIVES this rollback intact and stays readable by the
-- person it is addressed to - the SELECT policy is untouched by 094 and
-- untouched by this file.
--
-- WHAT IT DOES UNDO IS FUTURE DELIVERY. After this runs,
-- createOrgNotification() goes back to writing exactly one row when it
-- fans out over the caller's OWN organization - the caller's own - and
-- silently refusing every colleague's, logging
-- "delivered to some recipients, refused for others" where nobody reads
-- it. Colleagues' bells stop filling from the next event onward.
--
-- >>> THE COLLEAGUE'S BELL WILL NOT LOOK BROKEN. It will look empty, and
-- >>> empty is exactly what it looked like before 094. That is the whole
-- >>> difficulty with reverting this one: there is no error, no failed
-- >>> request and no red state anywhere in the product to tell you the
-- >>> rollback landed. Check V1 below rather than looking at a screen.
--
-- =====================================================================
-- NO CODE NEEDS REVERTING WITH IT
-- =====================================================================
--
-- 092's rollback had to be preceded by a code revert, because deployed
-- code named a column this file would remove and PostgREST 42703s a whole
-- statement on one unknown column. THAT DOES NOT APPLY HERE.
--
-- No route, component or library in this repository names
-- current_user_org_member_user_ids() or the policy predicate. The
-- notification bell reads app/api/notifications/route.ts, whose queries
-- are unchanged by 094 in either direction. So this file may be run with
-- the branch deployed, reverted, or never pushed. Nothing 500s.
--
-- =====================================================================
-- THE PREDICATE RESTORED BELOW IS 079's, VERBATIM
-- =====================================================================
--
-- Copied from 079_organizations.sql:1254-1259, which is what created the
-- live policy under this name. It is NOT copied from the pre-079 snapshot
-- (docs/schema-baseline-2026-08-13.sql:436), which spells the same rule
-- with two inline EXISTS subqueries against partnerships.agency_id and
-- partnerships.partner_id - columns that PHASE 5 renamed. Restoring THAT
-- text would raise 42703 on lead_org_id/vendor_org_id and abort.
--
-- IF YOU ARE ROLLING BACK PAST 079 AS WELL, this file is the wrong tool
-- and 079_organizations_down.sql:698 has the correct pre-079 spelling.
--
-- =====================================================================
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 85
-- and an explicit COMMIT; on LINE 116. Those are the only EXECUTABLE
-- lines that begin with either word. Every other occurrence in this file
-- is inside a comment and has no semicolon at the end of its line.
--
-- Do NOT verify with grep -n '^BEGIN;$'. Use:
--
--     grep -n 'BEGIN;' supabase/migrations/094_notifications_colleague_scope_down.sql
--     grep -n 'COMMIT;' supabase/migrations/094_notifications_colleague_scope_down.sql
--
-- The verification block is AFTER the COMMIT and is entirely commented
-- out, so a dry run stops at the COMMIT and executes none of it.
--
-- STOP GATE. GREG RUNS THIS. THE AGENT DOES NOT.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE POLICY, BACK TO TWO ARMS. The own-organization arm is removed;
--    the other two are byte-for-byte 079's.
--
-- ALTER, not DROP/CREATE, for the same reason 094 used ALTER: a DROP on
-- a policy name that is not live SILENTLY NO-OPS against this database,
-- and several live policies here exist under names that appear nowhere
-- in this repository. ALTER raises 42704 instead, which is what a
-- rollback wants.
-- ---------------------------------------------------------------------
ALTER POLICY "Scoped insert notifications"
  ON public.notifications
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
  );


-- ---------------------------------------------------------------------
-- 2. THE FUNCTION. Now unreferenced, so it drops cleanly.
--
-- NOT `DROP ... CASCADE`. If anything else has come to depend on this
-- function since 094 landed, this statement must FAIL and tell you, not
-- quietly remove whatever that was.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.current_user_org_member_user_ids();


COMMIT;


-- =====================================================================
-- 3. VERIFICATION. RUN AFTER ROLLING BACK. READ ONLY.
-- =====================================================================
--
-- V1. THE PREDICATE IS BACK TO TWO ARMS. THE ONE TO ACTUALLY RUN,
--     because nothing in the product's UI will show you this.
--
--       SELECT policyname, cmd, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public'
--         AND tablename  = 'notifications'
--         AND policyname = 'Scoped insert notifications';
--       -- EXPECTED: exactly 1 row. with_check contains
--       -- current_user_active_counterparty_user_ids and does NOT contain
--       -- current_user_org_member_user_ids.
--       -- Still seeing the org-member helper means the ALTER did not
--       -- take and step 2 should have failed on the dependency - check
--       -- whether the whole transaction rolled back.
--
-- V2. THE FUNCTION IS GONE.
--
--       SELECT count(*) AS still_there
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname = 'current_user_org_member_user_ids';
--       -- EXPECTED: 0.
--
-- V3. THE OTHER SIX HELPERS ARE UNTOUCHED. This file names exactly one
--     function and 094 created exactly one.
--
--       SELECT p.proname
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--       -- EXPECTED: current_user_active_counterparty_user_ids,
--       -- current_user_admin_org_ids,
--       -- current_user_commercial_counterparty_org_ids,
--       -- current_user_counterparty_org_ids, current_user_email,
--       -- current_user_org_ids, current_user_visible_profile_ids.
--       -- Seven rows. Anything missing is not this file's doing and is
--       -- a much larger problem.
--
-- V4. THE POLICY COUNT STILL DID NOT MOVE.
--
--       SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
--       -- EXPECTED: 117. Neither 094 nor this file creates or drops a
--       -- policy.
-- =====================================================================
