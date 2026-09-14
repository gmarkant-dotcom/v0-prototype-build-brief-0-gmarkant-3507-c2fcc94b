-- =====================================================================
-- Migration 099 ROLLBACK: 099_rfp_closure_down.sql
--
-- >>> READ THE WHOLE HEADER. THIS IS NOT A SYMMETRIC ROLLBACK AND IT
-- >>> CANNOT BE ONE. Running it blind either FAILS LOUDLY or SILENTLY
-- >>> RE-OPENS A SECURITY HOLE, depending on which parts you keep.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 128
-- and an explicit COMMIT; on LINE 258. THOSE TWO ARE THE ONLY EXECUTABLE
-- LINES IN THE FILE that begin with either word. Verify with:
--
--     grep -n 'BEGIN;'  supabase/migrations/099_rfp_closure_down.sql
--     grep -n 'COMMIT;' supabase/migrations/099_rfp_closure_down.sql
--
-- Both return more than one line. The extras are this header and the
-- commented probes, all prefixed with `--`.
--
-- =====================================================================
-- THE THREE THINGS THAT MAKE THIS ASYMMETRIC
-- =====================================================================
--
-- >>> (1) THE CONSTRAINT RESTORE FAILS IF ANY ROW HAS BEEN CLOSED, AND
-- >>> AFTER THE PHASE 3 CODE SHIPS THAT IS THE EXPECTED STATE.
--
-- ADD CONSTRAINT validates every existing row. Restoring the nine-value
-- partner_rfp_inbox_status_check raises 23514 the moment one row holds
-- 'closed' or 'not_selected'. The same is true of the eleven-value
-- notifications_type_check against any 'rfp_closed' or
-- 'rfp_not_selected' row.
--
-- THIS FILE DOES NOT DELETE OR REWRITE THOSE ROWS FOR YOU, and that is
-- deliberate. Silently turning every closed RFP back into an open one
-- would re-populate vendors' queues with requests their agencies have
-- already closed and already emailed them about. What to do with them is
-- a decision, not a cleanup:
--
--   OPTION A, THE HONEST ONE: leave them. Run only sections 3 and 4 of
--     this file and leave both constraints widened. The two extra
--     permitted strings cost nothing while no code writes them - a CHECK
--     constraint is a spelling gate, it is not access control.
--
--   OPTION B: rewrite the rows first, then run everything. Section 0
--     below is the query that finds them and the UPDATE that would do
--     it. IT IS COMMENTED OUT AND MUST STAY THAT WAY unless Greg has
--     explicitly decided to re-open those requests. Read what it
--     destroys before uncommenting it: closed_at is dropped by section
--     3, so after that runs there is no record of which rows were
--     closed or when, and no way to redo this.
--
-- >>> (2) DROPPING THE AGENCY UPDATE POLICY RE-BREAKS SOMETHING THAT
-- >>> WAS ALREADY BROKEN BEFORE 099, AND IT WILL BREAK QUIETLY.
--
-- Section 4a of 099 created "Agencies update own partner RFP inbox
-- rows" because no lead-agency UPDATE policy existed. As a side effect
-- it made the bid status sync at
-- app/api/agency/rfp-responses/[id]/route.ts:762-779 start working -
-- that sync had been matching zero rows since 079 was applied on
-- 2026-08-20 and reporting success the whole time.
--
-- Dropping this policy returns that sync to matching zero rows. It will
-- not error, it will not log, and nobody will be told. If you drop it,
-- WRITE THAT DOWN somewhere a person will read, because the symptom -
-- an inbox row whose status disagrees with its bid - takes a join to
-- see and appears nowhere in the interface.
--
-- >>> (3) RESTORING THE VENDOR POLICY'S NULL WITH CHECK IS A SECURITY
-- >>> REGRESSION IF THE STATUS CONSTRAINT STAYS WIDE. THE TWO ARE
-- >>> COUPLED AND THE COUPLING RUNS ONE WAY ONLY.
--
-- 099's section 4b added a WITH CHECK to "Partners update own inbox
-- rows" so a vendor cannot set 'closed' or 'not_selected' on their own
-- row. That narrowing is ONLY safe to remove if the status constraint no
-- longer permits those values.
--
-- >>> SO THE ORDER IN THIS FILE IS NOT ARBITRARY AND MUST NOT BE
-- >>> REARRANGED: section 1 narrows the status constraint BEFORE section
-- >>> 4b widens the vendor policy. Reverse them, or run 4b alone, and
-- >>> there is a window - or a permanent state - in which every vendor
-- >>> on the platform can close their own RFP rows from the browser.
--
-- >>> IF YOU TAKE OPTION A ABOVE AND SKIP SECTION 1, YOU MUST ALSO SKIP
-- >>> SECTION 4b. Option A leaves the constraint wide; 4b would then be
-- >>> handing vendors a live capability. Sections 3 and 4a are the only
-- >>> two that are safe to run on their own.
--
-- =====================================================================
-- SECTION 0. FINDING AND REWRITING CLOSED ROWS. COMMENTED OUT.
-- ONLY FOR OPTION B. READ (1) ABOVE FIRST.
-- =====================================================================
--
-- S0a. HOW MANY ROWS WOULD BLOCK THE RESTORE. READ-ONLY. RUN THIS FIRST.
--
--       SELECT status, count(*) AS n, min(closed_at) AS earliest,
--              max(closed_at) AS latest
--       FROM public.partner_rfp_inbox
--       WHERE status IN ('closed', 'not_selected')
--       GROUP BY status;
--       -- 0 rows means section 1 will succeed and Option B is
--       -- unnecessary. Any row means you must choose A or B.
--
--       SELECT type, count(*) AS n FROM public.notifications
--       WHERE type IN ('rfp_closed', 'rfp_not_selected')
--       GROUP BY type;
--
-- S0b. >>> DESTRUCTIVE. NOT RUN BY THIS FILE. DO NOT UNCOMMENT WITHOUT
--      >>> AN EXPLICIT DECISION TO RE-OPEN EVERY CLOSED REQUEST.
--
--      This re-opens them as 'new', which is a LIE about their history:
--      the vendor was told by email that the request was closed, and
--      this makes it look like it never was. There is no better value
--      available - that is the cost of the rollback, not a flaw in the
--      statement.
--
--       -- UPDATE public.partner_rfp_inbox
--       --    SET status = 'new', closed_at = NULL
--       --  WHERE status IN ('closed', 'not_selected');
--
--       -- DELETE FROM public.notifications
--       --  WHERE type IN ('rfp_closed', 'rfp_not_selected');
--
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE INBOX STATUS CHECK, BACK TO NINE.
--
-- >>> RAISES 23514 IF ANY ROW STILL HOLDS 'closed' OR 'not_selected'.
-- >>> That failure is CORRECT and aborts the whole transaction having
-- >>> changed nothing. Do not work around it by dropping the constraint
-- >>> and not re-adding it: an unconstrained status column is worse than
-- >>> a wide one, because nothing at all then gates what lands in it.
--
-- RUNS BEFORE SECTION 4b. See (3) in the header - that ordering is the
-- only thing keeping this file from handing vendors the close action.
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_inbox
  DROP CONSTRAINT IF EXISTS partner_rfp_inbox_status_check,
  ADD  CONSTRAINT partner_rfp_inbox_status_check CHECK (
    status IN (
      'new',
      'viewed',
      'bid_submitted',
      'feedback_received',
      'revision_submitted',
      'shortlisted',
      'meeting_requested',
      'awarded',
      'declined'
    )
  );

