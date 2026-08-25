-- =====================================================================
-- 094 PRE-APPLY TEST. ONE PASTE. WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 094 proves the file parses. It says NOTHING about whether
-- a colleague is actually refused today, whether the new arm actually
-- admits them, whether the counterparty arm survived the ALTER, or -
-- the one that matters most - whether widening the WRITE side has left
-- the READ side alone.
--
-- >>> 094 WIDENS AN RLS POLICY. That is the one class of change where
-- >>> "it applied without error" is worth nothing at all. A policy that
-- >>> is too permissive raises no error, breaks no page and shows no red
-- >>> state anywhere. The only way to find out what it admits is to try
-- >>> to write things through it and see which ones land. That is what
-- >>> the nine assertions below do.
--
-- IT PROVES THE DEFECT BEFORE IT PROVES THE FIX. T1 and T2 run against
-- the LIVE policy, before section A applies anything. If T1 does not
-- show a colleague being refused, the premise of the whole migration is
-- wrong and you should not apply it on the strength of the later
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
-- WHY IT HAS TO BE AN ERROR. This is the third mechanism, and the first
-- two were dead ends against this exact client - established in
-- docs/091-preapply-test.sql, re-used unchanged by 092, and not
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
--     SAFE TO APPLY 094.  All 9 assertions passed.
--     =====================================================
--     assertions run  : 9    (expected 9)
--     PASS            : 9    (expected 9)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 9    (must equal assertions run: OK)
--
--     VERDICT         : SAFE TO APPLY 094.
--     -----------------------------------------------------
--       T1  colleague INSERT refused today   PASS   (42501, the defect)
--       ... eight more ...
--     =====================================================
--     This error IS the result. The transaction is rolled back with it.
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 094."        -> and only this - apply it.
--     "DO NOT APPLY 094."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 094 YET."     -> INCONCLUSIVE. Nothing failed, but
--                                    an assertion could not be exercised,
--                                    so the run says NOTHING about the
--                                    thing it was meant to prove. IT IS
--                                    NOT A GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- It is not the expected message and it never was. If you see it, the DO
-- block did not reach its RAISE - most likely the batch was run in pieces
-- or the editor swallowed the error. You have learned nothing about 094
-- and you must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the CREATE FUNCTION,
-- the ALTER POLICY, the REVOKEs and every INSERT - is inside one
-- transaction, and the RAISE EXCEPTION aborts it. PostgreSQL rolls back
-- DDL, so after this runs the database is byte-identical to before,
-- whether 094 has been applied or not.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 094 IS ALREADY APPLIED. The function
-- is CREATE OR REPLACE and the policy change is an ALTER to the same
-- predicate, so re-applying is a no-op. The abort restores whatever was
-- there. See the note on T1 under RE-RUNNING AFTER APPLYING, below.
--
-- =====================================================================
-- THE TABLE'S REAL SHAPE, QUERIED LIVE 2026-08-25. THE FIRST RUN OF THIS
-- FILE FAILED ON IT, AND THE FINDING IS BIGGER THAN THE TEST.
-- =====================================================================
--
-- The first run returned DO NOT APPLY with 3 FAIL and 1 INCONCLUSIVE, and
-- ALL FOUR WERE ONE CAUSE: 23514, notifications_type_check. The inserts
-- below used 'bid_submitted', WHICH THE LIVE CONSTRAINT DOES NOT PERMIT.
--
-- >>> THE POLICY LOGIC ITSELF PASSED ON THAT RUN. T1 demonstrated the
-- >>> defect, T4 proved the widening stops at the caller's own
-- >>> organization, T7 confirmed the ALTER extended the predicate rather
-- >>> than replacing it, and T8/T9 confirmed helper shape, grants and an
-- >>> unchanged policy count of 117. Nothing about 094 was wrong. The
-- >>> test was writing a row the table refuses.
--
-- T5 AND T6 WERE CONTAMINATED, NOT INDEPENDENT FAILURES. T3's insert
-- never landed, so there was no row for T6 to read and its zero was
-- correct behaviour rather than a defect. Do not chase them separately.
--
-- THE INSERTS NOW USE 'partnership_accepted'. It is permitted, and it is
-- already present in the table seven times, so it cannot be refused for
-- any reason this file does not control.
--
-- THE COLUMN SHAPE, nine columns:
--   id         uuid        NOT NULL DEFAULT gen_random_uuid()
--   user_id    uuid        NOT NULL, FK profiles ON DELETE CASCADE
--   type       text        NOT NULL   <- the CHECK below
--   title      text        NOT NULL, NO DEFAULT
--   message    text        NULL
--   link       text        NULL
--   read       boolean     DEFAULT false
--   data       jsonb       DEFAULT '{}'
--   created_at timestamptz DEFAULT now()
--
-- >>> title IS NOT NULL WITH NO DEFAULT. Every INSERT in this file
-- >>> supplies one. An insert that omits it is a second 23502 waiting
-- >>> behind the first, and it would look exactly like a policy refusal
-- >>> to anyone reading only the tally.
--
-- ---------------------------------------------------------------------
-- WHAT THE CONSTRAINT SAYS ABOUT THE PRODUCT, WHICH IS THE PART THAT
-- OUTLIVES THIS FILE
-- ---------------------------------------------------------------------
--
-- notifications_type_check PERMITS EXACTLY EIGHT VALUES:
--
--   partnership_invitation   partnership_accepted   project_assignment
--   project_accepted         project_declined       new_message
--   document_uploaded        project_awarded
--
-- THE TABLE CONTAINS THREE:
--   partnership_accepted 7,  project_awarded 4,  project_assignment 4.
--
-- TWO CONSEQUENCES, AND THE SECOND ONE IS NOT ABOUT THIS FILE AT ALL.
--
-- (1) FIVE PERMITTED TYPES HAVE NEVER BEEN WRITTEN -
--     partnership_invitation, project_accepted, project_declined,
--     new_message, document_uploaded. Three different reasons, set out
--     as OPEN-L in docs/refusals-and-notifications-report.md.
--
-- (2) >>> lib/notifications.ts DECLARES ELEVEN TYPES AND THREE OF THEM
--     >>> ARE NOT IN THE CONSTRAINT AT ALL: partnership_declined,
--     >>> onboarding_deployed, bid_submitted. Six of the sixteen write
--     >>> sites emit those three, and every one of them raises 23514 and
--     >>> writes NOTHING - including the two guest-token sites, because a
--     >>> CHECK constraint is not RLS and the service role does not
--     >>> bypass it. That is how this file found it: it copied a type
--     >>> straight out of the product's own type union and the table
--     >>> refused it. Recorded as OPEN-M. NOT FIXED HERE - it is neither
--     >>> 094's business nor a test's.
--
-- =====================================================================
-- THREE WAYS THIS RUN CAN END, AND ONLY ONE OF THEM IS A VERDICT
-- =====================================================================
--
-- (1) AN ERROR WITH THE ===== BANNER AND A TALLY.  That is the report.
--     Read the headline.
--
-- (2) AN ERROR SAYING "NO SUBJECT: ...".  THAT IS NOT A CRASH AND IT IS
--     NOT A BUG IN THIS FILE. It is section B refusing to report a
--     verdict it cannot support:
--
--       "no organization has two members"
--           There is no colleague anywhere to test with, so the central
--           assertion could not be exercised even in principle. 094 is
--           not WRONG in that state, it is INERT. Establish why - as of
--           2026-08-25 `markant` has two - before applying.
--
--       "no unrelated user exists"
--           Every user in the database is either a colleague or an active
--           counterparty of the subject, so "must still refuse a
--           stranger" has no stranger to refuse. DO NOT APPLY on this
--           run; it cannot show the widening has a boundary.
--
--     In both cases the transaction is aborted and nothing persists.
--
-- (3) AN ERROR WITHOUT THE BANNER AND WITHOUT A TALLY, AND NOT ONE OF
--     THE REFUSALS ABOVE.  A raw SQLSTATE and a one-line message. THAT
--     IS A FAILURE OF THIS TEST FILE AND IT IS NOT A VERDICT ON 094 IN
--     EITHER DIRECTION. Fix the escaping raise and re-run until you get
--     a banner.
--
-- =====================================================================
-- HOW TO READ IT. AN ERROR IS A PASS FOR THREE OF THESE NINE.
-- =====================================================================
--
--   T1  THE DEFECT, DEMONSTRATED. Before anything is applied: the owner
--       inserts a notification addressed to a COLLEAGUE in their own
--       organization. PASS = the write was REFUSED (42501). A SUCCESS
--       here means the live policy already admits colleagues and 094 has
--       nothing to fix - reported INCONCLUSIVE, not PASS, because the
--       rest of the file then proves nothing you needed.
--
--   T2  THE HARNESS WORKS. Before anything is applied: the same owner
--       inserts a notification addressed to THEMSELVES. PASS = the write
--       SUCCEEDED. This is the control. Without it, a T1 refusal could
--       just as easily mean the impersonation never took and EVERY write
--       is being refused - in which case T1 proves nothing at all.
--
--   -- section A applies 094 here --
--
--   T3  >>> THE ASSERTION THE WHOLE MIGRATION IS FOR. <<< The owner
--       inserts a notification addressed to the same COLLEAGUE. PASS =
--       the write SUCCEEDED, 1 row. A FAIL here means 094 does not do
--       the one thing it exists to do. DO NOT APPLY.
--
--   T4  THE WIDENING HAS A BOUNDARY, ON THE WRITE SIDE. The owner
--       inserts a notification addressed to a user who is NEITHER a
--       colleague NOR a member of any active counterparty. PASS = the
--       write was REFUSED (42501). A SUCCESS here means the new arm is
--       far wider than "my own organization" and 094 has opened the
--       table to everybody. DO NOT APPLY.
--
--   T5  >>> A COLLEAGUE CANNOT SEE ANOTHER ORGANIZATION'S NOTIFICATION.
--       The row T4 could not write is written on the OWNER'S privileges
--       via a direct insert with RLS off, addressed to the unrelated
--       user. Then the COLLEAGUE is impersonated and selects it. PASS =
--       0 rows visible. THIS IS THE ASSERTION THAT SAYS 094 DID NOT
--       TURN AN INSERT FIX INTO A READ LEAK. A non-zero count here means
--       the SELECT policy has been touched by something and this file
--       must not be applied.
--
--   T6  THE READ TEST IS NOT TRIVIALLY EMPTY. The same colleague selects
--       the notification T3 wrote TO THEM. PASS = exactly 1 row visible.
--       Without this, T5 passing could simply mean the colleague cannot
--       read anything at all, or that the impersonation failed, and a
--       test that passes because nothing works is worse than no test.
--
--   T7  THE COUNTERPARTY ARM SURVIVED THE ALTER. READ-ONLY, straight out
--       of pg_policies. PASS = the live with_check text contains
--       current_user_active_counterparty_user_ids. A FAIL means the
--       ALTER REPLACED the predicate rather than extending it, and every
--       cross-company notification in the product has just stopped -
--       silently, because those failures are caught and logged.
--
--   T8  THE FUNCTION'S SHAPE AND ITS GRANTS. READ-ONLY. PASS = SETOF
--       uuid, SECURITY DEFINER, search_path set, and `anon` holds no
--       EXECUTE. SECURITY INVOKER would make the helper read org_members
--       as the caller, whose only SELECT policy there is self-row-only,
--       so it would return just the caller and 094 would look applied
--       while changing nothing.
--
--   T9  THE POLICY COUNT DID NOT MOVE. READ-ONLY. PASS = the count
--       before section A equals the count after it. ALTER POLICY creates
--       and drops nothing; a change means a DROP/CREATE crept in.
--
-- EVERY REFUSAL TEST RUNS IN ITS OWN plpgsql SUBTRANSACTION, so an
-- expected 42501 does not abort the run. That is what lets all nine
-- assertions report from a single paste.
--
-- =====================================================================
-- THE ORDER OF T5 AND T6 IS LOAD-BEARING. DO NOT SWAP THEM.
-- =====================================================================
--
-- T6 asserts the colleague CAN see the row T3 wrote. T5 asserts the
-- colleague CANNOT see a row belonging to a stranger. Both impersonate
-- the colleague, and T5 must run FIRST while the only rows in play are
-- the ones this file put there deliberately.
--
-- More important: T5's row is inserted with RLS BYPASSED, on purpose. It
-- has to be, because the point of T5 is to ask what a colleague can READ,
-- and if the row could only exist when some policy permitted writing it,
-- T5 would be testing the INSERT policy a second time instead of the
-- SELECT policy once.
--
-- =====================================================================
-- RE-RUNNING AFTER APPLYING. THE ONE EXPECTED DIFFERENCE.
-- =====================================================================
--
-- Run this file again after 094 is applied and T1 will flip from PASS to
-- INCONCLUSIVE: the colleague insert it expects to be refused will
-- succeed, because the fix is live. THAT FLIP IS THE PROOF THE APPLY
-- LANDED, and it is the only assertion that is supposed to change. The
-- headline will read "DO NOT APPLY 094 YET" on that run, which is
-- correct and means nothing - 094 is already applied. Read the T1 line,
-- not the headline, on a post-apply run.
--
-- =====================================================================
-- TWO IMPLEMENTATION NOTES, BOTH DELIBERATE, BOTH INHERITED FROM 092
-- =====================================================================
--
--   BOTH JWT GUCs ARE SET, not one. Supabase's auth.uid() has shipped in
--   two forms across its history - one reading request.jwt.claim.sub, one
--   reading request.jwt.claims ->> 'sub'. Setting only the form this
--   session guessed at would leave auth.uid() NULL, every insert would be
--   refused, and T1 would report PASS against a policy that is in fact
--   never reached. T2 is the control that catches exactly that.
--
--   IF YOUR EDITOR REJECTS `SET LOCAL ROLE authenticated` inside the DO
--   block, replace every occurrence with
--   `PERFORM set_config('role', 'authenticated', true);` and every
--   `RESET ROLE;` with `PERFORM set_config('role', 'none', true);`.
--   They are equivalent - `role` is an ordinary GUC - and the set_config
--   form goes through a function call rather than plpgsql's utility
--   statement handling.
--
-- OUTCOMES THAT ARE NEITHER PASS NOR FAIL, REPORTED SEPARATELY:
--
--   42501 (insufficient_privilege) ON T2 - the role `authenticated` holds
--   no INSERT on notifications at all, so nothing below tests a policy.
--   INCONCLUSIVE, and every other write assertion is meaningless.
--
--   23502 / 23514 / 23503 (not_null / check / foreign_key violation) ON AN
--   INSERT -
--   the notifications table has a column or constraint this file does not
--   know about. The table has NO CREATE TABLE anywhere in this
--   repository, so its exact shape is not knowable from source and this
--   is a real possibility. INCONCLUSIVE, not FAIL: it says nothing about
--   the policy. Add the missing column to the inserts below and re-run.
-- =====================================================================


