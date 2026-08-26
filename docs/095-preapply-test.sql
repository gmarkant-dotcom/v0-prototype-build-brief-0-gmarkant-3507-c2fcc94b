-- =====================================================================
-- 095 PRE-APPLY TEST. ONE PASTE. WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 095 proves the file parses. It says NOTHING about whether
-- the three types are actually refused today, whether the widened
-- constraint actually admits them, whether the EIGHT that already work
-- survived the DROP/ADD, or - the one that matters most - whether the
-- new constraint still constrains anything at all.
--
-- >>> 095 REPLACES A LIVE CHECK CONSTRAINT BY DROPPING IT AND ADDING
-- >>> ONE BACK. If the ADD is wrong, the table is left accepting
-- >>> whatever the new list happens to say, and NOTHING ANYWHERE RAISES.
-- >>> A constraint that is too permissive breaks no page, fails no
-- >>> request and shows no red state. The only way to find out what it
-- >>> admits is to try to write things through it and see which ones
-- >>> land. That is what the ten assertions below do.
--
-- IT PROVES THE DEFECT BEFORE IT PROVES THE FIX. T1 runs against the
-- LIVE constraint, before section A applies anything. If T1 does not
-- show 'bid_submitted' being refused, the premise of the whole migration
-- is wrong and you should not apply it on the strength of the later
-- assertions passing.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch. Do NOT run it in pieces.
--   3. READ THE ERROR MESSAGE. That is where the result is.
--
-- =====================================================================
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT.        <<<
-- >>> A RUN THAT DOES **NOT** ERROR MEANS SOMETHING WENT WRONG.   <<<
-- =====================================================================
--
-- The DO block finishes with RAISE EXCEPTION carrying the whole report.
-- So a correct, healthy, everything-worked run looks like a red error box
-- with a multi-line message in it. That is not a failure. That IS the
-- output, and the verdict is the first line of it.
--
-- WHY IT HAS TO BE AN ERROR. This is the third mechanism and the first
-- two were dead ends against this exact client - established in
-- docs/091-preapply-test.sql, re-used unchanged by 092 and 094, and NOT
-- re-derived here:
--
--   RAISE NOTICE - the Supabase SQL Editor has no Messages panel and does
--   not render notices at all. Every assertion runs and the editor says
--   "Success. No rows returned".
--
--   A TEMP TABLE AND A FINAL SELECT - the editor returns 3F000 schema
--   "pg_temp" does not exist. That session has no temp namespace, so no
--   results table can exist in it under any spelling.
--
-- DO NOT INVENT A FOURTH. An error is the one channel every SQL client
-- displays, and it aborts the transaction, which is the same outcome the
-- ROLLBACK at the foot was always there to produce.
--
-- WHAT THE ERROR LOOKS LIKE. Verdict first, tally second, per-assertion
-- lines last, because a client that truncates a long message truncates
-- the END of it:
--
--     ERROR:  P0001
--     =====================================================
--     SAFE TO APPLY 095.  All 10 assertions passed.
--     =====================================================
--     assertions run  : 10   (expected 10)
--     PASS            : 10   (expected 10)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 10   (must equal assertions run: OK)
--
--     VERDICT         : SAFE TO APPLY 095.
--     -----------------------------------------------------
--       T1  bid_submitted refused pre-fix    PASS   (23514, the defect)
--       ... nine more ...
--     =====================================================
--     This error IS the result. The transaction is rolled back with it.
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 095."        -> and only this - apply it.
--     "DO NOT APPLY 095."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 095 YET."     -> INCONCLUSIVE. Nothing failed, but
--                                    an assertion could not be exercised,
--                                    so the run says NOTHING about the
--                                    thing it was meant to prove. IT IS
--                                    NOT A GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- It is not the expected message and it never was. If you see it, the DO
-- block did not reach its RAISE - most likely the batch was run in pieces
-- or the editor swallowed the error. You have learned nothing about 095
-- and you must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the ALTER TABLE and
-- every INSERT - is inside one transaction, and the RAISE EXCEPTION
-- aborts it. PostgreSQL rolls back DDL, so after this runs the database
-- is byte-identical to before, whether 095 has been applied or not.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 095 IS ALREADY APPLIED. Section A is
-- a DROP IF EXISTS plus an ADD of the same definition, so re-applying is
-- a no-op. The abort restores whatever was there. See RE-RUNNING AFTER
-- APPLYING, below.
--
-- =====================================================================
-- >>> NO ROLE IMPERSONATION IN THIS FILE, AND THAT IS THE ONE THING
-- >>> THAT MAKES IT DIFFERENT FROM 094's. DO NOT ADD IT BACK.
-- =====================================================================
--
-- 094's test set request.jwt.claims and `SET LOCAL ROLE authenticated`
-- around every insert, because 094 changed an RLS POLICY and a policy is
-- only reached by a role that RLS applies to.
--
-- >>> 095 CHANGES A CHECK CONSTRAINT, AND A CHECK CONSTRAINT IS NOT RLS.
-- >>> It applies to EVERY role, including the one the SQL Editor runs as
-- >>> and including the service role. That is the whole reason the two
-- >>> guest-token write sites fail today despite bypassing every policy
-- >>> in the database.
--
-- SO IMPERSONATING `authenticated` HERE WOULD ACTIVELY BREAK THIS TEST.
-- Every insert below addresses a user who is NOT the impersonated
-- caller, so the "Scoped insert notifications" policy would refuse them
-- with 42501 - and 42501 would arrive BEFORE the 23514 this file exists
-- to observe. T1 would report a refusal, look like a PASS, and be
-- measuring the wrong thing entirely. Every post-fix assertion would
-- then FAIL for a reason that has nothing to do with 095.
--
-- RUN IT AS THE EDITOR'S DEFAULT ROLE. RLS does not apply to it, which
-- is exactly what is wanted: it strips the policy out of the picture and
-- leaves the constraint as the only thing that can refuse a write.
--
-- =====================================================================
-- THE TABLE'S REAL SHAPE, QUERIED LIVE 2026-08-25 DURING 094's RUN
-- =====================================================================
--
--   id         uuid        NOT NULL DEFAULT gen_random_uuid()
--   user_id    uuid        NOT NULL, FK profiles ON DELETE CASCADE
--   type       text        NOT NULL   <- the CHECK 095 widens
--   title      text        NOT NULL, NO DEFAULT
--   message    text        NULL
--   link       text        NULL
--   read       boolean     DEFAULT false
--   data       jsonb       DEFAULT '{}'
--   created_at timestamptz DEFAULT now()
--
-- >>> TWO COLUMNS MAKE EVERY INSERT IN THIS FILE NON-TRIVIAL:
--
--   user_id IS NOT NULL AND CARRIES AN FK TO profiles ON DELETE CASCADE.
--   A made-up uuid raises 23503 and a NULL raises 23502, and BOTH would
--   look exactly like a constraint refusal to anyone reading only the
--   tally. So the subject is SELECTED FROM profiles INSIDE THE
--   TRANSACTION rather than hardcoded - a hardcoded id is a row that can
--   be deleted out from under this file between runs.
--
--   title IS NOT NULL WITH NO DEFAULT. Every INSERT below supplies one.
--
-- IF NO PROFILE EXISTS, this file reports INCONCLUSIVE with the reason
-- and does not pretend to a verdict. It does NOT invent a uuid.
--
-- ---------------------------------------------------------------------
-- WHAT THE CONSTRAINT SAYS TODAY
-- ---------------------------------------------------------------------
--
-- notifications_type_check PERMITS EXACTLY EIGHT VALUES:
--
--   partnership_invitation   partnership_accepted   project_assignment
--   project_accepted         project_declined       new_message
--   document_uploaded        project_awarded
--
-- lib/notifications.ts DECLARES ELEVEN. The three missing are
-- partnership_declined, onboarding_deployed and bid_submitted, and six
-- write sites emit them. See OPEN-M,
-- docs/refusals-and-notifications-report.md:519-549.
--
-- THE TABLE HELD 15 ROWS ON 2026-08-25, in three types:
--   partnership_accepted 7,  project_awarded 4,  project_assignment 4.
--
-- All three are inside the eight being kept, which is why T4 below can
-- predict that ADD CONSTRAINT will validate. T4 is the assertion that
-- actually decides that, not the row count in T3.
--
-- =====================================================================
-- THREE WAYS THIS RUN CAN END, AND ONLY ONE OF THEM IS A VERDICT
-- =====================================================================
--
-- (1) AN ERROR WITH THE ===== BANNER AND A TALLY.  That is the report.
--     Read the headline.
--
-- (2) AN ERROR SAYING "NO SUBJECT: ...".  THAT IS NOT A CRASH AND IT IS
--     NOT A BUG IN THIS FILE. It is the file refusing to report a
--     verdict it cannot support: public.profiles is empty, so there is
--     no legal user_id anywhere and not one insert below could be
--     attempted. The transaction is aborted and nothing persists.
--
-- (3) AN ERROR WITHOUT THE BANNER AND WITHOUT A TALLY, AND NOT THE
--     REFUSAL ABOVE.  A raw SQLSTATE and a one-line message. THAT IS A
--     FAILURE OF THIS TEST FILE AND IT IS NOT A VERDICT ON 095 IN
--     EITHER DIRECTION. Fix it and re-run until you get a banner.
--
-- =====================================================================
-- HOW TO READ IT. AN ERROR IS A PASS FOR TWO OF THESE TEN.
-- =====================================================================
--
--   -- before section A: the live constraint --
--
--   T1  THE DEFECT, DEMONSTRATED. Insert type 'bid_submitted'. PASS =
--       the write was REFUSED (23514). A SUCCESS here means the live
--       constraint already permits it and 095 has nothing to widen -
--       reported INCONCLUSIVE, not PASS, because the rest of the file
--       then proves nothing you needed. THAT IS ALSO THE EXPECTED
--       RESULT ON A RE-RUN AFTER APPLYING. See RE-RUNNING, below.
--
--   T2  THE HARNESS WORKS. Insert type 'partnership_accepted', which
--       the live constraint permits and the table already holds seven
--       of. PASS = the write SUCCEEDED. This is the control. Without
--       it, T1's refusal could just as easily mean the subject user_id
--       is bad, or title is being omitted, or the table is not writable
--       at all - in which case T1 proves nothing.
--
--   T3  THE ROW COUNT THE MIGRATION EXPECTED. PASS = 15. A DIFFERENT
--       COUNT IS REPORTED, NOT ASSUMED WRONG: rows may legitimately
--       have arrived since 2026-08-25, and after 095 lands five write
--       sites start adding them. Reported INCONCLUSIVE with the actual
--       number so the migration's header can be corrected, never FAIL.
--       >>> T3 IS NOT THE SAFETY CHECK. T4 IS.
--
--   T4  >>> THE ASSERTION THAT DECIDES WHETHER 095 CAN APPLY AT ALL.
--       ADD CONSTRAINT validates every existing row. This counts rows
--       whose type is OUTSIDE the new eleven. PASS = 0. Any other
--       number and 095's ADD CONSTRAINT will raise 23514 against real
--       data and the migration will abort - which is safe, but means it
--       does not apply. A FAIL here names the offending types.
--
--   -- section A applies 095 here --
--
--   T5  partnership_declined now inserts.   PASS = 1 row.
--   T6  onboarding_deployed now inserts.    PASS = 1 row.
--   T7  bid_submitted now inserts.          PASS = 1 row.
--       >>> T7 IS THE ONE THE PRODUCT CARES ABOUT. It is the type
--       behind "an agency is told in-app that a bid landed".
--       A FAIL on any of T5-T7 means 095 does not do the thing it
--       exists to do. DO NOT APPLY.
--
--   T8  THE WIDENING HAS A BOUNDARY. Insert a garbage type. PASS = the
--       write was REFUSED (23514). A SUCCESS here means the DROP took
--       and the ADD did not, and the column is now unconstrained text.
--       >>> A WIDENING THAT ACCEPTS ANYTHING IS NOT A WIDENING, IT IS A
--       >>> REMOVAL, AND NOTHING ELSE IN THIS FILE WOULD NOTICE. Every
--       >>> other assertion passes just as happily against no constraint
--       >>> at all. T8 is the only one that can tell the difference.
--
--   T9  THE EIGHT THAT ALREADY WORKED STILL WORK. Inserts all eight
--       previously-permitted types, one at a time. PASS = 8 of 8. This
--       is the regression assertion: 095 DROPs the constraint before it
--       ADDs, so a typo in the new list silently stops the product's
--       existing notifications rather than starting new ones. A FAIL
--       names which of the eight were lost.
--
--   T10 THE CONSTRAINT DEFINITION HOLDS ALL ELEVEN, read back out of
--       pg_get_constraintdef(). PASS = all eleven present by name. The
--       structural mirror of T5-T9: those prove behaviour one insert at
--       a time, this reads what the database says it will accept.
--
-- =====================================================================
-- RE-RUNNING AFTER APPLYING 095
-- =====================================================================
--
-- Run this file again after 095 is applied and T1 FLIPS from PASS to
-- INCONCLUSIVE: the bid_submitted insert it expects to be refused will
-- succeed, because the fix is live. THAT FLIP IS THE PROOF THE APPLY
-- LANDED, and it is the only assertion that is supposed to change. The
-- headline will read "DO NOT APPLY 095 YET" on that run, which is
-- correct and means nothing - 095 is already applied. Read the T1 line,
-- not the headline, on a post-apply run.
-- =====================================================================