COMMENT ON CONSTRAINT partner_rfp_inbox_status_check ON public.partner_rfp_inbox IS
  'The nine values of scripts/019-bid-status-meeting-requested.sql. Restored by '
  '099_rfp_closure_down.sql.';


-- ---------------------------------------------------------------------
-- 2. THE NOTIFICATION TYPE CHECK, BACK TO ELEVEN.
--
-- >>> RAISES 23514 IF ANY 'rfp_closed' OR 'rfp_not_selected' ROW EXISTS.
-- Same reasoning as section 1. 095's own down file carries the identical
-- warning for the same reason.
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
      'project_awarded',
      'partnership_declined',
      'onboarding_deployed',
      'bid_submitted'
    )
  );

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
  'The eleven values of the NotificationType union as of migration 095. Restored by '
  '099_rfp_closure_down.sql.';


-- ---------------------------------------------------------------------
-- 3. THE COLUMN.
--
-- >>> THIS DESTROYS DATA AND THE DATA IS NOT RECOVERABLE. Every
-- >>> closed_at value goes with it, so after this runs there is no
-- >>> record of which rows were closed or when - including for rows
-- >>> whose status section 1 has just refused to change.
--
-- IF EXISTS so a re-run is a no-op rather than 42703.
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_inbox
  DROP COLUMN IF EXISTS closed_at;


