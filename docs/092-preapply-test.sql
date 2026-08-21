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
-- >>> AND IT MATTERS MORE NOW THAN IT DID, BECAUSE 092'S GUARD IS A
-- >>> PERMIT LIST. A deny list can only be too small in one direction -
-- >>> it can miss a column that ought to be guarded, which is a hole. A
-- >>> PERMIT LIST CAN BE TOO SMALL IN THE OTHER DIRECTION TOO: a column
-- >>> that a session client legitimately writes, left off the list, is a
-- >>> WRITE THAT STARTS RAISING LG008 THE MOMENT THE MIGRATION IS
-- >>> APPLIED. T1, T2 and T3 exercise the one permitted column three
-- >>> different ways for exactly that reason.
--
-- IT IS ALSO THE ONLY THING THAT EXERCISES THE BACKFILL BEFORE IT IS
-- REAL. Section A below runs 092's backfill inside this transaction, and
-- T5 checks its result row by row. A backfill that matches nothing is the
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
--     SAFE TO APPLY 092.  All 14 assertions passed.
--     =====================================================
--     assertions run  : 14   (expected 14)
--     PASS            : 14   (expected 14)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 14   (must equal assertions run: OK)
--
--     VERDICT         : SAFE TO APPLY 092.
--     -----------------------------------------------------
--       T1  rename, permitted column      PASS      (1 row written)
--       ... thirteen more ...
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
-- HOW TO READ IT. AN ERROR IS A PASS FOR SEVEN OF THESE FOURTEEN.
-- =====================================================================
--
-- THE PERMIT LIST IS {name}. Everything else on public.organizations is
-- guarded. So the assertions come in two directions and each line says
-- which, rather than leaving it to be inferred.
--
--   T1  THE PERMITTED COLUMN, WRITTEN BARE. `.update({ name })`, which is
--       lib/company-identity.ts:306 exactly - the ONLY session-client
--       writer of this table in the product, and the path every company
--       rename takes. PASS = the write SUCCEEDED, 1 row. A FAIL here
--       means 092 breaks renaming your company. DO NOT APPLY.
--
--   T2  >>> THE ASSERTION THIS WHOLE SHAPE DEPENDS ON. <<<
--       A WHOLE-ROW WRITE that names ALL EIGHT COLUMNS and alters only
--       `name`. That is what a read-modify-write PATCH produces, and it is
--       what both settings forms in this product send.
--
--       A TRIGGER CANNOT SEE THE SET CLAUSE - only OLD and NEW. If 092
--       had been implemented as "was this column named in the UPDATE" it
--       could not have been implemented at all, and any approximation of
--       it would refuse this write for MENTIONING is_paid even though it
--       sent back the identical value. EVERY WHOLE-ROW WRITE IN THE
--       PRODUCT WOULD BREAK.
--
--       092 compares VALUES with IS DISTINCT FROM, per column, so this
--       passes because nothing outside the permit list MOVED. PASS = the
--       write SUCCEEDED, 1 row. A FAIL here is the single most important
--       failure in this file.
--
--   T3  A WHOLE-ROW NO-OP. Every column sent back unchanged, including
--       `name`. Proves the early return is a value comparison and not a
--       column-mention comparison from the other side. PASS = SUCCEEDED.
--
--   T4a-T4g  THE SEVEN GUARDED COLUMNS, ONE AT A TIME, AS AN OWNER OR
--       ADMIN OF THAT ORGANIZATION. The policy PERMITS the row - the
--       subject is an admin of it, which is exactly what "Org admins
--       update their organization" asks and exactly why that policy buys
--       nothing. The GUARD must refuse the column.
--       PASS = the write RAISED LG008. A SUCCESS HERE IS A FAIL.
--
--   T5  THE BACKFILL MUST HAVE LANDED. READ-ONLY. PASS = zero
--       organizations whose is_paid disagrees with their member's. Runs
--       BEFORE T6 deliberately - see THE ORDER OF T5 AND T6 below.
--
--   T6  THE EXEMPTION MUST EXEMPT. A write with no end-user session,
--       which is what the admin grant routes on the service role are and
--       what every migration is. PASS = SUCCEEDED. A FAIL here is the
--       serious one: it would mean 092 has locked the only route that
--       marks a customer paid out of the column it just created.
--
--   T7  091's GUARD MUST STILL BITE, WITH ITS OWN CODE. PASS = LG007,
--       091's code, NOT LG008. Two guards on two tables with two codes;
--       if 092's code comes back here, they have been confused.
--
--   T8  THE COLUMN MUST HAVE THE RIGHT SHAPE. READ-ONLY. PASS = boolean,
--       NOT NULL, DEFAULT false. A nullable entitlement is a third state
--       and every gate in the codebase reads `is_paid === true`.
--
-- EVERY REFUSAL TEST RUNS IN ITS OWN plpgsql SUBTRANSACTION, so an
-- expected LG008 does not abort the run. That is what lets all fourteen
-- assertions report from a single paste.
--
-- =====================================================================
-- THE ORDER OF T5 AND T6 IS LOAD-BEARING. DO NOT SWAP THEM.
-- =====================================================================
--
-- T6 is a WRITE that deliberately MOVES organizations.is_paid, on the
-- exempt path. T5 checks that every organization's is_paid still equals
-- its member's profile flag.
--
-- >>> IF T6 RAN FIRST, IT WOULD FLIP ONE ORGANIZATION'S FLAG AND T5
-- >>> WOULD THEN REPORT A MISMATCH - AGAINST A BACKFILL THAT IS
-- >>> PERFECTLY CORRECT. A test that fails on its own side effects is
-- >>> worse than no test, because the failure looks like a real one.
--
-- T5 is therefore read-only and runs first. Nothing before it moves
-- is_paid: T1, T2 and T3 write `name` and values that do not move, and
-- every T4 raises and rolls its own subtransaction back.
--
-- =====================================================================
-- TWO IMPLEMENTATION NOTES, BOTH DELIBERATE
-- =====================================================================
--
--   BOTH JWT GUCs ARE SET, not one. Supabase's auth.uid() has shipped in
--   two forms across its history - one reading request.jwt.claim.sub, one
--   reading request.jwt.claims ->> 'sub'. Setting only the form this
--   session guessed at would leave auth.uid() NULL, every T4 would sail
--   through the exemption, and all seven would report FAIL against a
--   guard that is in fact correct. Setting both makes the test agree with
--   either definition.
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
--   42501 (insufficient_privilege) - role `authenticated` holds no UPDATE
--   on organizations at all, so the self-grant hole never existed on this
--   table and 092's guard is unnecessary rather than wrong. INCONCLUSIVE.
--
--   A ZERO-ROW UPDATE on any T4 - the "Org admins update their
--   organization" policy filtered the row before the trigger could fire,
--   so the guard was never reached. INCONCLUSIVE, and it also means the
--   subject selection below did not find a genuine admin.
--
--   23514 or 23503 on T4c/T4d/T4e/T4g - a CHECK constraint or a foreign
--   key answered before the trigger did. BEFORE ROW triggers are supposed
--   to run first, so this is worth reading rather than passing.
--   INCONCLUSIVE.
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
-- v_permitted - RE-COPY SECTION A HERE, MOVE THAT COLUMN'S ASSERTION FROM
-- THE T4 GROUP TO THE T1-T3 GROUP, AND CHANGE ITS EXPECTED DIRECTION. A
-- test file that tests last week's function is worse than no test file.
--
-- TWO NUMBERS MOVE TOGETHER when you add or move an assertion, and both
-- are hard-coded: the `v_ran = 14` term in the VERDICT condition, and the
-- '(expected 14)' strings in the tally. THE SELF-CHECK DOES NOT CATCH A
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
--
-- The COMMENT ON TABLE public.profiles from 092 section 6 is deliberately
-- NOT copied: it writes no data and no schema and nothing here asserts on
-- it.
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

