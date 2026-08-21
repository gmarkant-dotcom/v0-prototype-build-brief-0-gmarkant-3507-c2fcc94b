-- =====================================================================
-- 092 PRE-APPLY TEST. ONE PASTE. WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 092 proves the file parses. It says NOTHING about whether
-- the company rename at lib/company-identity.ts:306 still saves, whether
-- an owner can still self-grant the billing column, or whether the
-- backfill wrote anything at all. Those are the questions this file
-- answers, before anything is committed.
--
-- IT IS ALSO THE ONLY THING THAT EXERCISES THE BACKFILL BEFORE IT IS
-- REAL. Section A below runs 092's backfill inside this transaction, and
-- T4 checks its result row by row. A backfill that matches nothing is the
-- one failure in this migration that commits happily and locks every
-- paying customer out on the next deploy.
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
-- docs/091-preapply-test.sql and not re-derived here:
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
--     SAFE TO APPLY 092.  All 7 assertions passed.
--     =====================================================
--     assertions run  : 7    (expected 7)
--     PASS            : 7    (expected 7)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 7    (must equal assertions run: OK)
--
--     VERDICT         : SAFE TO APPLY 092.
--     -----------------------------------------------------
--       T1  rename org as admin       PASS          (1 row written)
--       ... six more ...
--     =====================================================
--     This error IS the result. The transaction is rolled back with it.
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 092."        -> and only this - apply it.
--     "DO NOT APPLY 092."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 092 YET."     -> INCONCLUSIVE. Nothing failed, but
--                                    an assertion could not be exercised,
--                                    so the run says NOTHING about the
--                                    thing it was meant to prove. IT IS
--                                    NOT A GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- It is not the expected message and it never was. If you see it, the DO
-- block did not reach its RAISE - most likely the batch was run in pieces
-- or the editor swallowed the error. You have learned nothing about 092
-- and you must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the ALTER TABLE, the
-- backfill, the CREATE FUNCTION, the CREATE TRIGGER, the REVOKEs and
-- every UPDATE - is inside one transaction, and the RAISE EXCEPTION
-- aborts it. PostgreSQL rolls back DDL, so after this runs the database
-- is byte-identical to before, whether 092 has been applied or not.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 092 IS ALREADY APPLIED. The ALTER is
-- IF NOT EXISTS, the backfill is idempotent - it writes the same values
-- from the same source - and the CREATE OR REPLACE plus DROP/CREATE
-- TRIGGER simply reinstall the same objects. The abort restores whatever
-- was there.
--
-- =====================================================================
-- THREE WAYS THIS RUN CAN END, AND ONLY ONE OF THEM IS A VERDICT
-- =====================================================================
--
-- (1) AN ERROR WITH THE ===== BANNER AND A TALLY.  That is the report.
--     Read the headline.
--
-- (2) AN ERROR SAYING "BACKFILL REFUSED: ...".  THAT IS NOT A CRASH AND
--     IT IS NOT A BUG IN THIS FILE. It is 092's own section 2 speaking,
--     from inside SECTION A, and it means one of its preconditions no
--     longer holds:
--
--       "% organization(s) have more than one member"
--           THE WINDOW HAS CLOSED. The backfill has no correct answer any
--           more - see section 0 of docs/092-entitlements-design.md.
--           DO NOT APPLY 092. Greg owes a ruling first.
--
--       "% organization(s) have no members"
--           Those organizations would silently keep DEFAULT false.
--           Establish whether they are orphans first. DO NOT APPLY 092.
--
--       "updated % row(s) but there are % organization(s)"
--           The org_members -> profiles join dropped rows. DO NOT APPLY.
--
--     In all three cases the transaction is aborted and nothing persists,
--     exactly as on the happy path. THE ANSWER IS "DO NOT APPLY", and you
--     have learned precisely why.
--
-- (3) AN ERROR WITHOUT THE BANNER AND WITHOUT A TALLY, AND NOT ONE OF
--     THE BACKFILL REFUSALS ABOVE.  A raw SQLSTATE and a one-line
--     message. THAT IS A FAILURE OF THIS TEST FILE AND IT IS NOT A
--     VERDICT ON 092 IN EITHER DIRECTION. It means an assertion raised
--     outside its handler. Fix the escaping raise and re-run until you
--     get a banner.
--
-- TELLING THESE APART IS THE WHOLE SKILL HERE.
--
-- =====================================================================
-- HOW TO READ IT. AN ERROR IS A PASS FOR SOME OF THESE.
-- =====================================================================
--
-- The seven assertions are scored in opposite directions, which is why
-- each line says so rather than leaving it to be inferred:
--
--   T1  THE RENAME MUST STILL WORK. lib/company-identity.ts:306 is the
--       ONLY writer of public.organizations in the entire application,
--       it is a SESSION client, and every company rename in the product
--       goes through it. PASS = the write SUCCEEDED and matched exactly
--       one row. A FAIL here means the early return is wrong and 092
--       breaks renaming your company. DO NOT APPLY.
--
--   T2  THE SELF-GRANT MUST NOW BE REFUSED. This is the assertion the
--       whole migration exists for. The subject is an OWNER or ADMIN of
--       the organization being written, so the "Org admins update their
--       organization" policy PERMITS the row - and the guard must refuse
--       the column anyway. PASS = the write RAISED LG008. A SUCCESS HERE
--       IS A FAIL: it means any user can mark their own company paid.
--
--   T3  THE NO-OP MUST PASS THE EARLY RETURN. A read-modify-write that
--       sends is_paid back unchanged is the normal shape of a PostgREST
--       patch built from a row that was just read. PASS = SUCCEEDED. It
--       is also what proves IS NOT DISTINCT FROM was used rather than <>.
--
--   T4  THE BACKFILL MUST HAVE LANDED. READ-ONLY. PASS = zero
--       organizations whose is_paid disagrees with their member's. This
--       runs BEFORE T5 deliberately - see THE ORDER OF T4 AND T5 below.
--
--   T5  THE EXEMPTION MUST EXEMPT. A write with no end-user session,
--       which is what the admin grant route on the service role is and
--       what every migration is. PASS = SUCCEEDED. A FAIL here is the
--       serious one: it would mean 092 has locked the only route that
--       marks a customer paid out of the column it just created.
--
--   T6  091's GUARD MUST STILL BITE, WITH ITS OWN CODE. PASS = LG007,
--       091's code, NOT LG008. Two guards on two tables with two codes;
--       if 092's code comes back here, they have been confused.
--
--   T7  THE COLUMN MUST HAVE THE RIGHT SHAPE. READ-ONLY. PASS = boolean,
--       NOT NULL, DEFAULT false. A nullable entitlement is a third state
--       and every gate in the codebase reads `is_paid === true`.
--
-- EVERY REFUSAL TEST RUNS IN ITS OWN plpgsql SUBTRANSACTION, so an
-- expected LG008 does not abort the run. That is what lets all seven
-- assertions report from a single paste.
--
-- =====================================================================
-- THE ORDER OF T4 AND T5 IS LOAD-BEARING. DO NOT SWAP THEM.
-- =====================================================================
--
-- T5 is a WRITE that deliberately MOVES organizations.is_paid, on the
-- exempt path. T4 checks that every organization's is_paid still equals
-- its member's profile flag.
--
-- >>> IF T5 RAN FIRST, IT WOULD FLIP ONE ORGANIZATION'S FLAG AND T4
-- >>> WOULD THEN REPORT A MISMATCH - AGAINST A BACKFILL THAT IS
-- >>> PERFECTLY CORRECT. A test that fails on its own side effects is
-- >>> worse than no test, because the failure looks like a real one.
--
-- T4 is therefore read-only and runs first. Nothing before it moves
-- is_paid: T1 writes `name`, T2 raises, T3 writes is_paid back unchanged.
--
-- =====================================================================
-- TWO IMPLEMENTATION NOTES, BOTH DELIBERATE
-- =====================================================================
--
--   BOTH JWT GUCs ARE SET, not one. Supabase's auth.uid() has shipped in
--   two forms across its history - one reading request.jwt.claim.sub, one
--   reading request.jwt.claims ->> 'sub'. Setting only the form this
--   session guessed at would leave auth.uid() NULL, T2 would sail through
--   the exemption, and it would report FAIL against a guard that is in
--   fact correct. Setting both makes the test agree with either
--   definition.
--
--   IF YOUR EDITOR REJECTS `SET LOCAL ROLE authenticated` inside the DO
--   block, replace every occurrence with
--   `PERFORM set_config('role', 'authenticated', true);` and every
--   `RESET ROLE;` with `PERFORM set_config('role', 'none', true);`.
--   They are equivalent - `role` is an ordinary GUC - and the set_config
--   form goes through a function call rather than plpgsql's utility
--   statement handling.
--
-- ONE OUTCOME IS NEITHER PASS NOR FAIL AND IT IS REPORTED SEPARATELY.
-- Two ways to reach it, and they mean different things:
--
--   42501 (insufficient_privilege) on T1/T2/T3 - role `authenticated`
--   holds no UPDATE on organizations at all, so the self-grant hole never
--   existed on this table and 092's guard is unnecessary rather than
--   wrong. INCONCLUSIVE.
--
--   A ZERO-ROW UPDATE on T2 - the "Org admins update their organization"
--   policy filtered the row before the trigger could fire, so the guard
--   was never reached. That says NOTHING about whether the guard bites.
--   INCONCLUSIVE, and it also means the subject selection below did not
--   find a genuine admin.
--
-- =====================================================================
-- THE ONE MAINTENANCE HAZARD IN THIS FILE
-- =====================================================================
--
-- SECTION A BELOW IS A COPY of sections 1-5 of
-- supabase/migrations/092_org_entitlement.sql, with that file's
-- BEGIN/COMMIT removed so it can run inside this transaction. It has to
-- be a copy: the brief is one paste, and the SQL Editor cannot \include.
--
-- IF YOU EDIT THE MIGRATION - and in particular IF YOU ADD A COLUMN TO
-- THE GUARDED SET, or SWITCH TO THE PERMIT-LIST SHAPE the design doc
-- argued for - RE-COPY SECTION A HERE AND ADD AN ASSERTION FOR THE
-- CHANGE. A test file that tests last week's function is worse than no
-- test file.
--
-- TWO NUMBERS MOVE TOGETHER when you add an assertion, and both are
-- hard-coded: the `v_ran = 7` term in the VERDICT condition, and the
-- '(expected 7)' strings in the tally. THE SELF-CHECK DOES NOT CATCH A
-- MISSED UPDATE TO THOSE. It compares v_logged against v_ran - two
-- counters incremented in different places - so it catches an assertion
-- that RAN WITHOUT REPORTING. It cannot catch a stale literal in a
-- comparison, because nothing counts those.
-- =====================================================================