BEGIN;


-- =====================================================================
-- THE ASSERTIONS.
--
-- One DO block, ten assertions, section A applied in the middle of it.
-- T1-T4 must run against the LIVE constraint and T5-T10 against the NEW
-- one, and both halves need the same subject row resolved once.
-- =====================================================================
DO $test$
DECLARE
  v_subject      uuid;
  v_rows         integer;
  v_count        integer;
  v_bad          integer;
  v_bad_types    text;
  v_check        text;
  v_missing      text := '';
  v_lost         text := '';
  v_ok8          integer := 0;
  v_t            text;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_ran          integer := 0;
  v_verdict_text text;
  -- THE ACCUMULATOR AND ITS COUNTER. v_lines holds one line per assertion,
  -- appended in the order the assertions run. v_logged counts them and is
  -- checked against v_ran at the foot - see THE SELF-CHECK there.
  v_lines        text := '';
  v_logged       integer := 0;
  v_headline     text;
  v_report       text;
  -- The eight the constraint permits TODAY. T9 walks this array.
  v_eight        text[] := ARRAY[
                    'partnership_invitation','partnership_accepted','project_assignment',
                    'project_accepted','project_declined','new_message',
                    'document_uploaded','project_awarded'];
  -- All eleven, after 095. T4 and T10 walk this one.
  v_eleven       text[] := ARRAY[
                    'partnership_invitation','partnership_accepted','project_assignment',
                    'project_accepted','project_declined','new_message',
                    'document_uploaded','project_awarded',
                    'partnership_declined','onboarding_deployed','bid_submitted'];