CREATE OR REPLACE FUNCTION public.organizations_guard_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- THE PERMIT LIST. THE ONLY PLACE IT EXISTS IN THIS FUNCTION - there is
  -- no second chain to keep in step with it, which is the point.
  -- Derived from docs/092-organizations-writer-census.md, W1.
  v_permitted CONSTANT text[] := ARRAY['name'];
  v_old_rest  jsonb;
  v_new_rest  jsonb;
  v_moved     text[];
BEGIN
  -- THE ROW, MINUS THE PERMITTED COLUMNS, ON BOTH SIDES.
  v_old_rest := to_jsonb(OLD) - v_permitted;
  v_new_rest := to_jsonb(NEW) - v_permitted;

  -- THE EARLY RETURN THAT MAKES THIS FREE, AND IT IS FIRST ON PURPOSE.
  -- Every rename in the product leaves here - including a whole-row write
  -- that names all eight columns and alters only `name` - having done one
  -- jsonb comparison and NOT having called auth.uid().
  --
  -- This is a VALUE comparison, not a SET-clause comparison. See the
  -- header block above; it is the property the shape depends on.
  IF v_new_rest = v_old_rest THEN
    RETURN NEW;
  END IF;

  -- THE EXEMPTION. A write with no end-user session behind it is trusted
  -- code that has already made its own authorization decision: the admin
  -- grant routes on the service role (census W2, W3), a future billing
  -- webhook, this migration's own backfill (W6), handle_new_user (W5),
  -- and every migration after this one. See the header for why this test
  -- and not current_user, session_user or auth.role() - the same four
  -- candidates 091 walked, with the same outcome.
  --
  -- >>> EXEMPT IS NOT THE SAME AS PERMITTED. is_paid is written by W2 and
  -- >>> W3 and is deliberately NOT on the permit list: those two are
  -- >>> service-role callers and pass HERE, before the permit list is ever
  -- >>> consulted. Adding is_paid to v_permitted would additionally let a
  -- >>> BROWSER write it, and the browser is the entire threat model -
  -- >>> every user is an owner of their own organization, so the UPDATE
  -- >>> policy already authorises them to write their own row. THAT EDIT
  -- >>> WOULD DELETE THIS MIGRATION'S ENTIRE EFFECT WHILE APPEARING TO
  -- >>> REFLECT THE CENSUS.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- FROM HERE DOWN: a signed-in caller moved a column that is not on the
  -- permit list. RAISE, never silently revert to OLD. A silently reverted
  -- plan change is a customer who believes they upgraded and a company
  -- that goes on being refused - the same class of quiet wrongness 090 and
  -- 091 both refused for their own columns, delivered to a paying reader.
  SELECT array_agg(k ORDER BY k)
    INTO v_moved
  FROM jsonb_object_keys(v_new_rest) AS k
  WHERE v_new_rest -> k IS DISTINCT FROM v_old_rest -> k;

  RAISE EXCEPTION 'That is not a field you can change.'
    USING ERRCODE = 'LG008',
          DETAIL  = format(
            'organizations.%s may not be written by a browser. Migration 092 guards every column on this table except %s, which is the only one a session client legitimately writes. Only the service role, a database function, or a migration may write the rest. Being an owner or admin of an organization does not permit it: every user is an owner of their own organization, so that role would grant this to everybody.',
            array_to_string(v_moved, ', organizations.'),
            array_to_string(v_permitted, ', ')
          );
