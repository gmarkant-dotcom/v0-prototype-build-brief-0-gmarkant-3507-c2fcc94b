-- =====================================================================
-- Migration 095 ROLLBACK: 095_notification_types_down.sql
--
--   ALTER TABLE public.notifications
--     DROP CONSTRAINT notifications_type_check
--     ADD  CONSTRAINT notifications_type_check CHECK (type IN (<8>))
--
-- ONE STATEMENT. It restores the EIGHT-value constraint that 095 widened
-- to eleven.
--
-- >>> YOU ARE READING THE DOWN FILE. The forward migration is
-- >>> 095_notification_types.sql, WITHOUT the _down. If you reached this
-- >>> file from a `095_*.sql` glob, THE GLOB MATCHED THIS ONE FIRST -
-- >>> `_down` sorts before `.sql` on the character after "types". That
-- >>> is exactly how a 094 down file got applied by mistake this week.
-- >>> If you meant to apply 095, STOP AND OPEN THE OTHER FILE.
--
-- =====================================================================
-- >>> THIS ROLLBACK CAN FAIL, AND AFTER A SUCCESSFUL 095 THE FAILING
-- >>> CASE IS THE EXPECTED ONE. READ THIS BEFORE RUNNING IT.
-- =====================================================================
--
-- ADD CONSTRAINT VALIDATES EVERY EXISTING ROW. 095 exists so that five
-- write sites can start writing rows of type onboarding_deployed and
-- bid_submitted. THE MOMENT ONE SUCH ROW EXISTS, adding back a
-- constraint that forbids that value raises
--
--     ERROR 23514: check constraint "notifications_type_check" of
--     relation "notifications" is violated by some row
--
-- and the whole statement aborts. NOTHING is changed - the eleven-value
-- constraint stays in place and the database is exactly as it was. That
-- is a safe failure, not a corrupted half-rollback, but it IS a failure
-- and you have not rolled anything back when you see it.
--
-- >>> SO THIS IS NOT A SYMMETRIC ROLLBACK. 095 is trivially reversible
-- >>> for as long as nobody uses it, and progressively harder to reverse
-- >>> the longer it has been live. That is the opposite of the usual
-- >>> shape and it is the single most important thing on this page.
--
-- FIND OUT BEFORE YOU RUN IT. This query tells you whether the rollback
-- can succeed at all, and it is read-only:
--
--     SELECT type, count(*) AS n
--     FROM public.notifications
--     WHERE type IN ('partnership_declined',
--                    'onboarding_deployed',
--                    'bid_submitted')
--     GROUP BY type
--     ORDER BY type;
--     -- 0 rows  -> this rollback will succeed cleanly. Run it.
--     -- ANY row -> it will raise 23514 and change nothing. Choose,
--     --            below, before running anything.
--
-- IF THAT QUERY RETURNS ROWS, THERE ARE EXACTLY THREE HONEST OPTIONS
-- AND ONE OF THEM IS NOT ON THE LIST:
--
--   (1) DO NOT ROLL BACK. Almost always correct. 095 grants nothing and
--       widens no access - it is a spelling gate on a text column - so
--       there is very little that rolling it back can fix. Establish
--       what you actually believe 095 broke first. If the answer is
--       "the bell is too noisy", that is the roadmap item in
--       docs/notification-types-report.md and it is a UI change, NOT a
--       reason to start refusing writes at the database again.
--
--   (2) DELETE THE ROWS FIRST, THEN RUN THIS FILE. This DESTROYS real
--       notifications addressed to real people. Count them first with
--       the query above. It is a deliberate data deletion and it should
--       be a deliberate decision, not a step in a rollback recipe, which
--       is why no DELETE is written into this file for you to run by
--       reflex.
--
--   (3) NARROW THE RESTORE. If only one of the three types is the
--       problem, restore a TEN-value constraint instead by editing the
--       list below. Ten is not a state this repository has ever been in;
--       write down why in LIGAMENT_CONTEXT.md if you do it.
--
--   NOT ON THE LIST: adding NOT VALID to make the error go away. That
--   leaves a constraint that claims to enumerate eight values while rows
--   holding a ninth sit in the table underneath it. The next person to
--   read pg_get_constraintdef() is then misled by the database itself.
--
-- =====================================================================
-- WHAT IT UNDOES, IN PRODUCT TERMS
-- =====================================================================
--
-- Every notifications row already written SURVIVES this rollback if the
-- rollback succeeds at all - and if any of them hold the three types, it
-- does not succeed. No SELECT policy is touched, so nothing already in
-- somebody's bell disappears from it.
--
-- WHAT STOPS IS FUTURE WRITES. From the next event onward:
--
--   - AN AGENCY STOPS BEING TOLD IN-APP THAT A BID LANDED. All three
--     bid_submitted sites go back to raising 23514 and writing nothing,
--     including both guest magic-link paths - a CHECK constraint is not
--     RLS and the service role does not bypass it.
--   - A vendor stops being told in-app that their onboarding package
--     arrived, on both deploy paths.
--   - partnership_declined changes nothing, because it was never
--     landing: 094's counterparty arm is active-only and a declined
--     partnership is not active. See the forward file's header.
--
-- >>> IT WILL NOT LOOK BROKEN. It will look quiet, and quiet is exactly
-- >>> what it looked like before 095 - which is how the defect went
-- >>> unnoticed from the day the types were wired until 094's pre-apply
-- >>> test tripped over it by accident. There is no error, no failed
-- >>> request and no red state anywhere in the product to tell you this
-- >>> landed. The failure is a log line nobody reads. CHECK V1 BELOW
-- >>> RATHER THAN LOOKING AT A SCREEN.
--
-- =====================================================================
-- NO CODE NEEDS REVERTING WITH IT
-- =====================================================================
--
-- Nothing in this repository reads this constraint, names it, or
-- branches on it. lib/notifications.ts keeps declaring eleven types
-- either way; the three simply start failing again at the database.
-- This file may be run with the branch deployed, reverted, or never
-- pushed. Nothing 500s. Nothing needs redeploying.
--
-- THE COMMENT CORRECTION AT lib/notifications.ts:171-196 SHIPPED IN ITS
-- OWN COMMIT and describes 094's policy, not this constraint. It is
-- correct whether or not 095 is in place and MUST NOT be reverted with
-- this file.
--
-- =====================================================================
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 142
-- and an explicit COMMIT; on LINE 177.
--
--     grep -n 'BEGIN;'  supabase/migrations/095_notification_types_down.sql
--     grep -n 'COMMIT;' supabase/migrations/095_notification_types_down.sql
--
-- Extra hits are this header quoting itself and are prefixed with `--`.
-- The executable pair is the only pair with no comment marker.
--
-- The VERIFICATION block is AFTER the COMMIT and entirely commented out,
-- so a dry run stops at the COMMIT line and executes none of it.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- Restore the eight. Same name, for the same reason the forward file
-- kept it: every error message and every report already uses it.
--
-- If this raises 23514, rows of the three removed types exist. Nothing
-- has changed. Go back to the top of this file and choose between (1),
-- (2) and (3) - do not retry it.
-- ---------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check,
  ADD  CONSTRAINT notifications_type_check CHECK (
    type IN (
      'partnership_invitation',
      'partnership_accepted',
      'project_assignment',
      'project_accepted',
      'project_declined',
      'new_message',
      'document_uploaded',
      'project_awarded'
    )
  );

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
  'The eight values permitted before migration 095. RESTORED BY 095''s down file, which '
  'means this constraint is once again NARROWER than the eleven-value NotificationType '
  'union in lib/notifications.ts:265-276 - partnership_declined, onboarding_deployed and '
  'bid_submitted are declared in the code and refused here, so six write sites raise 23514 '
  'and write nothing. That divergence is the defect 095 existed to close. If you are '
  'reading this on a live database, find out why the rollback was run.';


COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER ROLLING BACK. READ ONLY.
-- =====================================================================
--
-- V1. THE CONSTRAINT IS THE OLD ONE AGAIN.
--
--       SELECT conname, pg_get_constraintdef(oid)
--       FROM pg_constraint
--       WHERE conrelid = 'public.notifications'::regclass
--         AND contype  = 'c';
--       -- EXPECTED: exactly 1 row, notifications_type_check, holding
--       -- EIGHT literals and NONE of partnership_declined,
--       -- onboarding_deployed, bid_submitted.
--       -- Still holding eleven means the ALTER never ran - most likely
--       -- it raised 23514 and the error was not read. Nothing was
--       -- rolled back. Go back to the top of this file.
--
-- V2. THE ROWS ARE ALL STILL THERE.
--
--       SELECT count(*) AS total_rows FROM public.notifications;
--       -- EXPECTED: the same number as before this file was run. This
--       -- rollback deletes nothing. A drop means something else did.
--
-- V3. THE THREE TYPES ARE REFUSED AGAIN. The error is the pass.
--
--       BEGIN;
--       INSERT INTO public.notifications (user_id, type, title)
--       SELECT id, 'bid_submitted', '095-down V3 probe'
--       FROM public.profiles LIMIT 1;
--       ROLLBACK;
--       -- EXPECTED: ERROR 23514. A SUCCESS means the eleven-value
--       -- constraint is still live and the rollback did not land.
-- =====================================================================