BEGIN;


-- =====================================================================
-- SECTION A. THE MIGRATION, INLINE. Copy of 092 sections 1-5.
--
-- NOTE THAT THIS INCLUDES THE BACKFILL AND ITS THREE ASSERTIONS. If one
-- of them raises, this run ends with "BACKFILL REFUSED: ..." and no
-- banner - which is outcome (2) in the header, a real answer of DO NOT
-- APPLY, not a crash.
-- =====================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

DO $backfill$
DECLARE
  v_orgs           integer;
  v_multi_member   integer;
  v_no_member      integer;
  v_updated        integer;
  v_paid_after     integer;
  v_unpaid_after   integer;
BEGIN
  SELECT count(*) INTO v_orgs FROM public.organizations;

  SELECT count(*) INTO v_multi_member FROM (
    SELECT m.org_id FROM public.org_members m
    GROUP BY m.org_id HAVING count(*) > 1
  ) AS multi;

  IF v_multi_member > 0 THEN
    RAISE EXCEPTION
      'BACKFILL REFUSED: % organization(s) have more than one member.', v_multi_member
      USING DETAIL =
        'Migration 092 backfills organizations.is_paid from the ONE member of each '
        'organization. With two members and disagreeing flags there is no correct '
        'answer - bool_or and bool_and are both guesses, and the guess is permanent '
        'because profiles.is_paid is on its way to being dropped. This is a RULING '
        'Greg owes, not a bug in this file. Run the query in section 0 of '
        'docs/092-entitlements-design.md, decide, and amend the UPDATE below to '
        'match the decision before re-running.';
  END IF;

  SELECT count(*) INTO v_no_member
  FROM public.organizations o
  WHERE NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = o.id);

  IF v_no_member > 0 THEN
    RAISE EXCEPTION
      'BACKFILL REFUSED: % organization(s) have no members.', v_no_member
      USING DETAIL =
        'Those organizations have no profile to read an entitlement from, so they '
        'would silently keep the DEFAULT false. Establish whether they are orphans '
        'or legitimately empty before applying 092.';
  END IF;

  UPDATE public.organizations o
     SET is_paid    = src.paid,
         updated_at = now()
    FROM (
      SELECT m.org_id, COALESCE(bool_or(p.is_paid), false) AS paid
      FROM public.org_members m
      JOIN public.profiles p ON p.id = m.user_id
      GROUP BY m.org_id
    ) AS src
   WHERE o.id = src.org_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_orgs THEN
    RAISE EXCEPTION
      'BACKFILL REFUSED: updated % row(s) but there are % organization(s).',
      v_updated, v_orgs
      USING DETAIL =
        'Every organization must receive a value from its member. A short count '
        'means the org_members -> profiles join dropped rows. Nothing has been '
        'committed. Investigate before re-running.';
  END IF;

  SELECT count(*) FILTER (WHERE is_paid),
         count(*) FILTER (WHERE NOT is_paid)
    INTO v_paid_after, v_unpaid_after
  FROM public.organizations;

  RAISE WARNING '092 BACKFILL: % organization(s) written. is_paid true=%, false=%. EXPECTED AT AUTHORING TIME: 18 written, 16 true, 2 false.',
    v_updated, v_paid_after, v_unpaid_after;