END;
$$;

DROP TRIGGER IF EXISTS organizations_columns_guard ON public.organizations;

CREATE TRIGGER organizations_columns_guard
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_guard_columns();

REVOKE EXECUTE ON FUNCTION public.organizations_guard_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.organizations_guard_columns() FROM authenticated;


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
  -- would make every T4 a zero-row update that proves nothing about the
  -- guard.
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
  RAISE NOTICE '092 PRE-APPLY TEST   permit list = {name}';
  RAISE NOTICE 'subject user id      : %', v_uid;
  RAISE NOTICE 'subject organization : %  (%)', v_org, v_org_name;
  RAISE NOTICE 'subject org role     : %', v_role;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE '-- T1-T3: THE PERMITTED COLUMN. PASS = the write succeeded. --';

  -- -------------------------------------------------------------------
  -- T1. THE COMPANY RENAME, BARE. THE ONLY SESSION WRITE OF THIS TABLE.
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
      RAISE NOTICE 'T1  rename, permitted column          PASS   (1 row written, early return)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename, permitted column', 38) || rpad('PASS', 14) || '(1 row written, early return)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T1  rename, permitted column          FAIL   <- matched % rows, expected 1. A zero-row write is not a success.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename, permitted column', 38) || rpad('FAIL', 14) || format('matched %s rows, expected 1. A zero-row write is not a success.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T1  rename, permitted column          FAIL   <- LG008. `name` IS NOT ON THE PERMIT LIST. 092 breaks every company rename. DO NOT APPLY.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename, permitted column', 38) || rpad('FAIL', 14) || 'LG008. `name` is not on the permit list. 092 breaks every company rename. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T1  rename, permitted column          INCONCLUSIVE  42501: authenticated holds no UPDATE on organizations.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename, permitted column', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE on organizations. See the header.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T1  rename, permitted column          FAIL   <- % %  DO NOT APPLY 092.', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  rename, permitted column', 38) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 092.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T2. >>> THE ASSERTION THE WHOLE SHAPE DEPENDS ON. <<<
  --
  -- A WHOLE-ROW WRITE naming ALL EIGHT COLUMNS, altering only `name`.
  -- This is what a read-modify-write PATCH produces.
  --
  -- IT PASSES ONLY BECAUSE THE GUARD COMPARES VALUES RATHER THAN THE SET
  -- CLAUSE. A trigger cannot see the SET clause at all - it has OLD and
  -- NEW and nothing else - so any implementation that tried to refuse on
  -- "was this column named" would refuse this write for MENTIONING
  -- is_paid while sending back the identical value, and every whole-row
  -- write in the product would break.
  --
  -- PASS = SUCCEEDS, 1 row. A FAIL here is the most important failure in
  -- this file.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.organizations
       SET id                      = id,
           name                    = '092 whole-row test',
           primary_contact_user_id = primary_contact_user_id,
           is_lead_agency          = is_lead_agency,
           is_vendor               = is_vendor,
           created_at              = created_at,
           updated_at              = updated_at,
           is_paid                 = is_paid
     WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T2  whole-row write, name only        PASS   (1 row; value comparison, not SET clause)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  whole-row write, name only', 38) || rpad('PASS', 14) || '(1 row; the guard compares VALUES, not the SET clause)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T2  whole-row write, name only        FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  whole-row write, name only', 38) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T2  whole-row write, name only        FAIL   <- LG008. THE GUARD IS TESTING THE SET CLAUSE, NOT THE VALUES. Every whole-row write in the product will break. DO NOT APPLY.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  whole-row write, name only', 38) || rpad('FAIL', 14) || 'LG008. The guard refuses a column that did NOT move. Every whole-row write in the product breaks. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T2  whole-row write, name only        INCONCLUSIVE  42501.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  whole-row write, name only', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE on organizations.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T2  whole-row write, name only        FAIL   <- % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  whole-row write, name only', 38) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 092.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T3. A WHOLE-ROW NO-OP. Every column sent back unchanged, including
  -- the permitted one. The other half of T2's property: the early return
  -- fires because nothing MOVED, not because nothing was named.
  -- PASS = SUCCEEDS, 1 row.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.organizations
       SET id                      = id,
           name                    = name,
           primary_contact_user_id = primary_contact_user_id,
           is_lead_agency          = is_lead_agency,
           is_vendor               = is_vendor,
           created_at              = created_at,
           updated_at              = updated_at,
           is_paid                 = is_paid
     WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T3  whole-row no-op                   PASS   (early return, 1 row)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  whole-row no-op', 38) || rpad('PASS', 14) || '(early return, 1 row)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T3  whole-row no-op                   FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  whole-row no-op', 38) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T3  whole-row no-op                   FAIL   <- % %  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T3  whole-row no-op', 38) || rpad('FAIL', 14) || format('%s %s  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T4a-T4g: THE SEVEN GUARDED COLUMNS. PASS = the write RAISED LG008. --';

  -- -------------------------------------------------------------------
  -- T4a. is_paid IS NOT ON THE PERMIT LIST. PASS = LG008.
  --
  -- THE BILLING COLUMN. The one this migration was created for, and the one a
  -- mechanical read of the census would wrongly have PERMITTED - the admin routes
  -- write it, but on the SERVICE ROLE, so they are EXEMPT and not permitted.
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
      RAISE NOTICE 'T4a refuse is_paid                    INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a refuse is_paid', 38) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T4a refuse is_paid                    FAIL   <- SUCCEEDED, % row(s). THE PERMIT LIST IS NOT BITING.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a refuse is_paid', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). THE PERMIT LIST IS NOT BITING on is_paid.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T4a refuse is_paid                    PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a refuse is_paid', 38) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4a refuse is_paid                    INCONCLUSIVE  42501: the policy answered before the guard could.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a refuse is_paid', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE, or the with_check answered before the trigger. The guard was not exercised.';
      v_inconc := v_inconc + 1;
    WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'T4a refuse is_paid                    INCONCLUSIVE  % : a constraint answered before the trigger did.', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a refuse is_paid', 38) || rpad('INCONCLUSIVE', 14) || format('%s: a constraint answered before the trigger did. BEFORE ROW triggers are supposed to run first, so this is worth reading.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4a refuse is_paid                    FAIL   <- refused with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a refuse is_paid', 38) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4b. updated_at IS NOT ON THE PERMIT LIST. PASS = LG008.
  --
  -- THE ONE MOST LIKELY TO BE A SURPRISE. It is written by W2, W3 and 092's own
  -- backfill - all exempt - and by NO session client: lib/company-identity.ts:306
  -- writes { name } and nothing else. If that line ever adds updated_at, THIS
  -- ASSERTION IS WHAT WILL START FAILING, which is the tripwire working.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.organizations SET updated_at = updated_at + interval '1 day' WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 0 THEN
      RAISE NOTICE 'T4b refuse updated_at                 INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b refuse updated_at', 38) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T4b refuse updated_at                 FAIL   <- SUCCEEDED, % row(s). THE PERMIT LIST IS NOT BITING.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b refuse updated_at', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). THE PERMIT LIST IS NOT BITING on updated_at.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T4b refuse updated_at                 PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b refuse updated_at', 38) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4b refuse updated_at                 INCONCLUSIVE  42501: the policy answered before the guard could.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b refuse updated_at', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE, or the with_check answered before the trigger. The guard was not exercised.';
      v_inconc := v_inconc + 1;
    WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'T4b refuse updated_at                 INCONCLUSIVE  % : a constraint answered before the trigger did.', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b refuse updated_at', 38) || rpad('INCONCLUSIVE', 14) || format('%s: a constraint answered before the trigger did. BEFORE ROW triggers are supposed to run first, so this is worth reading.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4b refuse updated_at                 FAIL   <- refused with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b refuse updated_at', 38) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4c. is_lead_agency IS NOT ON THE PERMIT LIST. PASS = LG008.
  --
  -- A CAPABILITY FLAG. 079:220 calls these DESCRIPTIVE rather than authorization,
  -- which is why they were not in a deny list. That is not a reason to PERMIT
  -- them: no session client writes either, so guarding them costs nothing and
  -- stops a vendor organization relabelling itself a lead agency.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.organizations SET is_lead_agency = NOT is_lead_agency WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 0 THEN
      RAISE NOTICE 'T4c refuse is_lead_agency             INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c refuse is_lead_agency', 38) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T4c refuse is_lead_agency             FAIL   <- SUCCEEDED, % row(s). THE PERMIT LIST IS NOT BITING.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c refuse is_lead_agency', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). THE PERMIT LIST IS NOT BITING on is_lead_agency.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T4c refuse is_lead_agency             PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c refuse is_lead_agency', 38) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4c refuse is_lead_agency             INCONCLUSIVE  42501: the policy answered before the guard could.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c refuse is_lead_agency', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE, or the with_check answered before the trigger. The guard was not exercised.';
      v_inconc := v_inconc + 1;
    WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'T4c refuse is_lead_agency             INCONCLUSIVE  % : a constraint answered before the trigger did.', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c refuse is_lead_agency', 38) || rpad('INCONCLUSIVE', 14) || format('%s: a constraint answered before the trigger did. BEFORE ROW triggers are supposed to run first, so this is worth reading.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4c refuse is_lead_agency             FAIL   <- refused with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c refuse is_lead_agency', 38) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4d. is_vendor IS NOT ON THE PERMIT LIST. PASS = LG008.
  --
  -- The other capability flag. See T4c.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.organizations SET is_vendor = NOT is_vendor WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 0 THEN
      RAISE NOTICE 'T4d refuse is_vendor                  INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d refuse is_vendor', 38) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T4d refuse is_vendor                  FAIL   <- SUCCEEDED, % row(s). THE PERMIT LIST IS NOT BITING.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d refuse is_vendor', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). THE PERMIT LIST IS NOT BITING on is_vendor.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T4d refuse is_vendor                  PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d refuse is_vendor', 38) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4d refuse is_vendor                  INCONCLUSIVE  42501: the policy answered before the guard could.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d refuse is_vendor', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE, or the with_check answered before the trigger. The guard was not exercised.';
      v_inconc := v_inconc + 1;
    WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'T4d refuse is_vendor                  INCONCLUSIVE  % : a constraint answered before the trigger did.', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d refuse is_vendor', 38) || rpad('INCONCLUSIVE', 14) || format('%s: a constraint answered before the trigger did. BEFORE ROW triggers are supposed to run first, so this is worth reading.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4d refuse is_vendor                  FAIL   <- refused with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d refuse is_vendor', 38) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4e. primary_contact_user_id IS NOT ON THE PERMIT LIST. PASS = LG008.
  --
  -- A POINTER AT A PERSON. Written by W4 and W5 only, both migration-side. The
  -- CASE guarantees the value MOVES whichever way the row currently sits - a test
  -- that sets a column to what it already holds proves nothing.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.organizations SET primary_contact_user_id = CASE WHEN primary_contact_user_id IS NULL THEN v_uid ELSE NULL END WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 0 THEN
      RAISE NOTICE 'T4e refuse primary_contact_user_id    INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e refuse primary_contact_user_id', 38) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T4e refuse primary_contact_user_id    FAIL   <- SUCCEEDED, % row(s). THE PERMIT LIST IS NOT BITING.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e refuse primary_contact_user_id', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). THE PERMIT LIST IS NOT BITING on primary_contact_user_id.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T4e refuse primary_contact_user_id    PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e refuse primary_contact_user_id', 38) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4e refuse primary_contact_user_id    INCONCLUSIVE  42501: the policy answered before the guard could.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e refuse primary_contact_user_id', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE, or the with_check answered before the trigger. The guard was not exercised.';
      v_inconc := v_inconc + 1;
    WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'T4e refuse primary_contact_user_id    INCONCLUSIVE  % : a constraint answered before the trigger did.', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e refuse primary_contact_user_id', 38) || rpad('INCONCLUSIVE', 14) || format('%s: a constraint answered before the trigger did. BEFORE ROW triggers are supposed to run first, so this is worth reading.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4e refuse primary_contact_user_id    FAIL   <- refused with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e refuse primary_contact_user_id', 38) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4f. created_at IS NOT ON THE PERMIT LIST. PASS = LG008.
  --
  -- A creation timestamp is not something a browser revises.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.organizations SET created_at = created_at - interval '1 day' WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 0 THEN
      RAISE NOTICE 'T4f refuse created_at                 INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4f refuse created_at', 38) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T4f refuse created_at                 FAIL   <- SUCCEEDED, % row(s). THE PERMIT LIST IS NOT BITING.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4f refuse created_at', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). THE PERMIT LIST IS NOT BITING on created_at.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T4f refuse created_at                 PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4f refuse created_at', 38) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4f refuse created_at                 INCONCLUSIVE  42501: the policy answered before the guard could.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4f refuse created_at', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE, or the with_check answered before the trigger. The guard was not exercised.';
      v_inconc := v_inconc + 1;
    WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'T4f refuse created_at                 INCONCLUSIVE  % : a constraint answered before the trigger did.', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4f refuse created_at', 38) || rpad('INCONCLUSIVE', 14) || format('%s: a constraint answered before the trigger did. BEFORE ROW triggers are supposed to run first, so this is worth reading.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4f refuse created_at                 FAIL   <- refused with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4f refuse created_at', 38) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4g. id IS NOT ON THE PERMIT LIST. PASS = LG008.
  --
  -- THE PRIMARY KEY. Note the ordering this depends on: BEFORE ROW triggers run
  -- BEFORE the RLS WITH CHECK and BEFORE constraint checking, so LG008 wins over
  -- both the policy's with_check and the org_members foreign key. If a 42501 or
  -- a 23503 comes back instead, the trigger did NOT fire first and that is
  -- reported as INCONCLUSIVE, not as a pass.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.organizations SET id = gen_random_uuid() WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 0 THEN
      RAISE NOTICE 'T4g refuse id                         INCONCLUSIVE  0 rows: the UPDATE policy filtered the row, so the guard never fired.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4g refuse id', 38) || rpad('INCONCLUSIVE', 14) || '0 rows: the UPDATE policy filtered the row, so the guard never fired. Nothing proven.';
      v_inconc := v_inconc + 1;
    ELSE
      RAISE NOTICE 'T4g refuse id                         FAIL   <- SUCCEEDED, % row(s). THE PERMIT LIST IS NOT BITING.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4g refuse id', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). THE PERMIT LIST IS NOT BITING on id.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T4g refuse id                         PASS   (refused, LG008)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4g refuse id', 38) || rpad('PASS', 14) || '(refused, LG008)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4g refuse id                         INCONCLUSIVE  42501: the policy answered before the guard could.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4g refuse id', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE, or the with_check answered before the trigger. The guard was not exercised.';
      v_inconc := v_inconc + 1;
    WHEN check_violation OR foreign_key_violation THEN
      RAISE NOTICE 'T4g refuse id                         INCONCLUSIVE  % : a constraint answered before the trigger did.', SQLSTATE;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4g refuse id', 38) || rpad('INCONCLUSIVE', 14) || format('%s: a constraint answered before the trigger did. BEFORE ROW triggers are supposed to run first, so this is worth reading.', SQLSTATE);
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4g refuse id                         FAIL   <- refused with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4g refuse id', 38) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T5: THE BACKFILL. READ-ONLY, AND IT RUNS BEFORE T6 MOVES ANYTHING. --';

  -- -------------------------------------------------------------------
  -- T5. THE BACKFILL AGREES WITH ITS SOURCE, ROW BY ROW.
  --
  -- READ-ONLY, AND IT MUST STAY BEFORE T6. T6 deliberately moves one
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
      RAISE NOTICE 'T5  backfill matches source           PASS   (0 mismatches; is_paid true=%, false=%)', v_paid, v_unpaid;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  backfill matches source', 38) || rpad('PASS', 14) || format('(0 mismatches; true=%s, false=%s. EXPECTED AT AUTHORING: 16 / 2)', v_paid, v_unpaid);
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T5  backfill matches source           FAIL   <- % organization(s) disagree with their member. DO NOT APPLY.', v_mismatch;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  backfill matches source', 38) || rpad('FAIL', 14) || format('%s organization(s) disagree with their member (true=%s, false=%s). DO NOT APPLY.', v_mismatch, v_paid, v_unpaid);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T5  backfill matches source           FAIL   <- % %', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T5  backfill matches source', 38) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T6: THE EXEMPTION. PASS = the write succeeded. THIS ONE MOVES is_paid. --';

  -- -------------------------------------------------------------------
  -- T6. THE EXEMPTION. No claims, no role change - so auth.uid() is NULL,
  -- exactly as it is for the service-role admin grant routes (census W2
  -- and W3), for a future billing webhook, and for every migration.
  --
  -- THIS IS THE MOST IMPORTANT LINE IN THE FILE. If it FAILs, 092 has
  -- locked the only route that marks a customer paid out of the column it
  -- just created, and it must not be applied at all.
  --
  -- NOTE WHAT IT PROVES ABOUT THE PERMIT LIST: is_paid is NOT permitted,
  -- and this write succeeds anyway. EXEMPT IS NOT PERMITTED, and this is
  -- that distinction under test.
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
      RAISE NOTICE 'T6  no-session write is exempt        PASS   (1 row written)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  no-session write is exempt', 38) || rpad('PASS', 14) || '(1 row written; exempt is not permitted)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T6  no-session write is exempt        FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  no-session write is exempt', 38) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T6  no-session write is exempt        FAIL   <- % %  092 WOULD BLOCK THE ADMIN GRANT ROUTE AND EVERY MIGRATION. DO NOT APPLY.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T6  no-session write is exempt', 38) || rpad('FAIL', 14) || format('%s %s  092 WOULD BLOCK THE ADMIN GRANT ROUTE AND EVERY MIGRATION. DO NOT APPLY.', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T7-T8: 091 IS UNDISTURBED, AND THE COLUMN SHAPE. --';

  -- -------------------------------------------------------------------
  -- T7. 091's PROFILES GUARD STILL BITES, WITH ITS OWN CODE.
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
    RAISE NOTICE 'T7  091 guard still bites             FAIL   <- SUCCEEDED, % row(s). 091s trigger is not firing.', v_rows;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T7  091 guard still bites', 38) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). 091s trigger is not firing.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T7  091 guard still bites             PASS   (refused, LG007 - 091s code, not 092s)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  091 guard still bites', 38) || rpad('PASS', 14) || '(refused, LG007 - 091s code, not 092s)';
      v_pass := v_pass + 1;
    WHEN sqlstate 'LG008' THEN
      RAISE NOTICE 'T7  091 guard still bites             FAIL   <- LG008. THE WRONG TRIGGER ANSWERED. The two guards have been confused.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  091 guard still bites', 38) || rpad('FAIL', 14) || 'LG008. THE WRONG TRIGGER ANSWERED. The two guards have been confused.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T7  091 guard still bites             INCONCLUSIVE  42501: authenticated holds no UPDATE on profiles.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  091 guard still bites', 38) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE on profiles.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T7  091 guard still bites             FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  091 guard still bites', 38) || rpad('FAIL', 14) || format('wrong error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T8. THE COLUMN IS boolean, NOT NULL, DEFAULT false.
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
      RAISE NOTICE 'T8  column shape                      PASS   (boolean, NOT NULL, default %)', v_default;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  column shape', 38) || rpad('PASS', 14) || format('(boolean, NOT NULL, default %s)', v_default);
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T8  column shape                      FAIL   <- type=%, nullable=%, default=%', v_type, v_nullable, v_default;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T8  column shape', 38) || rpad('FAIL', 14) || format('type=%s, nullable=%s, default=%s. Expected boolean / NO / false.', COALESCE(v_type,'<missing>'), COALESCE(v_nullable,'<missing>'), v_default);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T8  column shape                      FAIL   <- % %', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T8  column shape', 38) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
    v_fail := v_fail + 1;
  END;

  RESET ROLE;

  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'assertions run : %   (expected 14)', v_ran;
  RAISE NOTICE 'PASS           : %', v_pass;
  RAISE NOTICE 'FAIL           : %', v_fail;
  RAISE NOTICE 'INCONCLUSIVE   : %', v_inconc;

  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 14 AND v_pass = 14 THEN
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
  -- they survive. The 14 detail lines are the part that can afford to be
  -- cut off - if they are, the tally still says how many failed and the
  -- headline still says whether to apply.
  -- =================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 14)\n', v_ran)
    || format(E'PASS            : %s   (expected 14)\n', v_pass)
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
    || 'PERMIT LIST     : name   (everything else on organizations is guarded)' || E'\n'
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
-- and several UPDATEs against real rows, and this line is the only thing
-- that undoes them.
--
-- IT MATTERS MORE HERE THAN IT DID IN 091. 091's test wrote only to
-- profiles rows it had read. THIS ONE ADDS A COLUMN AND REWRITES EVERY
-- ORGANIZATION.
-- =====================================================================
ROLLBACK;
