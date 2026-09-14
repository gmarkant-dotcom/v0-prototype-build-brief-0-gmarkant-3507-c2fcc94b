-- =====================================================================
-- Migration 099: 099_rfp_closure.sql
--
-- FOUR THINGS, IN ONE TRANSACTION:
--   1. partner_rfp_inbox_status_check   widened  9 -> 11 values
--   2. notifications_type_check         widened 11 -> 13 values
--   3. partner_rfp_inbox.closed_at      ONE new column
--   4. TWO POLICY CHANGES on partner_rfp_inbox:
--        a. a NEW lead-agency UPDATE policy, because there is none
--        b. the EXISTING vendor UPDATE policy NARROWED
--
-- >>> THE FULL FILENAME IS 099_rfp_closure.sql. <<<
--
-- Its rollback sibling is 099_rfp_closure_down.sql. A `099_*.sql` glob
-- MATCHES THE DOWN FILE FIRST - `_down` sorts before `.sql` on the
-- character after "closure" - and that is not hypothetical: a 094_*.sql
-- glob matched the down file first and the down file was applied by
-- mistake. Open the file you mean by its whole name and read the first
-- line of it before you run anything.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- >>> THIS FILE WIDENS TWO LIVE CHECK CONSTRAINTS AND CHANGES TWO
-- >>> POLICIES ON A TABLE IN PRODUCTION USE. Run
-- >>> supabase/migrations/099_preapply_test.sql first, and read the
-- >>> PRE-FLIGHT CAPTURE below before either.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN; on LINE 420
-- and an explicit COMMIT; on LINE 606. THOSE TWO ARE THE ONLY EXECUTABLE
-- LINES IN THE FILE that begin with either word.
--
-- Do NOT verify with grep -n '^BEGIN;$'. That anchored form has produced
-- false negatives in this repository and 087 nearly burned a dry run on
-- exactly that. Use:
--
--     grep -n 'BEGIN;'  supabase/migrations/099_rfp_closure.sql
--     grep -n 'COMMIT;' supabase/migrations/099_rfp_closure.sql
--
-- >>> READ THE OUTPUT, DO NOT COUNT IT. Both greps return MORE THAN ONE
-- >>> line and that is correct. The extras are this header quoting
-- >>> itself and the commented BEGIN;/ROLLBACK; probes in the
-- >>> VERIFICATION block at the foot. Every one of those extras is
-- >>> PREFIXED WITH `--`. The executable pair is the only pair with no
-- >>> comment marker. If either line number has moved, this header has
-- >>> been edited without its numbers being re-checked. Trust the grep,
-- >>> fix the header.
--
-- >>> WHY THIS PARAGRAPH EXISTS AT ALL. Migration 086 shipped with NO
-- >>> transaction control. The dry-run procedure in this repository is
-- >>> "swap the file's COMMIT for ROLLBACK and run it", and with no
-- >>> COMMIT to swap, that procedure silently did nothing: what everyone
-- >>> believed was a dry run APPLIED FOR REAL, with no rollback
-- >>> available. Every migration since carries its own BEGIN and COMMIT
-- >>> and states their line numbers here so the swap has something to
-- >>> find.
--
-- Sequence, no step skipped:
--   1. Run the PRE-FLIGHT CAPTURE below. Record every answer.
--   2. Run supabase/migrations/099_preapply_test.sql. Read the headline.
--   3. Dry run THIS file: COMMIT -> ROLLBACK, run, confirm no errors,
--      put the COMMIT back.
--   4. Run for real.
--   5. Run VERIFICATION. Every query states its expected value.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md.
--   7. THEN deploy the code. See ORDERING below - this one is NOT
--      independent of the deploy, unlike 095.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE. MIGRATION FIRST. NOT OPTIONAL.
-- =====================================================================
--
-- Unlike 095, which could be applied before the code, after it, or with
-- no code at all, THIS FILE MUST LAND BEFORE THE PHASE 3 AND PHASE 4
-- CODE DEPLOYS. Three reasons, each of which fails silently rather than
-- loudly:
--
--   a. The close and decline routes write 'closed' and 'not_selected'.
--      Before this file those raise 23514 and write nothing. The routes
--      return an error, so this one is at least visible.
--
--   b. The notification writes use 'rfp_closed' and 'rfp_not_selected'.
--      Before this file those raise 23514 inside createOrgNotification,
--      which CATCHES, logs, and returns false. The handler still returns
--      200. A vendor gets the email and no bell and nobody is told.
--
--   c. >>> THE ONE THAT MATTERS MOST. The close route writes on the
--      SESSION client, and there is NO lead-agency UPDATE policy on
--      partner_rfp_inbox today (section 4a). A PostgREST UPDATE matching
--      zero rows IS NOT AN ERROR. So before this file lands, the close
--      action would report success, send the email, and change nothing.
--      That is the exact success-shaped non-event this project has been
--      bitten by three times.
--
-- CONVERSELY, APPLYING THIS FILE WITHOUT THE CODE IS SAFE AND CHANGES
-- NOTHING A USER SEES. It permits two statuses nothing writes yet,
-- permits two notification types nothing emits yet, adds a nullable
-- column nothing reads yet, and adds a policy for a verb the agency
-- already believed it had. There is no window in which this file alone
-- degrades the product.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY. RUN BEFORE ANYTHING ELSE.
-- RECORD EVERY ANSWER IN docs/rfp-closure-report.md.
-- =====================================================================
--
-- These are not optional and they are not the same as VERIFICATION.
-- VERIFICATION asks "did it work". THIS asks "is the database the shape
-- this file was written against". The file was authored from the on-disk
-- migration history, and LIGAMENT_CONTEXT.md is explicit that the
-- on-disk history CANNOT reproduce this database: several live policies
-- exist under names appearing nowhere in this repository, 048 has no
-- file, and 073 was never applied.
--
-- P1. THE STATUS CHECK, AS IT ACTUALLY IS.
--
--       SELECT conname, pg_get_constraintdef(oid)
--       FROM pg_constraint
--       WHERE conrelid = 'public.partner_rfp_inbox'::regclass
--         AND contype = 'c';
--       -- EXPECTED: 2 rows.
--       --   partner_rfp_inbox_status_check  - the NINE of scripts/019
--       --     (new, viewed, bid_submitted, feedback_received,
--       --      revision_submitted, shortlisted, meeting_requested,
--       --      awarded, declined)
--       --   partner_rfp_inbox_recipient     - scripts/013:22, untouched
--       --
--       -- IF THE STATUS ROW IS ABSENT: this file's DROP IF EXISTS
--       -- no-ops and its ADD creates the constraint for the first time.
--       -- That is still correct, but SAY SO IN THE REPORT - it means
--       -- the column has been unconstrained and may hold values this
--       -- file's eleven do not cover, in which case the ADD FAILS on
--       -- validation. Run P2 before deciding.
--       --
--       -- IF IT HOLDS MORE OR FEWER THAN NINE: this file replaces it
--       -- with ITS OWN eleven and any extra value is LOST. Stop and add
--       -- it to the list in section 1 before running.
--
-- P2. WHAT IS ACTUALLY IN THE COLUMN. Validation scans every row.
--
--       SELECT status, count(*) AS n
--       FROM public.partner_rfp_inbox
--       GROUP BY status ORDER BY n DESC;
--       -- EXPECTED: every value returned is one of the nine. If any row
--       -- holds something else, ADD CONSTRAINT raises 23514 and this
--       -- whole transaction aborts having changed nothing. That is the
--       -- correct outcome, not a bug - but find out here rather than
--       -- from a red box.
--       -- ALSO RECORD THE TOTAL. It was 97 on 2026-09-14.
--
-- P3. THE POLICIES ON THIS TABLE, AND THE ONE THAT IS MISSING.
--
--       SELECT policyname, cmd, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
--       ORDER BY cmd, policyname;
--       -- EXPECTED: FIVE rows.
--       --   INSERT  Agencies insert partner RFP inbox rows
--       --   SELECT  Agencies select own partner RFP inbox rows
--       --   SELECT  Partners select inbox rows by partner_id
--       --   SELECT  Partners select inbox rows by recipient email
--       --   UPDATE  Partners update own inbox rows   <- with_check NULL
--       --
--       -- >>> THE TWO THINGS TO READ FOR, IN THIS ORDER:
--       --
--       -- (i)  IS THERE ALREADY AN UPDATE POLICY FOR THE LEAD AGENCY?
--       --      There is none in this repository. If one exists live
--       --      under a name not on disk, section 4a's CREATE raises
--       --      42710 and this transaction aborts. Read its predicate,
--       --      then either rename section 4a's policy or drop the
--       --      section. DO NOT simply add a second permissive UPDATE
--       --      policy: two permissive policies OR together, and the
--       --      narrowing in 4b would then be bypassed by whichever one
--       --      is wider.
--       --
--       -- (ii) IS "Partners update own inbox rows" STILL ITS 079 NAME
--       --      AND STILL with_check NULL? Section 4b ALTERs it by name.
--       --      If the name has drifted, ALTER raises 42704 and this
--       --      transaction aborts with nothing applied - which is the
--       --      safe failure and is why 4b uses ALTER and not
--       --      DROP-then-CREATE. A DROP on a name that is not live
--       --      SILENTLY NO-OPS and the CREATE that followed would add a
--       --      SECOND permissive policy, closing nothing and widening
--       --      everything while reporting success.
--
-- P4. THE NOTIFICATIONS CHECK.
--
--       SELECT pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid = 'public.notifications'::regclass
--         AND conname = 'notifications_type_check';
--       -- EXPECTED: the ELEVEN of 095:312-331. Same warning as P1: this
--       -- file replaces the list with its own thirteen, so any value
--       -- present live and absent from section 2 is LOST.
--
-- P5. THE NOTIFICATIONS ROWS, because ADD CONSTRAINT validates them.
--
--       SELECT type, count(*) AS n FROM public.notifications
--       GROUP BY type ORDER BY n DESC;
--       -- EXPECTED: every value is one of the eleven. 095 measured 15
--       -- rows on 2026-08-25 across three types; five write sites have
--       -- been live since, so a larger number is expected and correct.
--
-- P6. THE POLICY COUNT, for VERIFICATION V6 to compare against.
--
--       SELECT count(*) AS policy_count FROM pg_policies;
--       -- 095's V6 expected 117. 097 and 098 have landed since. RECORD
--       -- WHAT YOU SEE - this file adds exactly ONE policy, so V6's
--       -- expectation is (this number + 1) and nothing else.
--
-- P7. DOES THE COLUMN ALREADY EXIST? A re-run must be a no-op.
--
--       SELECT column_name, data_type, is_nullable
--       FROM information_schema.columns
--       WHERE table_schema = 'public'
--         AND table_name = 'partner_rfp_inbox'
--         AND column_name = 'closed_at';
--       -- EXPECTED ON A FIRST RUN: 0 rows.
--
-- =====================================================================
-- SECTION 3's COLUMN SET. ONE COLUMN, AND TWO THAT ARE DELIBERATELY
-- ABSENT. THE ABSENCES ARE THE ARGUMENT.
-- =====================================================================
--
-- The brief asked for who closed it, when, and by which unit. One of the
-- three earns a column.
--
-- >>> WHEN: closed_at timestamptz NULL. ADDED.
--
-- R7 requires that a vendor can see a request was once made of them AND
-- ITS OUTCOME, and the Phase 5 history surface must show WHEN IT CLOSED.
-- updated_at cannot serve: it moves on every write to the row, including
-- the viewed_at stamp, the NDA confirmation, the magic-link attach's
-- self-heal, and the bid status sync. A surface reading updated_at would
-- show the date of the most recent unrelated write and call it the
-- closure date. Nullable, because it is null for every row that has not
-- been closed, which is all of them today and most of them forever.
--
-- >>> WHO: closed_by. NOT ADDED. THERE IS ALREADY A RULING.
--
-- Migration 080's header carries it, and it is quoted verbatim in
-- lib/milestone-events.ts:9:
--
--     "Greg's ruling: attribution belongs in M1, scoped to milestones
--      rather than a created_by column on every table."
--
-- `grep -rn "created_by" app lib supabase scripts` returns two hits and
-- both are that sentence. `owner_id` returns nothing repository-wide.
-- Adding closed_by here would be the first per-table actor column in the
-- schema and would overturn a standing decision inside a feature
-- migration, which is not where a schema-wide convention should change.
--
-- If Greg wants closure attributed, it goes where every other attributed
-- action goes: a milestone_events row, which already has actor_id
-- (080:262, uuid NULL REFERENCES profiles(id) ON DELETE SET NULL) and
-- already carries per-project, per-vendor scoping and a vendor-visible
-- whitelist. That is a separate change with its own event-type decision
-- and it is NOT made here.
--
-- >>> BY WHICH UNIT: closed_unit. NOT ADDED. IT IS ALREADY IN THE STATUS.
--
-- R7 defines exactly two units and gives each its OWN STATUS:
--
--     closed        the whole RFP ended, for every vendor at once
--     not_selected  this one vendor, while others stay open
--
-- A closed_unit column would hold 'rfp' on precisely the rows whose
-- status is 'closed' and 'vendor' on precisely the rows whose status is
-- 'not_selected'. It is a function of a column that is already there. A
-- derivable column is not free: it is a second place for the same fact
-- to live, and the two can disagree after any partial write.
--
-- >>> REOPENING: NO COLUMN, AND NO REOPEN. See 3f in the report.
--
-- Reopen is OUT OF SCOPE for this run and the confirmation copy in the
-- UI says so, because closure sends an email that cannot be unsent.
--
-- Recording the decision for whoever picks it up: IF reopen is built
-- later it needs NO NEW COLUMN. Reopening is `status` back to 'new' and
-- `closed_at` back to NULL, both of which already exist, and the pair is
-- self-consistent - a row with a status of 'new' and a non-null
-- closed_at would be the only broken state and it is one UPDATE away
-- from impossible. What reopen actually needs is a decision about the
-- vendor's inbox, not a column: a request that reappears without a
-- second email is a request the vendor never learns has reappeared.
--
-- =====================================================================
-- SECTION 4's POLICY CHANGES. THE ARGUMENT FOR EACH, IN FULL.
-- =====================================================================
--
-- >>> 4a. A NEW LEAD-AGENCY UPDATE POLICY. THIS IS A NEW GRANT AND IT
-- >>> IS STATED AS ONE RATHER THAN BURIED.
--
-- THE FACT IT RESTS ON: there is NO UPDATE policy for the lead agency on
-- partner_rfp_inbox. Five policies exist (P3 above). Four are SELECT or
-- INSERT. The one UPDATE policy is the VENDOR'S. Verified by reading
-- every CREATE POLICY naming this table across supabase/migrations/*.sql
-- and scripts/*.sql, and against the 2026-08-13 pg_policies dump at
-- docs/schema-snapshot-2026-08-13.md:134-142. P3 is what confirms it
-- against the live database.
--
-- WHY THE GRANT IS NECESSARY. The Phase 3 close and decline routes must
-- write to this table as the agency. The alternatives are worse:
--   - The service role: forbidden by this run's limits, and wrong in
--     principle. It would bypass the ownership boundary rather than
--     express it, and the boundary is the security requirement here.
--   - Leaving it: the write matches zero rows and reports success.
--
-- WHY IT IS NOT A WIDENING OF ANY EXISTING PREDICATE. It adds no row to
-- the reach of any policy that exists. It is a new policy whose
-- predicate is `lead_org_id IN (SELECT public.current_user_org_ids())`
-- on BOTH the USING and the WITH CHECK - character for character the
-- predicate the two agency policies ALREADY on this table use:
--
--     "Agencies insert partner RFP inbox rows"  079:1342-1344
--     "Agencies select own partner RFP inbox rows" 079:1346-1348
--
-- So the set of rows a lead agency may UPDATE becomes exactly the set it
-- may already SELECT and INSERT. An agency gains write access to rows it
-- can already read and already created, and to nothing else.
--
-- >>> WITH CHECK IS NOT OPTIONAL AND IT IS NOT THE SAME AS USING.
-- USING decides which rows may be updated; WITH CHECK decides what they
-- may be updated TO. With USING alone, an agency could move a row's
-- lead_org_id to ANOTHER organization - handing its own row away, or
-- more usefully, parking a row where the recipient cannot be reached.
-- Both clauses, same predicate, closes it. This is the shape
-- "Agencies update response status and feedback" (079:1384-1387) already
-- uses on partner_rfp_responses, which grants the same verb over the
-- same agency-vendor relationship. This policy is strictly narrower than
-- that one in the sense that matters: it reaches one table.
--
-- NOT NARROWED TO THE TWO CLOSURE STATUSES, DELIBERATELY. A policy that
-- admitted only 'closed' and 'not_selected' would look tighter and would
-- BREAK the agency-side bid status sync at
-- app/api/agency/rfp-responses/[id]/route.ts:762-779, which writes
-- 'awarded', 'declined', 'shortlisted', 'meeting_requested' and
-- 'bid_submitted' onto this same table through this same verb. Which
-- statuses an agency may set is an APPLICATION question with an
-- application answer; which ROWS it may touch is the access question and
-- that is what this policy answers.
--
-- >>> WHICH RAISES THE THING THIS FILE FIXES BY ACCIDENT, AND IT MUST
-- >>> NOT SHIP UNREMARKED. That bid status sync has been running on the
-- >>> session client against a table with no agency UPDATE policy since
-- >>> 079 was applied on 2026-08-20. If P3 confirms no such policy
-- >>> exists, THAT SYNC HAS BEEN MATCHING ZERO ROWS FOR THREE WEEKS and
-- >>> every inbox row whose bid was awarded, declined or shortlisted in
-- >>> that window still holds its old status. This file makes it start
-- >>> working. That is a pre-existing production defect being closed as
-- >>> a side effect of a feature migration, and Q5 in
-- >>> docs/099-phase0-baseline.md is the query that measures the damage.
-- >>> RUN IT. The rows will not repair themselves.
--
-- >>> 4b. THE VENDOR UPDATE POLICY, NARROWED. THIS IS THE SECURITY HALF
-- >>> OF THIS MIGRATION AND IT IS THE EASIEST THING HERE TO MISS.
--
-- "Partners update own inbox rows" (079:1356-1364) has a USING clause
-- and NO WITH CHECK. PostgreSQL applies USING as the check when WITH
-- CHECK is absent, so TODAY A VENDOR MAY SET THEIR OWN ROW TO ANY VALUE
-- THE CHECK CONSTRAINT PERMITS, straight from the browser client, with
-- no route involved. The vendor portal legitimately needs this: it
-- stamps viewed_at, partner_intent, nda_confirmed_at and the
-- bid_submitted status transition.
--
-- >>> SO SECTION 1, ON ITS OWN, WOULD HAND VENDORS THE CLOSE ACTION.
-- >>> Widening a CHECK constraint looks like a spelling change. Here it
-- >>> is a privilege grant, because the only thing standing between a
-- >>> vendor and any status string is that constraint. R7 says a vendor
-- >>> must NEVER be able to close or not_select their own row. Section 1
-- >>> and section 4b MUST land together or not at all, which is why this
-- >>> file has one transaction and not two.
--
-- THE PREDICATE, AND WHY IT IS EQUAL-OR-NARROWER:
--
--   BEFORE:  USING      <P>
--            WITH CHECK  (absent, so PostgreSQL uses <P>)
--
--   AFTER:   USING      <P>                          -- UNTOUCHED
--            WITH CHECK <P> AND status <> 'closed'
--                           AND status <> 'not_selected'
--
-- <P> is not restated, retyped or re-derived by this file: section 4b
-- names WITH CHECK ONLY, so the live USING survives verbatim whatever it
-- is. The new check is the old effective check ANDed with two
-- inequalities. A conjunction with a new term can only ever admit fewer
-- rows. There is no input for which the new predicate is true and the
-- old one false. It is narrower by construction, not by inspection.
--
-- WRITTEN AS TWO `<>` TERMS RATHER THAN `NOT IN`. `status NOT IN
-- ('closed','not_selected')` evaluates to NULL, not TRUE, if status is
-- ever NULL - and a NULL WITH CHECK result is treated as a failure, so
-- it would refuse a legitimate write. The column is NOT NULL today
-- (scripts/013:19) so this cannot arise, but the two-term form does not
-- depend on that staying true.
--
-- WHAT A VENDOR CAN STILL DO, UNCHANGED: every status in the nine, which
-- is every status they could set before this file. Nothing a vendor does
-- today stops working. The ONLY thing they lose is the ability to set
-- two values that did not exist until this file created them.
--
-- =====================================================================
-- VALIDATION COST
-- =====================================================================
--
-- Both ADD CONSTRAINTs validate every existing row. partner_rfp_inbox
-- held 97 rows on 2026-09-14 and notifications held 15 on 2026-08-25.
-- Both constraints are strict SUPERSETS of what they replace, so every
-- existing row satisfies the new version by construction and validation
-- cannot fail on data that satisfied the old one. P2 and P5 confirm that
-- premise against the live table rather than assuming it.
--
-- NO `NOT VALID` / `VALIDATE CONSTRAINT` SPLIT. That two-step exists to
-- avoid holding a lock while scanning a large table. Ninety-seven rows
-- do not need it, and NOT VALID would leave a constraint that does not
-- guarantee what it says.
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. THE INBOX STATUS CHECK. NINE VALUES BECOME ELEVEN.
--
-- SAME NAME, DELIBERATELY. partner_rfp_inbox_status_check is the name in
-- every 23514 error message and in scripts/018 and scripts/019.
-- Renaming it would orphan all of them to buy nothing.
--
-- DROP ... IF EXISTS so a re-run is a no-op rather than 42704. The ADD is
-- NOT conditional: if a constraint of this name somehow survives the
-- DROP, the ADD must fail loudly rather than skip.
--
-- ONE ALTER TABLE, TWO ACTIONS, NOT TWO STATEMENTS. Both take the same
-- ACCESS EXCLUSIVE lock on the same table in the same statement, so there
-- is no window in which the table sits unconstrained.
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_inbox
  DROP CONSTRAINT IF EXISTS partner_rfp_inbox_status_check,
  ADD  CONSTRAINT partner_rfp_inbox_status_check CHECK (
    status IN (
      -- The nine already permitted (scripts/019:16-26). Unchanged.
      'new',
      'viewed',
      'bid_submitted',
      'feedback_received',
      'revision_submitted',
      'shortlisted',
      'meeting_requested',
      'awarded',
      'declined',
      -- The two this migration adds. R7: these are DIFFERENT MESSAGES to
      -- a vendor and must not be collapsed into the existing 'declined',
      -- which means a vendor who BID AND LOST. A vendor who was asked and
      -- never bid has a different history, and one value for both makes
      -- the two indistinguishable in that vendor's own record.
      'closed',        -- the opportunity ended, for every vendor at once
      'not_selected'   -- this vendor specifically was not chosen
    )
  );

COMMENT ON CONSTRAINT partner_rfp_inbox_status_check ON public.partner_rfp_inbox IS
  'Eleven values. The nine from scripts/019 plus closed and not_selected, added by '
  'migration 099 for the RFP closure actions. closed and not_selected are deliberately '
  'NOT the existing declined: declined means a vendor who submitted a bid and lost, and '
  'these two mean a vendor who was asked and never answered. Only the LEAD agency may set '
  'either - see the WITH CHECK on the policy "Partners update own inbox rows", which 099 '
  'added for exactly that reason. Widening this list again without re-reading that policy '
  'hands vendors whatever is added.';


-- ---------------------------------------------------------------------
-- 2. THE NOTIFICATION TYPE CHECK. ELEVEN VALUES BECOME THIRTEEN.
--
-- Same shape as 095:312-331, which is the file that established it.
--
-- >>> THE TWO NEW VALUES MUST BE ADDED TO THE NotificationType UNION IN
-- >>> lib/notifications.ts IN THE SAME CHANGE. Nothing checks that the
-- >>> two lists agree. A type declared in TypeScript and missing here
-- >>> raises 23514 at runtime, inside a function that CATCHES and logs
-- >>> and returns false, and the handler still returns 200. That is how
-- >>> three types went six months without anyone noticing.
-- ---------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check,
  ADD  CONSTRAINT notifications_type_check CHECK (
    type IN (
      -- The eleven already permitted (095:315-330). Unchanged.
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
      'bid_submitted',
      -- The two this migration adds. Named on 095's own convention:
      -- <subject>_<outcome>, subject first and singular, the subject
      -- being the domain noun the event happened to. 'rfp' is a new
      -- subject in this union and is the correct one - neither event is
      -- about a bid (there is none), a partnership, or a project.
      'rfp_closed',
      'rfp_not_selected'
    )
  );

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
  'The thirteen values of the NotificationType union in lib/notifications.ts. Widened from '
  'eight to eleven by migration 095 and from eleven to thirteen by 099. Keep this list and '
  'that union identical: nothing checks that they agree, and a mismatch fails silently at '
  'runtime - createOrgNotification catches the 23514, logs, returns false, and every call '
  'site still returns 200.';


-- ---------------------------------------------------------------------
-- 3. THE ONE NEW COLUMN.
--
-- See the column-set section of the header for why closed_by and
-- closed_unit are absent. Both absences are arguments, not omissions.
--
-- IF NOT EXISTS so a re-run is a no-op. Nullable with no default: a
-- default would stamp a closure time onto ninety-seven rows that have
-- not been closed.
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_inbox
  ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL;

COMMENT ON COLUMN public.partner_rfp_inbox.closed_at IS
  'When status became closed or not_selected. NULL on every row that has not been closed. '
  'Migration 099. Separate from updated_at because updated_at moves on every write to the '
  'row - viewed_at, the NDA confirmation, the magic-link self-heal, the bid status sync - '
  'so a history surface reading it would show an unrelated date and call it the closure '
  'date. Set by the application, not by a trigger: this table has no updated_at trigger '
  'either and its timestamps have always been written by the route that causes them.';


-- ---------------------------------------------------------------------
-- 4a. THE NEW LEAD-AGENCY UPDATE POLICY.
--
-- The full argument is in the header. In one line: there is no UPDATE
-- policy for the lead agency on this table, the close and decline routes
-- need one, and this predicate is character for character the one the
-- table's INSERT and SELECT agency policies already use.
--
-- CREATE, NOT DROP-THEN-CREATE and not CREATE OR REPLACE (which does not
-- exist for policies). If a policy of this name is somehow already live,
-- this raises 42710 and the whole transaction aborts having changed
-- nothing - which is the safe failure, and P3(i) is how to find out
-- before running.
-- ---------------------------------------------------------------------
CREATE POLICY "Agencies update own partner RFP inbox rows"
  ON public.partner_rfp_inbox AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));


-- ---------------------------------------------------------------------
-- 4b. THE VENDOR UPDATE POLICY, NARROWED.
--
-- >>> THIS IS THE SECURITY STATEMENT OF THIS FILE. Section 1 permits two
-- >>> new strings in a column a vendor can already write. Without this
-- >>> statement, section 1 hands the close action to every vendor on the
-- >>> platform.
--
-- ALTER, NEVER DROP-THEN-CREATE. If the policy name has drifted, ALTER
-- raises 42704 and this transaction aborts with nothing applied. A DROP
-- on a name that is not live SILENTLY NO-OPS against this database, and
-- the CREATE that followed would add a SECOND permissive policy that ORs
-- with the first - closing nothing, widening everything, and reporting
-- "Success. No rows returned" while it did so. Several live policies here
-- exist under names that appear nowhere in this repository, so this is
-- not hypothetical. 096:365-372 established the rule.
--
-- WITH CHECK ONLY. The USING clause is NOT NAMED and therefore NOT
-- TOUCHED: whatever is live survives verbatim, including the
-- recipient-email arm that 079 deliberately left alone pending a product
-- ruling (079:1108-1117). Restating USING here would mean retyping a
-- predicate from a file that cannot reproduce this database.
--
-- The result is the old effective check ANDed with two inequalities.
-- A conjunction can only admit fewer rows. Narrower by construction.
-- ---------------------------------------------------------------------
ALTER POLICY "Partners update own inbox rows"
  ON public.partner_rfp_inbox
  WITH CHECK (
    (
      vendor_org_id IN (SELECT public.current_user_org_ids())
      OR (recipient_email IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid()
              AND lower(btrim(pr.email)) = lower(btrim(partner_rfp_inbox.recipient_email))))
    )
    -- R7. THE VENDOR MAY NEVER SET EITHER CLOSURE STATUS ON THEIR OWN
    -- ROW. Two inequalities rather than NOT IN: NOT IN yields NULL for a
    -- NULL status and a NULL WITH CHECK result is a refusal, which would
    -- block a legitimate write. The column is NOT NULL today; this form
    -- does not depend on that staying true.
    AND status <> 'closed'
    AND status <> 'not_selected'
  );


COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER APPLYING. READ ONLY EXCEPT WHERE MARKED.
-- EXPECTED VALUES STATED.
--
-- Commented out so they cannot run inside the transaction above, and so
-- a dry run stops at the COMMIT line and executes none of them. Paste
-- them into the SQL Editor one at a time, after the COMMIT has landed.
--
-- >>> "Success. No rows returned" IN THE SQL EDITOR PROVES NOTHING ON
-- >>> ITS OWN. It is the identical message for a dry run that rolled
-- >>> everything back, for a real apply that committed, and for a
-- >>> correct file pasted into the wrong project's tab. This block is
-- >>> the only thing that tells them apart. Run it.
-- =====================================================================
--
-- V1. THE INBOX CONSTRAINT IS THE NEW ONE.
--
--       SELECT conname, pg_get_constraintdef(oid)
--       FROM pg_constraint
--       WHERE conrelid = 'public.partner_rfp_inbox'::regclass
--         AND contype = 'c';
--       -- EXPECTED: 2 rows. partner_rfp_inbox_status_check's definition
--       -- must contain ALL ELEVEN literals. Read for the two new ones
--       -- BY NAME - closed, not_selected - AND confirm the nine old ones
--       -- are all still there. A definition holding only the two means
--       -- the DROP/ADD replaced rather than widened, which would break
--       -- every write this product makes to this column.
--
-- V2. THE NOTIFICATIONS CONSTRAINT IS THE NEW ONE.
--
--       SELECT pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid = 'public.notifications'::regclass
--         AND conname = 'notifications_type_check';
--       -- EXPECTED: ALL THIRTEEN. Same warning as V1: read for
--       -- rfp_closed and rfp_not_selected AND confirm the eleven older
--       -- ones survived.
--
-- V3. THE COLUMN EXISTS AND IS NULLABLE AND IS EMPTY.
--
--       SELECT column_name, data_type, is_nullable, column_default
--       FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'partner_rfp_inbox'
--         AND column_name = 'closed_at';
--       -- EXPECTED: 1 row, timestamp with time zone, YES, default NULL.
--
--       SELECT count(*) AS closed_rows FROM public.partner_rfp_inbox
--       WHERE closed_at IS NOT NULL;
--       -- EXPECTED: 0. This file writes no row and R3 says NO BACKFILL.
--       -- Anything above 0 means something wrote before you looked.
--
-- V4. NO ROW WAS LOST OR CHANGED. Both tables.
--
--       SELECT count(*) AS inbox_rows FROM public.partner_rfp_inbox;
--       -- EXPECTED: whatever P2 recorded. 97 on 2026-09-14.
--
--       SELECT status, count(*) FROM public.partner_rfp_inbox
--       GROUP BY status ORDER BY 2 DESC;
--       -- EXPECTED: IDENTICAL to P2. This file changes no row's status.
--
-- V5. >>> THE ONE THAT MATTERS. THE POLICIES.
--
--       SELECT policyname, cmd, roles, qual, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
--       ORDER BY cmd, policyname;
--       -- EXPECTED: SIX rows, one more than P3 found.
--       --
--       -- READ THESE TWO LINES SPECIFICALLY:
--       --
--       -- (i)  "Agencies update own partner RFP inbox rows", cmd UPDATE.
--       --      BOTH qual AND with_check must be non-null and both must
--       --      read lead_org_id IN (SELECT current_user_org_ids()).
--       --      A NULL with_check here means the WITH CHECK clause did
--       --      not take and an agency could move a row to another
--       --      organization.
--       --
--       -- (ii) "Partners update own inbox rows", cmd UPDATE.
--       --      >>> with_check MUST NO LONGER BE NULL. <<<
--       --      It must contain BOTH `status <> 'closed'` AND
--       --      `status <> 'not_selected'`, AND the whole of its previous
--       --      USING predicate including the recipient_email arm.
--       --      qual must be UNCHANGED from what P3 recorded - compare
--       --      the two strings, do not skim them.
--       --
--       -- >>> IF with_check IS STILL NULL ON (ii), STOP AND DO NOT
--       -- >>> DEPLOY THE PHASE 3 CODE. Every vendor on the platform can
--       -- >>> close their own RFP rows from the browser client. Re-apply
--       -- >>> section 4b before anything else.
--
-- V6. THE POLICY COUNT MOVED BY EXACTLY ONE.
--
--       SELECT count(*) AS policy_count FROM pg_policies;
--       -- EXPECTED: P6's number + 1. This file CREATEs one policy and
--       -- ALTERs one in place; an ALTER adds no row.
--
-- V7. A VENDOR CANNOT SET EITHER STATUS. THE BOUNDARY, MEASURED.
--     >>> THIS ONE WRITES. THE ROLLBACK IS NOT OPTIONAL. <<<
--
--     Substitute a real vendor's user id and one of their own inbox row
--     ids. supabase/migrations/099_preapply_test.sql does this
--     properly, with impersonation, as assertion T7 - prefer that file.
--     This is the by-hand version for after the apply.
--
--       BEGIN;
--       SET LOCAL ROLE authenticated;
--       SET LOCAL request.jwt.claims = '{"sub":"<VENDOR_USER_ID>","role":"authenticated"}';
--       UPDATE public.partner_rfp_inbox SET status = 'closed'
--       WHERE id = '<AN_INBOX_ROW_THAT_VENDOR_OWNS>';
--       ROLLBACK;
--       -- EXPECTED: ERROR 42501, "new row violates row-level security
--       -- policy". THE ERROR IS THE PASS.
--       -- "UPDATE 0" is ALSO a pass and means the USING clause refused
--       -- it first - say which one you saw.
--       -- >>> "UPDATE 1" IS A FAILURE AND IS THE WORST OUTCOME THIS
--       -- >>> FILE CAN HAVE. Section 4b did not take. Re-run V5(ii).
--
-- V8. THE CONSTRAINTS STILL CONSTRAIN. A WIDENING THAT ACCEPTS ANYTHING
--     IS NOT A WIDENING, IT IS A REMOVAL.
--
--       BEGIN;
--       UPDATE public.partner_rfp_inbox SET status = 'definitely_not_real'
--       WHERE id = (SELECT id FROM public.partner_rfp_inbox LIMIT 1);
--       ROLLBACK;
--       -- EXPECTED: ERROR 23514 against partner_rfp_inbox_status_check.
--       -- THE ERROR IS THE PASS.
--
--       BEGIN;
--       INSERT INTO public.notifications (user_id, type, title)
--       SELECT id, 'definitely_not_a_real_type', '099 V8 probe'
--       FROM public.profiles LIMIT 1;
--       ROLLBACK;
--       -- EXPECTED: ERROR 23514 against notifications_type_check.
--
-- V9. THE TWO NEW NOTIFICATION TYPES ARE ACTUALLY ACCEPTED.
--
--       BEGIN;
--       INSERT INTO public.notifications (user_id, type, title)
--       SELECT p.id, t.type, '099 V9 probe'
--       FROM (SELECT id FROM public.profiles LIMIT 1) p
--       CROSS JOIN (VALUES ('rfp_closed'), ('rfp_not_selected')) AS t(type);
--       ROLLBACK;
--       -- EXPECTED: INSERT 0 2, then ROLLBACK. No error.
--       -- 23514 here means section 2's ADD did not take.
--       -- >>> THE ROLLBACK IS NOT OPTIONAL. These are probe rows
--       -- >>> addressed to a real person and they would appear in that
--       -- >>> person's notification bell.
--
-- V10. THE PRE-EXISTING DEFECT 4a CLOSES. RUN IT, AND RUN IT AGAIN LATER.
--
--       SELECT i.status AS inbox_status, r.status AS response_status,
--              count(*) AS n
--       FROM public.partner_rfp_responses r
--       JOIN public.partner_rfp_inbox i ON i.id = r.inbox_item_id
--       GROUP BY 1, 2 ORDER BY n DESC;
--       -- This is Q5 from docs/099-phase0-baseline.md. Run it BEFORE
--       -- applying and again after the next bid decision.
--       -- A large population where response_status is awarded/declined
--       -- and inbox_status is still new/viewed is the signature of the
--       -- sync described in the header having matched zero rows since
--       -- 2026-08-20. This file makes it work going forward. IT DOES NOT
--       -- REPAIR THE ROWS IT ALREADY MISSED - that is a backfill, it is
--       -- a separate decision, and R3's "no backfill" was a ruling about
--       -- deadlines, not about this.
--
-- =====================================================================
-- IF YOU NEED TO UNDO THIS: 099_rfp_closure_down.sql.
-- READ ITS HEADER FIRST. It is NOT a symmetric rollback - restoring the
-- nine-value constraint FAILS with 23514 if any row has been closed in
-- the meantime, and after the Phase 3 code deploys that is the expected
-- state rather than an edge case.
-- =====================================================================
