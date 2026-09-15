-- =====================================================================
-- Migration 100 DOWN. Restores 088's vendor INSERT policy exactly.
--
-- =====================================================================
-- AUTHORED, NOT APPLIED.
-- =====================================================================
--
-- TRANSACTION CONTROL. Explicit BEGIN on LINE 70 and explicit COMMIT on
-- LINE 103. They are the only executable occurrences of either word.
--   grep -n '^BEGIN;$'  -> exactly one hit, line 70
--   grep -n '^COMMIT;$' -> exactly one hit, line 103
--
-- =====================================================================
-- WHAT ROLLING BACK COSTS, STATED BEFORE THE STATEMENTS
-- =====================================================================
--
-- THE ROWS BRANCH B ADMITTED ARE NOT DELETED, AND CANNOT BE BY THIS
-- FILE. milestone_events is append-only by design: 080 gives it NO
-- DELETE policy for anybody, deliberately, and this file does not add
-- one. Rows written while 100 was live stay written and stay readable by
-- the agency that owns them. That is correct - they record acts that
-- really happened - and it means the rollback is not a time machine.
--
-- WHAT IT DOES RESTORE: the refusal. After this file, an emit from a
-- vendor with no partnership is refused with 42501 again, reported to
-- Sentry with drop_reason "insert-failed" and vendorPartnershipMissing
-- true, and the breadcrumb is lost again. Ruling 6 is reopened.
--
-- >>> NO APPLICATION CODE HAS TO BE REVERTED ALONGSIDE THIS. <<<
-- 100 shipped alone; there is no second half. The four affected emitters
-- behave identically before 100, after 100, and after this file: they
-- resolve a partnership_id, pass it, and let recordMilestone() absorb
-- whatever the database decides. That is what makes this rollback safe
-- to run at any moment without a deploy.
--
-- =====================================================================
-- THERE IS NO INDEX TO DROP
-- =====================================================================
--
-- An earlier draft of 100 created a composite index on
-- partner_rfp_inbox (vendor_org_id, lead_org_id). The branch B that
-- shipped starts from primary keys and needs no new index, so 100
-- creates none and this file drops none.
--
-- If partner_rfp_inbox_vendor_lead_idx EXISTS on the database you are
-- rolling back, an earlier draft of 100 was applied and the policy you
-- are replacing is not the one 100_milestone_inbox_pin.sql describes.
-- STOP and read its with_check first. Dropping it is then a separate,
-- deliberate statement, never something this rollback does on its own:
--
--   DROP INDEX IF EXISTS public.partner_rfp_inbox_vendor_lead_idx;
--
-- =====================================================================
-- BEFORE RUNNING: CONFIRM WHAT YOU ARE REPLACING
-- =====================================================================
--
-- Expect ONE row whose with_check mentions partner_rfp_inbox. If it does
-- not, 100 is not live and this file would OVERWRITE something else with
-- 088's text. STOP if the branch B substring is absent.
--
--   SELECT policyname, cmd,
--          with_check LIKE '%partner_rfp_inbox%' AS is_100
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'milestone_events'
--     AND policyname = 'Vendors insert own company milestone events';
--
-- =====================================================================


BEGIN;


-- The policy below is 088_vendor_milestone_events.sql:435-460, with its inline
-- comments stripped and nothing else changed. The predicate is token
-- for token what 088 shipped. Verify rather than trust:
--
--   sed -n '435,460p' supabase/migrations/088_vendor_milestone_events.sql
--   (compare against lines 82-100 of this file, whitespace normalized)
--
DROP POLICY IF EXISTS "Vendors insert own company milestone events" ON public.milestone_events;

CREATE POLICY "Vendors insert own company milestone events"
  ON public.milestone_events AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_side = 'vendor'
    AND actor_id = auth.uid()
    AND actor_email IS NULL
    AND vendor_org_id IN (SELECT public.current_user_org_ids())
    AND event_type = ANY (public.vendor_emittable_event_types())
    AND partnership_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id            = milestone_events.partnership_id
        AND p.vendor_org_id = milestone_events.vendor_org_id
        AND p.lead_org_id   = milestone_events.org_id
    )
  );


COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLING BACK.
--
-- R1. Branch B is gone and branch A is back. Expect is_100 = false and
--     has_branch_a = true.
--
--       SELECT policyname,
--              with_check LIKE '%partner_rfp_inbox%'          AS is_100,
--              with_check LIKE '%partnership_id IS NOT NULL%' AS has_branch_a
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'milestone_events'
--         AND policyname = 'Vendors insert own company milestone events';
--
-- R2. Still 4 policies on the table, still no UPDATE and no DELETE.
--
--       SELECT policyname, cmd FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'milestone_events'
--       ORDER BY cmd, policyname;
--
-- R3. The rows branch B admitted are STILL THERE. This is expected, not
--     a failure. Whatever count this returns is the record of the window
--     100 was live.
--
--       SELECT count(*) AS rows_written_while_100_was_live
--       FROM public.milestone_events
--       WHERE actor_side = 'vendor' AND partnership_id IS NULL;
--
-- =====================================================================