END
$backfill$;

CREATE OR REPLACE FUNCTION public.organizations_guard_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_paid IS NOT DISTINCT FROM OLD.is_paid THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_paid IS DISTINCT FROM OLD.is_paid THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG008',
            DETAIL  = 'organizations.is_paid is the company plan, guarded by migration 092. Only the service role, a database function, or a migration may write it. Being an owner or admin of an organization does not permit it: every user is an owner of their own organization, so that role would grant this to everybody.';
  END IF;

  RAISE EXCEPTION 'That is not a field you can change.'
    USING ERRCODE = 'LG008',
          DETAIL  = 'A guarded column on organizations moved but migration 092 has no refusal for it. The guarded set in organizations_guard_entitlement() is out of step with itself - see the ROT instruction in 092_org_entitlement.sql.';
END;
$$;

DROP TRIGGER IF EXISTS organizations_entitlement_guard ON public.organizations;

CREATE TRIGGER organizations_entitlement_guard
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_guard_entitlement();

REVOKE EXECUTE ON FUNCTION public.organizations_guard_entitlement() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_entitlement() FROM anon;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_entitlement() FROM authenticated;


-- =====================================================================
-- SECTION B. THE TESTS.
-- =====================================================================

DO $test$
DECLARE
  v_uid          uuid;
  v_org          uuid;
  v_org_name     text;
  v_role         text;
  v_claims       text;
  v_rows         integer;
  v_mismatch     integer;
  v_paid         integer;
  v_unpaid       integer;
  v_type         text;
  v_nullable     text;
  v_default      text;
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
  -- THE SUBJECT. A real member who is an OWNER or ADMIN of a real
  -- organization, chosen deterministically so a re-run exercises the same
  -- pair. It has to be an admin: the "Org admins update their
  -- organization" policy filters on exactly that, and a non-admin subject
  -- would make T2 a zero-row update that proves nothing about the guard.
  SELECT m.user_id, m.org_id, o.name, m.role
    INTO v_uid, v_org, v_org_name, v_role
  FROM public.org_members m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.role IN ('owner', 'admin')
  ORDER BY o.created_at, o.id
  LIMIT 1;

  IF v_uid IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'No owner/admin org_members row exists. There is nothing to test against, and the "Org admins update their organization" policy could never have granted anybody anything.';
  END IF;

  -- THE IMPERSONATION. This is what makes auth.uid() non-null, which is
  -- the whole condition the guard turns on. `sub` is what auth.uid()
  -- reads; `role` is what auth.role() reads and is set for completeness.
  v_claims := json_build_object('sub', v_uid::text, 'role', 'authenticated')::text;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE '092 PRE-APPLY TEST';
  RAISE NOTICE 'subject user id      : %', v_uid;
  RAISE NOTICE 'subject organization : %  (%)', v_org, v_org_name;
  RAISE NOTICE 'subject org role     : %', v_role;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE '-- T1, T3, T5: MUST STILL WORK. PASS = the write succeeded. --';

  -- -------------------------------------------------------------------
  -- T1. THE COMPANY RENAME. THE ONLY SESSION WRITE OF THIS TABLE.
  -- Mirrors lib/company-identity.ts:306, which writes { name } and
  -- nothing else - not even updated_at. Every rename in the product goes
  -- through it. PASS = SUCCEEDS and matches exactly 1 row.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.organizations
       SET name = '092 pre-apply test'
     WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T1  rename org as admin           PASS   (1 row written, early return)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename org as admin', 34) || rpad('PASS', 14) || '(1 row written, early return)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T1  rename org as admin           FAIL   <- matched % rows, expected 1. A zero-row write is not a success.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename org as admin', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1. A zero-row write is not a success.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T1  rename org as admin           FAIL   <- LG008. THE EARLY RETURN IS WRONG - 092 breaks every company rename. DO NOT APPLY.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename org as admin', 34) || rpad('FAIL', 14) || 'LG008. THE EARLY RETURN IS WRONG - 092 breaks every company rename. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T1  rename org as admin           INCONCLUSIVE  42501: authenticated holds no UPDATE on organizations. See the header.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename org as admin', 34) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE on organizations. See the header.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T1  rename org as admin           FAIL   <- % %  DO NOT APPLY 092.', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename org as admin', 34) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 092.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T2: MUST NOW BE REFUSED. PASS = the write RAISED LG008. --';

  -- -------------------------------------------------------------------
  -- T2. SELF-GRANT organizations.is_paid, AS AN OWNER OR ADMIN OF THAT
  -- ORGANIZATION. THE ONE THIS MIGRATION EXISTS FOR.
  --
  -- The policy PERMITS this row - the subject is an admin of it, which is
  -- exactly what "Org admins update their organization" asks and exactly
  -- why that policy buys nothing. The GUARD must refuse the column.
  -- PASS = LG008.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.organizations SET is_paid = NOT is_paid WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 0 THEN
      -- NOT A PASS. The policy filtered the row before the trigger could
      -- fire, so the guard was never reached and this run says nothing
      -- about whether it bites. It also means the subject is not the
      -- admin the selection above believed it found.
      RAISE NOTICE 'T2  self-grant org is_paid        INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self-grant org is_paid', 34) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T2  self-grant org is_paid        FAIL   <- SUCCEEDED, % row(s). ANY USER CAN MARK THEIR OWN COMPANY PAID. DO NOT APPLY.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self-grant org is_paid', 34) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). ANY USER CAN MARK THEIR OWN COMPANY PAID. The guard is not biting.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T2  self-grant org is_paid        PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self-grant org is_paid', 34) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T2  self-grant org is_paid        INCONCLUSIVE  42501: authenticated holds no UPDATE on organizations. 092 may be unnecessary.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self-grant org is_paid', 34) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE on organizations. 092 may be unnecessary.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T2  self-grant org is_paid        FAIL   <- refused, but with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  self-grant org is_paid', 34) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T3: THE EARLY RETURN. PASS = the write succeeded. --';

  -- -------------------------------------------------------------------
  -- T3. THE NO-OP. is_paid sent BACK UNCHANGED, alongside a real edit.
  -- This is the normal shape of a PostgREST patch assembled from a row
  -- that was just read, and it is what proves IS NOT DISTINCT FROM was
  -- used rather than <>. PASS = SUCCEEDS.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.organizations
       SET is_paid    = is_paid,
           name       = name,
           updated_at = now()
     WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T3  no-op write, is_paid back     PASS   (early return, 1 row)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  no-op write, is_paid back', 34) || rpad('PASS', 14) || '(early return, 1 row)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T3  no-op write, is_paid back     FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  no-op write, is_paid back', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T3  no-op write, is_paid back     FAIL   <- % %  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T3  no-op write, is_paid back', 34) || rpad('FAIL', 14) || format('%s %s  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T4: THE BACKFILL. READ-ONLY, AND IT RUNS BEFORE T5 MOVES ANYTHING. --';

  -- -------------------------------------------------------------------
  -- T4. THE BACKFILL AGREES WITH ITS SOURCE, ROW BY ROW.
  --
  -- READ-ONLY, AND IT MUST STAY BEFORE T5. T5 deliberately moves one
  -- organization's is_paid on the exempt path; if it ran first, this
  -- assertion would report a mismatch against a backfill that is
  -- perfectly correct.
  --
  -- PASS = 0 organizations whose flag disagrees with their member's.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);

    SELECT count(*) INTO v_mismatch FROM (
      SELECT o.id
      FROM public.organizations o
      JOIN public.org_members  m ON m.org_id = o.id
      JOIN public.profiles     p ON p.id = m.user_id
      GROUP BY o.id, o.is_paid
      HAVING o.is_paid IS DISTINCT FROM COALESCE(bool_or(p.is_paid), false)
    ) AS bad;

    SELECT count(*) FILTER (WHERE is_paid),
           count(*) FILTER (WHERE NOT is_paid)
      INTO v_paid, v_unpaid
    FROM public.organizations;

    IF v_mismatch = 0 THEN
      RAISE NOTICE 'T4  backfill matches source       PASS   (0 mismatches; is_paid true=%, false=%)', v_paid, v_unpaid;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4  backfill matches source', 34) || rpad('PASS', 14) || format('(0 mismatches; true=%s, false=%s. EXPECTED AT AUTHORING: 16 / 2)', v_paid, v_unpaid);
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T4  backfill matches source       FAIL   <- % organization(s) disagree with their member. DO NOT APPLY.', v_mismatch;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4  backfill matches source', 34) || rpad('FAIL', 14) || format('%s organization(s) disagree with their member (true=%s, false=%s). DO NOT APPLY.', v_mismatch, v_paid, v_unpaid);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T4  backfill matches source       FAIL   <- % %', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T4  backfill matches source', 34) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T5: THE EXEMPTION. PASS = the write succeeded. THIS ONE MOVES is_paid. --';

  -- -------------------------------------------------------------------
  -- T5. THE EXEMPTION. No claims, no role change - so auth.uid() is NULL,
  -- exactly as it is for the service-role admin grant routes, for a
  -- future billing webhook, and for every migration.
  --
  -- THIS IS THE MOST IMPORTANT LINE IN THE FILE. If it FAILs, 092 has
  -- locked the only route that marks a customer paid out of the column it
  -- just created, and it must not be applied at all.
  --
  -- IT MUTATES is_paid. Everything that reads the backfill runs above it.
  -- PASS = SUCCEEDS.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);

    UPDATE public.organizations
       SET is_paid = NOT is_paid
     WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T5  no-session write is exempt    PASS   (1 row written)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  no-session write is exempt', 34) || rpad('PASS', 14) || '(1 row written)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T5  no-session write is exempt    FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  no-session write is exempt', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T5  no-session write is exempt    FAIL   <- % %  092 WOULD BLOCK THE ADMIN GRANT ROUTE AND EVERY MIGRATION. DO NOT APPLY.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T5  no-session write is exempt', 34) || rpad('FAIL', 14) || format('%s %s  092 WOULD BLOCK THE ADMIN GRANT ROUTE AND EVERY MIGRATION. DO NOT APPLY.', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T6: 091 IS UNDISTURBED. PASS = LG007, NOT LG008. --';

  -- -------------------------------------------------------------------
  -- T6. 091's PROFILES GUARD STILL BITES, WITH ITS OWN CODE.
  --
  -- 092 must not have displaced it, and the two must not have been
  -- confused with each other. A signed-in user moving profiles.is_paid is
  -- 091's business and must come back LG007. LG008 HERE WOULD BE A FAIL:
  -- it would mean the wrong trigger answered.
  --
  -- Requires a SESSION, unlike 091's own T7 against 090 - 090's guard is
  -- caller-independent and 091's is not.
  -- PASS = LG007.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.profiles SET is_paid = NOT COALESCE(is_paid, false) WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE 'T6  091 guard still bites         FAIL   <- SUCCEEDED, % row(s). 091s trigger is not firing.', v_rows;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T6  091 guard still bites', 34) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). 091s trigger is not firing.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T6  091 guard still bites         PASS   (refused, LG007 - 091s code, not 092s)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  091 guard still bites', 34) || rpad('PASS', 14) || '(refused, LG007 - 091s code, not 092s)';
      v_pass := v_pass + 1;
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T6  091 guard still bites         FAIL   <- LG008. THE WRONG TRIGGER ANSWERED. The two guards have been confused.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  091 guard still bites', 34) || rpad('FAIL', 14) || 'LG008. THE WRONG TRIGGER ANSWERED. The two guards have been confused.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T6  091 guard still bites         INCONCLUSIVE  42501: authenticated holds no UPDATE on profiles.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  091 guard still bites', 34) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE on profiles.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T6  091 guard still bites         FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  091 guard still bites', 34) || rpad('FAIL', 14) || format('wrong error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T7: THE COLUMN SHAPE. READ-ONLY. --';

  -- -------------------------------------------------------------------
  -- T7. THE COLUMN IS boolean, NOT NULL, DEFAULT false.
  --
  -- READ-ONLY. A nullable entitlement is a third state, and every gate in
  -- the codebase reads `is_paid === true` - a spelling 091 recorded as
  -- having been settled on precisely because `!== false` and truthiness
  -- had already drifted apart across routes while a null was possible.
  -- PASS = all three correct.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT c.data_type, c.is_nullable, COALESCE(c.column_default, '<none>')
      INTO v_type, v_nullable, v_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name   = 'organizations'
      AND c.column_name  = 'is_paid';

    IF v_type = 'boolean' AND v_nullable = 'NO' AND v_default LIKE '%false%' THEN
      RAISE NOTICE 'T7  column shape                  PASS   (boolean, NOT NULL, default %)', v_default;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  column shape', 34) || rpad('PASS', 14) || format('(boolean, NOT NULL, default %s)', v_default);
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T7  column shape                  FAIL   <- type=%, nullable=%, default=%', v_type, v_nullable, v_default;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  column shape', 34) || rpad('FAIL', 14) || format('type=%s, nullable=%s, default=%s. Expected boolean / NO / false.', COALESCE(v_type,'<missing>'), COALESCE(v_nullable,'<missing>'), v_default);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T7  column shape                  FAIL   <- % %', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T7  column shape', 34) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RESET ROLE;

  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'assertions run : %   (expected 7)', v_ran;
  RAISE NOTICE 'PASS           : %', v_pass;
  RAISE NOTICE 'FAIL           : %', v_fail;
  RAISE NOTICE 'INCONCLUSIVE   : %', v_inconc;

  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 7 AND v_pass = 7 THEN
    RAISE NOTICE 'VERDICT        : SAFE TO APPLY 092.';
    v_verdict      := 'SAFE TO APPLY';
    v_verdict_text := 'SAFE TO APPLY 092.';
    v_headline     := format('SAFE TO APPLY 092.  All %s assertions passed.', v_pass);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    RAISE NOTICE 'VERDICT        : nothing is BROKEN, but an assertion could not be';
    RAISE NOTICE '                 exercised. Settle it before applying.';
    v_verdict      := 'INCONCLUSIVE';
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised - read the INCONCLUSIVE line below. Settle it before applying.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing FAILED,
    -- but something 092 exists to do was never actually attempted, so this
    -- run says nothing at all about it.
    v_headline     := format('DO NOT APPLY 092 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 092 does what it claims. It is not a green light.', v_inconc);
  ELSE
    RAISE NOTICE 'VERDICT        : DO NOT APPLY. Read every FAIL line above.';
    v_verdict      := 'DO NOT APPLY';
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 092.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. If an assertion ran without
  -- logging a line, the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE. That has to outrank SAFE TO
  -- APPLY, so it is applied after the condition above rather than folded
  -- into it.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 092.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  RAISE NOTICE 'Everything above is about to be rolled back.';
  RAISE NOTICE '=====================================================';

  -- =================================================================
  -- THE REPORT.
  --
  -- ORDER IS LOAD-BEARING: HEADLINE, THEN TALLY, THEN THE PER-ASSERTION
  -- LINES. A client that truncates a long error message truncates the
  -- END of it, so the verdict and the counts must be at the TOP where
  -- they survive. The 7 detail lines are the part that can afford to be
  -- cut off - if they are, the tally still says how many failed and the
  -- headline still says whether to apply.
  -- =================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 7)\n', v_ran)
    || format(E'PASS            : %s   (expected 7)\n', v_pass)
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
-- propagates out of section B, aborts the transaction, and every
-- statement after it - including this one - is skipped.
--
-- IT IS NOT DEAD CODE AND MUST NOT BE DELETED. It is the safety net for
-- the case where that exception is CAUGHT rather than propagated: an
-- enclosing EXCEPTION handler added here later, or a client that wraps
-- the batch in its own block and swallows the error. In that case the
-- transaction is still open and still holds an ALTER TABLE, a backfill
-- that rewrote every organization, a CREATE FUNCTION, a CREATE TRIGGER
-- and five UPDATEs against real rows, and this line is the only thing
-- that undoes them.
--
-- IT MATTERS MORE HERE THAN IT DID IN 091. 091's test wrote only to
-- profiles rows it had read. THIS ONE ADDS A COLUMN AND REWRITES EVERY
-- ORGANIZATION.
-- =====================================================================
ROLLBACK;