-- ---------------------------------------------------------------------
-- 4a. THE LEAD-AGENCY UPDATE POLICY.
--
-- >>> DROPPING THIS RE-BREAKS THE BID STATUS SYNC, QUIETLY. See (2) in
-- >>> the header. It will not error and it will not log.
--
-- IF EXISTS so a re-run is a no-op rather than 42704.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Agencies update own partner RFP inbox rows"
  ON public.partner_rfp_inbox;


-- ---------------------------------------------------------------------
-- 4b. THE VENDOR UPDATE POLICY'S WITH CHECK, REMOVED.
--
-- >>> ONLY SAFE BECAUSE SECTION 1 RAN FIRST AND THE CONSTRAINT NO LONGER
-- >>> PERMITS THE TWO CLOSURE VALUES. If you skipped section 1, SKIP
-- >>> THIS TOO. See (3) in the header.
--
-- PostgreSQL has no syntax for "remove a WITH CHECK clause". ALTER
-- POLICY ... WITH CHECK (<the USING predicate>) is the equivalent: it
-- restores the exact behaviour of a NULL with_check, which is that the
-- USING predicate is used as the check.
--
-- >>> THIS IS THE ONE PLACE IN EITHER FILE THAT RETYPES THE VENDOR
-- >>> PREDICATE, AND IT IS THEREFORE THE ONE PLACE THAT CAN GET IT
-- >>> WRONG. It is copied from 079:1356-1364. BEFORE RUNNING THIS,
-- >>> compare it against the LIVE qual:
--
--       SELECT qual FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
--         AND policyname = 'Partners update own inbox rows';
--
-- >>> If the live qual differs from the predicate below, EDIT THE
-- >>> PREDICATE BELOW TO MATCH IT before running. Otherwise this
-- >>> statement writes a check that is not the same as the using, and
-- >>> the asymmetry will be invisible until a vendor write is refused
-- >>> for a reason nobody can find.
-- ---------------------------------------------------------------------
ALTER POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox
  WITH CHECK (
    vendor_org_id IN (SELECT public.current_user_org_ids())
    OR (recipient_email IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.id = auth.uid()
            AND lower(btrim(pr.email)) = lower(btrim(partner_rfp_inbox.recipient_email))))
  );


COMMIT;


-- =====================================================================
-- VERIFICATION FOR THE ROLLBACK. READ-ONLY.
-- =====================================================================
--
-- D1. Both constraints are back to their old lists.
--
--       SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid = 'public.partner_rfp_inbox'::regclass
--         AND contype = 'c';
--       -- EXPECTED: partner_rfp_inbox_status_check holds NINE values
--       -- and neither 'closed' nor 'not_selected' appears.
--
--       SELECT pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid = 'public.notifications'::regclass
--         AND conname = 'notifications_type_check';
--       -- EXPECTED: ELEVEN values, no rfp_ prefix anywhere.
--
-- D2. The column is gone.
--
--       SELECT count(*) FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'partner_rfp_inbox'
--         AND column_name = 'closed_at';
--       -- EXPECTED: 0.
--
-- D3. FIVE policies on the table, and the vendor one's with_check reads
--     exactly as its qual.
--
--       SELECT policyname, cmd, qual, with_check FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
--       ORDER BY cmd, policyname;
--       -- EXPECTED: 5 rows. No "Agencies update own partner RFP inbox
--       -- rows". For "Partners update own inbox rows", qual and
--       -- with_check must be the SAME string - compare them character
--       -- by character, do not skim. A with_check that is narrower than
--       -- the qual means section 4b's retyped predicate drifted from
--       -- the live one and vendor writes will be refused for reasons
--       -- nobody can trace.
--
-- D4. The application code must come DOWN BEFORE this file goes UP, or
--     come down with it. Sections 1 and 2 make the Phase 3 and Phase 4
--     writes raise 23514 again - the route writes fail visibly, the
--     notification writes fail silently. Revert the code first.
-- =====================================================================