BEGIN;


-- =====================================================================
-- SECTION B (part 1): THE ASSERTIONS.
--
-- One DO block, nine assertions, section A applied in the middle of it.
-- 092 kept its backfill in a separate section A before the assertions;
-- this file cannot, because T1 and T2 must run against the LIVE policy
-- and T3 onward against the NEW one, and both need the same subject rows
-- resolved once.
-- =====================================================================
DO $test$
DECLARE
  v_owner        uuid;
  v_colleague    uuid;
  v_org          uuid;
  v_org_name     text;
  v_stranger     uuid;
  v_claims       text;
  v_rows         integer;
  v_count        integer;
  v_policies_before integer;
  v_policies_after  integer;
  v_check        text;
  v_returns      text;
  v_secdef       boolean;
  v_config       text[];
  v_anon         integer;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_ran          integer := 0;
  v_verdict      text;
  v_verdict_text text;
  -- THE ACCUMULATOR AND ITS COUNTER. v_lines holds one line per assertion,
  -- appended in the order the assertions run. v_logged counts them and is
  -- checked against v_ran at the foot - see THE SELF-CHECK there.
  v_lines        text := '';
  v_logged       integer := 0;
  v_headline     text;
  v_report       text;
BEGIN
  -- -------------------------------------------------------------------
  -- THE SUBJECTS. An organization with at least TWO members, its owner,
  -- and one of its other members. Chosen deterministically so a re-run
  -- exercises the same trio.
  --
  -- IT HAS TO BE AN ORGANIZATION WITH A COLLEAGUE. That is the entire
  -- population 094 is for; every other organization is unaffected by it
  -- in both directions.
  -- -------------------------------------------------------------------
  SELECT m.org_id, o.name
    INTO v_org, v_org_name
  FROM public.org_members m
  JOIN public.organizations o ON o.id = m.org_id
  GROUP BY m.org_id, o.name, o.created_at
  HAVING count(*) > 1
  ORDER BY o.created_at, m.org_id
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'NO SUBJECT: no organization has two members. There is no colleague anywhere to test with, so 094''s central assertion cannot be exercised even in principle. 094 is not wrong in this state, it is inert. As of 2026-08-25 `markant` (79a82f92) had two members - establish what changed before applying.';
  END IF;

  SELECT user_id INTO v_owner
  FROM public.org_members
  WHERE org_id = v_org AND role = 'owner'
  ORDER BY user_id
  LIMIT 1;

  -- Fall back to any member if no row carries role='owner'. The policy
  -- does not read `role` at all, so the distinction does not matter to
  -- what is being tested - only to which of the two is impersonated.
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner
    FROM public.org_members WHERE org_id = v_org ORDER BY user_id LIMIT 1;
  END IF;

  SELECT user_id INTO v_colleague
  FROM public.org_members
  WHERE org_id = v_org AND user_id <> v_owner
  ORDER BY user_id
  LIMIT 1;

  IF v_owner IS NULL OR v_colleague IS NULL THEN
    RAISE EXCEPTION 'NO SUBJECT: could not resolve two distinct members of organization % (%). The HAVING count(*) > 1 above says there are two; if this fires, org_members holds duplicate rows for one user.', v_org, v_org_name;
  END IF;

  -- -------------------------------------------------------------------
  -- THE STRANGER. A real user who is NOT in the subject organization and
  -- NOT a member of any organization in an ACTIVE partnership with it.
  --
  -- WHY BOTH EXCLUSIONS. Excluding only colleagues would pick somebody
  -- the OLD policy already permitted writing to, and T4 would then be
  -- asserting a refusal that never existed - it would FAIL against a
  -- perfectly correct 094 and look like a real finding.
  -- -------------------------------------------------------------------
  SELECT m.user_id INTO v_stranger
  FROM public.org_members m
  WHERE m.org_id <> v_org
    AND m.user_id <> v_owner
    AND m.user_id <> v_colleague
    AND m.org_id NOT IN (
      SELECT p.vendor_org_id FROM public.partnerships p
       WHERE p.lead_org_id = v_org AND p.status = 'active' AND p.vendor_org_id IS NOT NULL
      UNION
      SELECT p.lead_org_id FROM public.partnerships p
       WHERE p.vendor_org_id = v_org AND p.status = 'active' AND p.lead_org_id IS NOT NULL
    )
  ORDER BY m.user_id
  LIMIT 1;

  IF v_stranger IS NULL THEN
    RAISE EXCEPTION 'NO SUBJECT: no unrelated user exists. Every user in this database is either a colleague of organization % (%) or a member of one of its active counterparties, so "094 must still refuse a stranger" has no stranger to refuse. This run cannot show the widening has a boundary. DO NOT APPLY on it.', v_org, v_org_name;
  END IF;

  v_claims := json_build_object('sub', v_owner::text, 'role', 'authenticated')::text;

  SELECT count(*) INTO v_policies_before FROM pg_policies WHERE schemaname = 'public';

  RAISE NOTICE '=====================================================';
  RAISE NOTICE '094 PRE-APPLY TEST   notifications INSERT scope';
  RAISE NOTICE 'organization    : %  (%)', v_org, v_org_name;
  RAISE NOTICE 'owner           : %', v_owner;
  RAISE NOTICE 'colleague       : %', v_colleague;
  RAISE NOTICE 'stranger        : %', v_stranger;
  RAISE NOTICE 'policies before : %', v_policies_before;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE '-- T1-T2: THE LIVE POLICY, BEFORE 094. --';

  -- -------------------------------------------------------------------
  -- T1. THE DEFECT. Owner writes to colleague, against the LIVE policy.
  -- PASS = REFUSED with 42501. This is the whole premise of 094.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,      true);
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (v_colleague, 'partnership_accepted', '094 test T1', 'pre-fix colleague write');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    -- Reaching here means the write was NOT refused.
    RAISE NOTICE 'T1  colleague INSERT, pre-fix         INCONCLUSIVE  <- write SUCCEEDED (% row). The live policy already admits colleagues.', v_rows;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T1  colleague INSERT, pre-fix', 38) || rpad('INCONCLUSIVE', 14) || format('write SUCCEEDED (%s row). The live policy ALREADY admits colleagues, so 094 has nothing to fix and the assertions below prove nothing you needed. If 094 is already applied, THIS IS THE EXPECTED RESULT.', v_rows);
    v_inconc := v_inconc + 1;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'T1  colleague INSERT, pre-fix         PASS   (42501 - the defect, demonstrated)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  colleague INSERT, pre-fix', 38) || rpad('PASS', 14) || '42501 refused - the defect 094 exists to fix, demonstrated';
      v_pass := v_pass + 1;
    WHEN not_null_violation OR check_violation OR foreign_key_violation THEN
      RESET ROLE;
      RAISE NOTICE 'T1  colleague INSERT, pre-fix         INCONCLUSIVE  <- % on notifications, not a policy answer', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  colleague INSERT, pre-fix', 38) || rpad('INCONCLUSIVE', 14) || format('%s on notifications - the table has a column or constraint this file does not know about. Says NOTHING about the policy.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T1  colleague INSERT, pre-fix         FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  colleague INSERT, pre-fix', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T2. THE CONTROL. Owner writes to THEMSELVES, against the LIVE
  -- policy. PASS = SUCCEEDS. Without this, a T1 refusal is ambiguous
  -- between "the policy refused a colleague" and "the impersonation
  -- never took and everything is being refused".
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,      true);
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (v_owner, 'partnership_accepted', '094 test T2', 'pre-fix self write');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T2  self INSERT, pre-fix (control)    PASS   (1 row - impersonation works)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self INSERT, pre-fix (control)', 38) || rpad('PASS', 14) || '1 row written - auth.uid() resolves and the harness reaches the policy';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T2  self INSERT, pre-fix (control)    FAIL   <- matched % rows, expected 1', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self INSERT, pre-fix (control)', 38) || rpad('FAIL', 14) || format('matched %s rows, expected 1', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'T2  self INSERT, pre-fix (control)    INCONCLUSIVE  <- 42501 on the SELF write. Nothing below tests a policy.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self INSERT, pre-fix (control)', 38) || rpad('INCONCLUSIVE', 14) || '42501 refused the SELF write. Either auth.uid() is NULL (the JWT GUCs did not take) or `authenticated` holds no INSERT on notifications at all. EVERY WRITE ASSERTION IN THIS FILE IS MEANINGLESS, INCLUDING T1.';
      v_inconc := v_inconc + 1;
    WHEN not_null_violation OR check_violation OR foreign_key_violation THEN
      RESET ROLE;
      RAISE NOTICE 'T2  self INSERT, pre-fix (control)    INCONCLUSIVE  <- %', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self INSERT, pre-fix (control)', 38) || rpad('INCONCLUSIVE', 14) || format('%s - the notifications table has a column or constraint this file does not know about. Add it to the INSERTs and re-run.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T2  self INSERT, pre-fix (control)    FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self INSERT, pre-fix (control)', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- SECTION A: 094 ITSELF, APPLIED INSIDE THIS TRANSACTION.
  --
  -- These are the two statements of substance from
  -- supabase/migrations/094_notifications_colleague_scope.sql, verbatim.
  -- IF YOU CHANGE THAT FILE, CHANGE THESE. A test that exercises a
  -- different predicate from the one that will be applied is worse than
  -- no test, because it reports PASS about something that will never run.
  -- ===================================================================
  RESET ROLE;
  RAISE NOTICE '';
  RAISE NOTICE '-- SECTION A: applying 094 inside this transaction --';

  CREATE OR REPLACE FUNCTION public.current_user_org_member_user_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT m.user_id
    FROM public.org_members m
    WHERE m.org_id IN (SELECT public.current_user_org_ids());
  $fn$;

  REVOKE EXECUTE ON FUNCTION public.current_user_org_member_user_ids() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.current_user_org_member_user_ids() FROM anon;
  GRANT  EXECUTE ON FUNCTION public.current_user_org_member_user_ids() TO authenticated;

  ALTER POLICY "Scoped insert notifications"
    ON public.notifications
    WITH CHECK (
      user_id = auth.uid()
      OR user_id IN (SELECT public.current_user_org_member_user_ids())
      OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
    );

  RAISE NOTICE '';
  RAISE NOTICE '-- T3-T9: THE NEW POLICY. --';

  -- -------------------------------------------------------------------
  -- T3. THE POINT OF THE MIGRATION. Owner writes to colleague, against
  -- the NEW policy. PASS = SUCCEEDS, 1 row.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,      true);
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (v_colleague, 'partnership_accepted', '094 test T3', 'post-fix colleague write');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T3  colleague INSERT, post-fix        PASS   (1 row - the fix works)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  colleague INSERT, post-fix', 38) || rpad('PASS', 14) || '1 row written - a colleague can now be notified';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T3  colleague INSERT, post-fix        FAIL   <- matched % rows, expected 1', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  colleague INSERT, post-fix', 38) || rpad('FAIL', 14) || format('matched %s rows, expected 1', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'T3  colleague INSERT, post-fix        FAIL   <- 42501. 094 DOES NOT DO THE ONE THING IT IS FOR.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  colleague INSERT, post-fix', 38) || rpad('FAIL', 14) || '42501 still refused. 094 DOES NOT DO THE ONE THING IT IS FOR. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T3  colleague INSERT, post-fix        FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  colleague INSERT, post-fix', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4. THE BOUNDARY. Owner writes to a STRANGER, against the NEW
  -- policy. PASS = REFUSED with 42501.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,      true);
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (v_stranger, 'partnership_accepted', '094 test T4', 'post-fix stranger write');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    RAISE NOTICE 'T4  stranger INSERT, post-fix         FAIL   <- write SUCCEEDED (% row). 094 admits strangers.', v_rows;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T4  stranger INSERT, post-fix', 38) || rpad('FAIL', 14) || format('write SUCCEEDED (%s row) to a user who is neither a colleague nor an active counterparty. THE NEW ARM IS FAR WIDER THAN "MY OWN ORGANIZATION". DO NOT APPLY.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'T4  stranger INSERT, post-fix         PASS   (42501 - the widening has a boundary)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4  stranger INSERT, post-fix', 38) || rpad('PASS', 14) || '42501 refused - the widening stops at the caller''s own organization';
      v_pass := v_pass + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T4  stranger INSERT, post-fix         FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4  stranger INSERT, post-fix', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T5. >>> THE READ ASSERTION. A COLLEAGUE MUST NOT SEE ANOTHER
  -- ORGANIZATION'S NOTIFICATION. <<<
  --
  -- The stranger's row is written here as the OWNER of this transaction
  -- with RLS not in force - deliberately, see THE ORDER OF T5 AND T6 in
  -- the header. Then the COLLEAGUE is impersonated and asked to read it.
  -- PASS = 0 rows.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (v_stranger, 'partnership_accepted', '094 test T5', 'a stranger''s own notification');

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_colleague::text, 'role', 'authenticated')::text,
                       true);
    PERFORM set_config('request.jwt.claim.sub', v_colleague::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_count
    FROM public.notifications
    WHERE user_id = v_stranger;
    RESET ROLE;

    IF v_count = 0 THEN
      RAISE NOTICE 'T5  colleague reads other org         PASS   (0 rows visible)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  colleague reads other org', 38) || rpad('PASS', 14) || '0 rows visible - the INSERT widening did not become a read leak';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T5  colleague reads other org         FAIL   <- % row(s) VISIBLE. DO NOT APPLY.', v_count;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  colleague reads other org', 38) || rpad('FAIL', 14) || format('%s row(s) belonging to another organization are VISIBLE to a colleague. The SELECT policy is not user_id = auth.uid() any more. DO NOT APPLY, and find out what changed it.', v_count);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T5  colleague reads other org         FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  colleague reads other org', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T6. T5 IS NOT TRIVIALLY EMPTY. The colleague reads the row T3 wrote
  -- TO THEM. PASS = exactly 1.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_colleague::text, 'role', 'authenticated')::text,
                       true);
    PERFORM set_config('request.jwt.claim.sub', v_colleague::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_count
    FROM public.notifications
    WHERE title = '094 test T3' AND user_id = v_colleague;
    RESET ROLE;

    IF v_count = 1 THEN
      RAISE NOTICE 'T6  colleague reads own row           PASS   (1 row visible)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  colleague reads own row', 38) || rpad('PASS', 14) || '1 row visible - T5''s zero is a real refusal, not a broken read';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T6  colleague reads own row           FAIL   <- % rows, expected 1', v_count;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  colleague reads own row', 38) || rpad('FAIL', 14) || format('%s rows, expected 1. The colleague cannot read a row addressed to them, so T5''s zero proves nothing - and the bell would be empty for them anyway.', v_count);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T6  colleague reads own row           FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  colleague reads own row', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T7. THE COUNTERPARTY ARM SURVIVED. READ-ONLY.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT with_check INTO v_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'notifications'
      AND policyname = 'Scoped insert notifications';

    IF v_check IS NULL THEN
      RAISE NOTICE 'T7  counterparty arm survived         FAIL   <- policy not found';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  counterparty arm survived', 38) || rpad('FAIL', 14) || 'policy "Scoped insert notifications" not found on public.notifications at all';
      v_fail := v_fail + 1;
    ELSIF position('current_user_active_counterparty_user_ids' in v_check) > 0
      AND position('current_user_org_member_user_ids' in v_check) > 0 THEN
      RAISE NOTICE 'T7  counterparty arm survived         PASS   (both helpers present)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  counterparty arm survived', 38) || rpad('PASS', 14) || 'both helpers present - the ALTER extended the predicate, it did not replace it';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T7  counterparty arm survived         FAIL   <- one of the two helpers is missing';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  counterparty arm survived', 38) || rpad('FAIL', 14) || 'one of the two helpers is missing from with_check. If the COUNTERPARTY one is gone, every cross-company notification has just stopped - silently, because those failures are caught and logged. DO NOT APPLY.';
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T7  counterparty arm survived         FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  counterparty arm survived', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T8. THE FUNCTION'S SHAPE AND GRANTS. READ-ONLY.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT pg_get_function_result(p.oid), p.prosecdef, p.proconfig
      INTO v_returns, v_secdef, v_config
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_user_org_member_user_ids';

    SELECT count(*) INTO v_anon
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name   = 'current_user_org_member_user_ids'
      AND grantee        = 'anon';

    IF v_returns IS NULL THEN
      RAISE NOTICE 'T8  helper shape and grants           FAIL   <- function does not exist';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  helper shape and grants', 38) || rpad('FAIL', 14) || 'function does not exist after section A ran';
      v_fail := v_fail + 1;
    ELSIF v_returns = 'SETOF uuid' AND v_secdef AND v_config IS NOT NULL AND v_anon = 0 THEN
      RAISE NOTICE 'T8  helper shape and grants           PASS   (SETOF uuid, SECURITY DEFINER, anon has no EXECUTE)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  helper shape and grants', 38) || rpad('PASS', 14) || 'SETOF uuid, SECURITY DEFINER, search_path set, anon holds no EXECUTE';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T8  helper shape and grants           FAIL   <- returns=% secdef=% config=% anon=%', v_returns, v_secdef, v_config, v_anon;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  helper shape and grants', 38) || rpad('FAIL', 14) || format('returns=%s (want SETOF uuid), security_definer=%s (want true), search_path=%s (want set), anon EXECUTE grants=%s (want 0). SECURITY INVOKER would make the helper read org_members as the CALLER, whose only SELECT policy there is self-row-only - it would return just the caller and 094 would look applied while changing nothing.', v_returns, v_secdef, v_config, v_anon);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T8  helper shape and grants           FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  helper shape and grants', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T9. THE POLICY COUNT DID NOT MOVE. READ-ONLY.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT count(*) INTO v_policies_after FROM pg_policies WHERE schemaname = 'public';

    IF v_policies_after = v_policies_before THEN
      RAISE NOTICE 'T9  policy count unchanged            PASS   (% before, % after)', v_policies_before, v_policies_after;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T9  policy count unchanged', 38) || rpad('PASS', 14) || format('%s before, %s after - ALTER POLICY created and dropped nothing', v_policies_before, v_policies_after);
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T9  policy count unchanged            FAIL   <- % before, % after', v_policies_before, v_policies_after;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T9  policy count unchanged', 38) || rpad('FAIL', 14) || format('%s before, %s after. 094 must not create or drop a policy - a DROP/CREATE has crept in somewhere.', v_policies_before, v_policies_after);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE NOTICE 'T9  policy count unchanged            FAIL   <- unexpected % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T9  policy count unchanged', 38) || rpad('FAIL', 14) || format('unexpected %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RESET ROLE;

  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'assertions run : %', v_ran;
  RAISE NOTICE 'PASS           : %', v_pass;
  RAISE NOTICE 'FAIL           : %', v_fail;
  RAISE NOTICE 'INCONCLUSIVE   : %', v_inconc;

  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 9 AND v_pass = 9 THEN
    RAISE NOTICE 'VERDICT        : SAFE TO APPLY 094.';
    v_verdict      := 'SAFE TO APPLY';
    v_verdict_text := 'SAFE TO APPLY 094.';
    v_headline     := format('SAFE TO APPLY 094.  All %s assertions passed.', v_pass);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    RAISE NOTICE 'VERDICT        : nothing is BROKEN, but an assertion could not be';
    RAISE NOTICE '                 exercised. Settle it before applying.';
    v_verdict      := 'INCONCLUSIVE';
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised - read the INCONCLUSIVE line below. Settle it before applying.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing FAILED,
    -- but something 094 exists to do was never actually attempted, so this
    -- run says nothing at all about it. The one benign case is a re-run
    -- against an ALREADY-APPLIED 094, where T1 is inconclusive by
    -- construction - read the T1 line before acting on this headline.
    v_headline     := format('DO NOT APPLY 094 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 094 does what it claims. It is not a green light. (If 094 is ALREADY APPLIED, T1 is inconclusive by construction and this headline is expected - read the T1 line.)', v_inconc);
  ELSE
    RAISE NOTICE 'VERDICT        : DO NOT APPLY. Read every FAIL line above.';
    v_verdict      := 'DO NOT APPLY';
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 094.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. If an assertion ran without
  -- logging a line, the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE. That has to outrank SAFE TO
  -- APPLY, so it is applied after the condition above rather than folded
  -- into it.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 094.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  RAISE NOTICE 'Everything above is about to be rolled back.';
  RAISE NOTICE '=====================================================';

  -- =================================================================
  -- THE REPORT.
  --
  -- ORDER IS LOAD-BEARING: HEADLINE, THEN TALLY, THEN THE PER-ASSERTION
  -- LINES. A client that truncates a long error message truncates the
  -- END of it, so the verdict and the counts must be at the TOP where
  -- they survive. The 9 detail lines are the part that can afford to be
  -- cut off - if they are, the tally still says how many failed and the
  -- headline still says whether to apply.
  -- =================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 9)\n', v_ran)
    || format(E'PASS            : %s   (expected 9)\n', v_pass)
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
    || format(E'organization    : %s  (%s)\n', v_org, v_org_name)
    || format(E'owner           : %s\n', v_owner)
    || format(E'colleague       : %s\n', v_colleague)
    || format(E'stranger        : %s\n', v_stranger)
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
-- transaction is still open and still holds a CREATE FUNCTION, THREE
-- GRANT CHANGES, AN ALTER POLICY ON A LIVE TABLE and four real
-- notifications rows, and this line is the only thing that undoes them.
--
-- >>> THE ALTER POLICY IS WHY THIS MATTERS MORE HERE THAN IN 092. 092's
-- >>> test left a column and a trigger behind if the abort failed. THIS
-- >>> ONE WOULD LEAVE A WIDENED RLS POLICY ON A LIVE TABLE, applied by a
-- >>> file whose header says it applies nothing.
-- =====================================================================
ROLLBACK;