BEGIN
  -- -------------------------------------------------------------------
  -- THE SUBJECT. A REAL user_id. notifications.user_id is NOT NULL with
  -- an FK to profiles ON DELETE CASCADE, so a made-up uuid raises 23503
  -- and would be indistinguishable from a constraint refusal in the
  -- tally. Selected here, inside the transaction, rather than hardcoded:
  -- a hardcoded id is a row somebody can delete between runs.
  --
  -- ORDER BY id makes the choice deterministic, so a re-run uses the
  -- same person and any leftover the abort somehow failed to remove is
  -- found in one place.
  -- -------------------------------------------------------------------
  SELECT id INTO v_subject FROM public.profiles ORDER BY id LIMIT 1;

  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'NO SUBJECT: public.profiles is empty, so there is no legal value for notifications.user_id (NOT NULL, FK to profiles) and not one assertion in this file could be attempted. This says NOTHING about 095 in either direction. INCONCLUSIVE - do not apply on the strength of this run.';
  END IF;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE '095 PRE-APPLY TEST   notifications_type_check';
  RAISE NOTICE 'subject user_id : %', v_subject;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '-- T1-T4: THE LIVE CONSTRAINT, BEFORE 095. --';

  -- ===================================================================
  -- T1. THE DEFECT. 'bid_submitted' against the LIVE constraint.
  -- PASS = REFUSED with 23514. This is the whole premise of 095, and
  -- bid_submitted is chosen over the other two because it is the type
  -- behind the user-visible change the migration is for.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (v_subject, 'bid_submitted', '095 test T1', 'pre-fix bid_submitted write');
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- Reaching here means the write was NOT refused.
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T1  bid_submitted, pre-fix', 38) || rpad('INCONCLUSIVE', 14) || format('write SUCCEEDED (%s row). The live constraint ALREADY permits bid_submitted, so 095 has nothing to widen and the assertions below prove nothing you needed. IF 095 IS ALREADY APPLIED, THIS IS THE EXPECTED RESULT - read this line, not the headline.', v_rows);
    v_inconc := v_inconc + 1;
  EXCEPTION
    WHEN check_violation THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  bid_submitted, pre-fix', 38) || rpad('PASS', 14) || '23514 refused - the defect 095 exists to fix, demonstrated on the live constraint';
      v_pass := v_pass + 1;
    WHEN not_null_violation OR foreign_key_violation THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  bid_submitted, pre-fix', 38) || rpad('INCONCLUSIVE', 14) || format('%s, NOT a constraint answer. The subject row or the column list is wrong, not the type. Fix the harness and re-run.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  bid_submitted, pre-fix', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T2. THE CONTROL. A type the live constraint permits, and which the
  -- table already holds seven of. PASS = SUCCEEDS. Without this, T1's
  -- refusal is ambiguous between "the constraint refused the type" and
  -- "this file cannot write to this table at all".
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (v_subject, 'partnership_accepted', '095 test T2', 'pre-fix control write');
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  permitted type (control)', 38) || rpad('PASS', 14) || '1 row written - the table is writable and the subject user_id is legal, so T1''s refusal is about the TYPE';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  permitted type (control)', 38) || rpad('FAIL', 14) || format('wrote %s rows, expected 1', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  permitted type (control)', 38) || rpad('INCONCLUSIVE', 14) || format('%s on a type the constraint PERMITS: %s. This file cannot write to notifications at all, so EVERY ASSERTION HERE IS MEANINGLESS, INCLUDING T1.', SQLSTATE, SQLERRM);
      v_inconc := v_inconc + 1;
  END;

  -- ===================================================================
  -- T3. THE ROW COUNT THE MIGRATION EXPECTED.
  --
  -- Counted BEFORE section A and AFTER T1/T2, so the two probe rows T1
  -- and T2 may have added are subtracted back out - T2 always adds one,
  -- T1 adds one only in the already-applied case. Getting this wrong
  -- would make the count look like it drifted when it had not.
  --
  -- NEVER FAILS. A different count is information, not a defect: rows
  -- may legitimately have arrived since 2026-08-25, and after 095 lands
  -- five write sites start adding them. T4 is the safety check.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    SELECT count(*) INTO v_count
    FROM public.notifications
    WHERE title NOT IN ('095 test T1', '095 test T2');

    IF v_count = 15 THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  row count', 38) || rpad('PASS', 14) || '15 rows, exactly what 095''s header states. Validation on ADD CONSTRAINT is trivial at this size.';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  row count', 38) || rpad('INCONCLUSIVE', 14) || format('%s rows, not the 15 in 095''s header. NOT A REASON NOT TO APPLY - see T4, which is what actually decides whether ADD CONSTRAINT validates. Correct the number in 095''s header and in the report.', v_count);
      v_inconc := v_inconc + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  row count', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T4. >>> THE ASSERTION THAT DECIDES WHETHER 095 CAN APPLY AT ALL.
  --
  -- ADD CONSTRAINT validates every existing row. If any row holds a type
  -- outside the new eleven, 095's ADD raises 23514 against real data and
  -- the whole migration aborts. Safe, but it does not apply, and finding
  -- that out here costs nothing while finding it out in the SQL Editor
  -- costs a confusing error on a live table.
  --
  -- The probe rows from T1/T2 are excluded: they hold types that are in
  -- the eleven anyway, but excluding them keeps this counting REAL data.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    SELECT count(*), coalesce(string_agg(DISTINCT type, ', '), '')
      INTO v_bad, v_bad_types
    FROM public.notifications
    WHERE title NOT IN ('095 test T1', '095 test T2')
      AND type <> ALL (v_eleven);

    IF v_bad = 0 THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4  existing rows all in the 11', 38) || rpad('PASS', 14) || '0 rows hold a type outside the new eleven, so ADD CONSTRAINT validates and 095 applies cleanly';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4  existing rows all in the 11', 38) || rpad('FAIL', 14) || format('%s row(s) hold a type OUTSIDE the new eleven: %s. 095''s ADD CONSTRAINT WILL RAISE 23514 AND THE MIGRATION WILL ABORT. Either add these types to 095''s list or clean the rows. DO NOT APPLY until this is 0.', v_bad, v_bad_types);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4  existing rows all in the 11', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- SECTION A. APPLY 095. Identical to the executable body of
  -- supabase/migrations/095_notification_types.sql. If you change one,
  -- change the other - nothing checks that they agree.
  --
  -- INSIDE THE SAME TRANSACTION AS THE ASSERTIONS, so the RAISE at the
  -- foot rolls it back with everything else. PostgreSQL rolls back DDL.
  -- ===================================================================
  RAISE NOTICE '-- SECTION A: applying 095 inside the transaction --';

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

  RAISE NOTICE '-- T5-T10: THE NEW CONSTRAINT. --';

  -- ===================================================================
  -- T5, T6, T7. THE THREE NEW TYPES NOW INSERT.
  -- One assertion each, so a partial failure names which one.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title)
    VALUES (v_subject, 'partnership_declined', '095 test T5');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_logged := v_logged + 1;
    IF v_rows = 1 THEN
      v_lines := v_lines || E'\n  ' || rpad('T5  partnership_declined, post', 38) || rpad('PASS', 14) || '1 row - the CHECK now accepts it. NOTE: this type is still refused by RLS on the session client (094''s counterparty arm is active-only), so site #4 stays silent. That is expected, not a defect. See 095''s header.';
      v_pass := v_pass + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T5  partnership_declined, post', 38) || rpad('FAIL', 14) || format('wrote %s rows, expected 1', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  partnership_declined, post', 38) || rpad('FAIL', 14) || format('%s: %s - 095 did not widen for this type. DO NOT APPLY.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  v_ran := v_ran + 1;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title)
    VALUES (v_subject, 'onboarding_deployed', '095 test T6');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_logged := v_logged + 1;
    IF v_rows = 1 THEN
      v_lines := v_lines || E'\n  ' || rpad('T6  onboarding_deployed, post', 38) || rpad('PASS', 14) || '1 row - sites #8 and #9 start telling a vendor their onboarding package arrived';
      v_pass := v_pass + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T6  onboarding_deployed, post', 38) || rpad('FAIL', 14) || format('wrote %s rows, expected 1', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  onboarding_deployed, post', 38) || rpad('FAIL', 14) || format('%s: %s - 095 did not widen for this type. DO NOT APPLY.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  v_ran := v_ran + 1;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title)
    VALUES (v_subject, 'bid_submitted', '095 test T7');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_logged := v_logged + 1;
    IF v_rows = 1 THEN
      v_lines := v_lines || E'\n  ' || rpad('T7  bid_submitted, post  <-KEY', 38) || rpad('PASS', 14) || '1 row - AN AGENCY STARTS BEING TOLD IN-APP THAT A BID LANDED. Sites #11, #12, #13. This is the user-visible point of the whole migration.';
      v_pass := v_pass + 1;
    ELSE
      v_lines := v_lines || E'\n  ' || rpad('T7  bid_submitted, post  <-KEY', 38) || rpad('FAIL', 14) || format('wrote %s rows, expected 1', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  bid_submitted, post  <-KEY', 38) || rpad('FAIL', 14) || format('%s: %s - 095 does not do the thing it exists to do. DO NOT APPLY.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T8. >>> THE BOUNDARY. A GARBAGE TYPE MUST STILL BE REFUSED.
  --
  -- THE ONLY ASSERTION IN THIS FILE THAT CAN TELL A WIDENED CONSTRAINT
  -- FROM NO CONSTRAINT AT ALL. If the DROP took and the ADD silently did
  -- not, T5, T6, T7, T9 and every insert the product ever makes all
  -- succeed exactly as they do now, and nothing raises anywhere, ever.
  -- The error here is the pass.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title)
    VALUES (v_subject, 'definitely_not_a_real_type_095', '095 test T8');
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- Reaching here is the failure case.
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T8  garbage type still refused', 38) || rpad('FAIL', 14) || format('THE GARBAGE TYPE WAS ACCEPTED (%s row). The DROP took and the ADD did not - notifications.type is now UNCONSTRAINED TEXT. A widening that accepts anything is a REMOVAL. DO NOT APPLY.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN check_violation THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  garbage type still refused', 38) || rpad('PASS', 14) || '23514 refused - the widened constraint still ENUMERATES. It admits eleven values, not anything.';
      v_pass := v_pass + 1;
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  garbage type still refused', 38) || rpad('INCONCLUSIVE', 14) || format('%s rather than 23514: %s. The write was refused, but not by the CHECK, so this says nothing about the constraint.', SQLSTATE, SQLERRM);
      v_inconc := v_inconc + 1;
  END;

  -- ===================================================================
  -- T9. THE REGRESSION ASSERTION. All EIGHT previously permitted types
  -- must still insert.
  --
  -- 095 DROPS the constraint before it ADDS one. A typo or an omission
  -- in the new list does not break the three new types - it breaks the
  -- EIGHT THAT ALREADY WORK, silently stopping notifications the product
  -- sends today. That is a bigger regression than the bug 095 fixes, and
  -- this is the only assertion looking for it.
  --
  -- Each insert gets its own subtransaction so one failure does not
  -- abort the rest and hide which others would have worked.
  -- ===================================================================
  v_ran := v_ran + 1;
  FOREACH v_t IN ARRAY v_eight LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title)
      VALUES (v_subject, v_t, '095 test T9');
      v_ok8 := v_ok8 + 1;
    EXCEPTION
      WHEN OTHERS THEN
        v_lost := v_lost || CASE WHEN v_lost = '' THEN '' ELSE ', ' END || v_t || ' (' || SQLSTATE || ')';
    END;
  END LOOP;

  v_logged := v_logged + 1;
  IF v_ok8 = 8 THEN
    v_lines := v_lines || E'\n  ' || rpad('T9  the 8 existing types survive', 38) || rpad('PASS', 14) || '8 of 8 still insert - the DROP/ADD widened the list rather than replacing it';
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('T9  the 8 existing types survive', 38) || rpad('FAIL', 14) || format('only %s of 8 still insert. LOST: %s. 095 would BREAK notifications that work today - a worse regression than the bug it fixes. DO NOT APPLY.', v_ok8, v_lost);
    v_fail := v_fail + 1;
  END IF;

  -- ===================================================================
  -- T10. THE STRUCTURAL MIRROR. Read the constraint definition back out
  -- of the catalog and confirm all eleven literals are in it by name.
  --
  -- T5-T9 prove behaviour one insert at a time. This reads what the
  -- database SAYS it will accept, which is the same thing V1 in the
  -- migration's verification block asks a human to eyeball.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    SELECT pg_get_constraintdef(oid) INTO v_check
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype  = 'c'
      AND conname  = 'notifications_type_check';

    IF v_check IS NULL THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T10 definition holds all 11', 38) || rpad('FAIL', 14) || 'no constraint named notifications_type_check exists after section A. The DROP took and the ADD did not. DO NOT APPLY.';
      v_fail := v_fail + 1;
    ELSE
      FOREACH v_t IN ARRAY v_eleven LOOP
        IF position('''' || v_t || '''' IN v_check) = 0 THEN
          v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || v_t;
        END IF;
      END LOOP;

      v_logged := v_logged + 1;
      IF v_missing = '' THEN
        v_lines := v_lines || E'\n  ' || rpad('T10 definition holds all 11', 38) || rpad('PASS', 14) || 'all eleven literals present in pg_get_constraintdef()';
        v_pass := v_pass + 1;
      ELSE
        v_lines := v_lines || E'\n  ' || rpad('T10 definition holds all 11', 38) || rpad('FAIL', 14) || format('MISSING from the definition: %s. DO NOT APPLY.', v_missing);
        v_fail := v_fail + 1;
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T10 definition holds all 11', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- THE VERDICT.
  -- ===================================================================
  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 10 AND v_pass = 10 THEN
    v_verdict_text := 'SAFE TO APPLY 095.';
    v_headline     := format('SAFE TO APPLY 095.  All %s assertions passed.', v_pass);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised - read the INCONCLUSIVE line below. Settle it before applying.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing FAILED,
    -- but something 095 exists to do was never actually attempted, so this
    -- run says nothing at all about it. The one benign case is a re-run
    -- against an ALREADY-APPLIED 095, where T1 is inconclusive by
    -- construction - read the T1 line before acting on this headline.
    v_headline     := format('DO NOT APPLY 095 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 095 does what it claims. It is not a green light. (If 095 is ALREADY APPLIED, T1 is inconclusive by construction and this headline is expected - read the T1 line.)', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 095.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. If an assertion ran without
  -- logging a line, the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE. That has to outrank SAFE TO
  -- APPLY, so it is applied after the condition above rather than folded
  -- into it.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 095.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything, INCLUDING A CLEAN ONE.', v_ran, v_logged);
  END IF;

  -- =================================================================
  -- THE REPORT.
  --
  -- ORDER IS LOAD-BEARING: HEADLINE, THEN TALLY, THEN THE PER-ASSERTION
  -- LINES. A client that truncates a long error message truncates the
  -- END of it, so the verdict and the counts must be at the TOP where
  -- they survive. The 10 detail lines are the part that can afford to be
  -- cut off - if they are, the tally still says how many failed and the
  -- headline still says whether to apply.
  -- =================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 10)\n', v_ran)
    || format(E'PASS            : %s   (expected 10)\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n',  v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n',  v_inconc)
    -- THE SELF-CHECK, IN THE OUTPUT RATHER THAN INFERRED FROM IT. v_ran is
    -- incremented by the assertions themselves and v_logged by the report
    -- sites, so the two numbers are counted independently. Equal means every
    -- assertion that ran also reported. Unequal means a report site was
    -- missed and the lines below are incomplete - which is why it overrides
    -- the headline above rather than sitting quietly in a footnote.
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n',
              v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || E'\n'
    || format(E'subject user_id : %s\n', v_subject)
    || format(E'rows before     : %s   (095''s header states 15)\n', v_count)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  -- >>> THE RESULT ARRIVES AS AN ERROR, AND THAT IS THE DESIGN. <<<
  --
  -- NO CUSTOM ERRCODE. This is not a database condition and must never be
  -- mistaken for one of the LG0xx codes 089, 090, 091 and 092 define. The
  -- default P0001 (raise_exception) is correct and deliberate.
  RAISE EXCEPTION '%', v_report;
END
$test$;


-- =====================================================================
-- THE BACKSTOP. IT STAYS.
--
-- IT IS NOT REACHED ON THE EXPECTED PATH. The DO block above ends in
-- RAISE EXCEPTION, and the outer block has no handler, so the exception
-- propagates out, aborts the transaction, and every statement after it -
-- including this one - is skipped.
--
-- IT IS NOT DEAD CODE AND MUST NOT BE DELETED. It is the safety net for
-- the case where that exception is CAUGHT rather than propagated: an
-- enclosing EXCEPTION handler added here later, or a client that wraps
-- the batch in its own block and swallows the error. In that case the
-- transaction is still open and still holds AN ALTER TABLE THAT REPLACED
-- A CHECK CONSTRAINT ON A LIVE TABLE and roughly fourteen real
-- notifications rows addressed to a real person, and this line is the
-- only thing that undoes them.
--
-- >>> THOSE ROWS ARE THE PART PEOPLE UNDERESTIMATE. They are addressed
-- >>> to whichever profile sorted first, they say "095 test T5", and if
-- >>> they survive they appear in that person's notification bell. The
-- >>> constraint change would be the more serious leftover, but the rows
-- >>> are the one somebody would actually see.
-- =====================================================================
ROLLBACK;
