-- =====================================================================
-- 091 PRE-APPLY TEST. ONE PASTE. WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- 089 and 090 were ADDITIVE. A column, a function, a trigger enforcing an
-- invariant nothing had ever violated - so a dry run that proved the file
-- parsed was proportionate evidence.
--
-- 091 IS NOT ADDITIVE. IT CAN REFUSE A WRITE THAT WORKS TODAY. A dry run
-- of 091 proves it compiles and says NOTHING about whether the settings
-- page still saves, whether "Switch to Vendor Mode" still switches, or
-- whether the admin flags route can still grant somebody access. Those
-- are the questions this file answers, before anything is committed.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch. Do NOT run it in pieces:
--      it opens a transaction at the top and closes it with ROLLBACK at
--      the bottom, and running only the first half leaves that
--      transaction open.
--   3. READ THE RESULT GRID. The results arrive as a RESULT SET - a
--      table of seq / test / verdict / detail - not as log output.
--
-- >>> EXPECT EXACTLY 17 ROWS. <<<
--
--        11  assertions          T1, T2, T3, T4a-T4e, T5, T6, T7
--         5  tally rows          assertions run, PASS, FAIL,
--                                INCONCLUSIVE, VERDICT
--         1  ROW COUNT CHECK     verdict OK or MISMATCH
--       ----
--        17
--
--   COUNT THEM. A grid of 17 rows whose last row says OK is a complete
--   run. FEWER THAN 17 means an assertion ran and logged nothing, and the
--   ROW COUNT CHECK row will say MISMATCH and give both numbers.
--
-- WHY IT IS A RESULT SET AND NOT NOTICES. THE SUPABASE SQL EDITOR DOES
-- NOT RENDER NOTICES - it has no Messages panel. An earlier version of
-- this file reported every verdict through RAISE NOTICE alone, and the
-- first real run of it produced "Success. No rows returned": the test had
-- executed correctly and the entire output was invisible. The RAISE
-- NOTICE lines are still here, unchanged, because they cost nothing and
-- they keep the file usable in psql - but THE RESULT SET IS
-- AUTHORITATIVE and the notices are a psql convenience.
--
-- >>> "Success. No rows returned" NOW MEANS SOMETHING WENT WRONG. <<<
--
-- It used to be the expected message. It is not any more. This file ends
-- in a SELECT, so a correct run RETURNS ROWS. "No rows returned" means
-- the SELECT did not run, or your client is showing you the result of the
-- ROLLBACK instead of the result of the SELECT - see THE FALLBACK below.
-- Either way you have learned nothing about 091 and you must not apply it
-- on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the CREATE TEMP
-- TABLE, the CREATE FUNCTION, the CREATE TRIGGER, the REVOKEs and every
-- UPDATE - is inside one transaction that ends in ROLLBACK. PostgreSQL
-- rolls back DDL, so after this runs the database is byte-identical to
-- before, whether 091 has been applied or not. The temp table goes with
-- it.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 091 IS ALREADY APPLIED. If it is, the
-- CREATE OR REPLACE and the DROP/CREATE TRIGGER simply reinstall the same
-- objects and the ROLLBACK restores the originals.
--
-- =====================================================================
-- THE ONE FAILURE MODE OF THIS DESIGN: AN ABORTED TRANSACTION
-- =====================================================================
--
-- Every assertion is wrapped in its own plpgsql subtransaction with an
-- EXCEPTION handler, so an expected LG007 is caught and reported. IF ANY
-- RAISE EVER ESCAPES A HANDLER - a statement outside a BEGIN/EXCEPTION
-- block, or an error class no handler names - THE WHOLE TRANSACTION
-- ABORTS. From that point every later statement, INCLUDING THE FINAL
-- SELECT, returns:
--
--     25P02  current transaction is aborted, commands ignored until end
--            of transaction block
--
-- WHAT YOU WOULD SEE: one error, and NO GRID AT ALL.
--
-- >>> THAT OUTCOME IS A FAILURE OF THIS TEST FILE. IT IS NOT A VERDICT
-- >>> ON MIGRATION 091, IN EITHER DIRECTION. It tells you an assertion
-- >>> raised outside its handler. It does not tell you the guard works,
-- >>> and it does not tell you the guard is broken.
-- >>>
-- >>> DO NOT APPLY 091 ON THAT RESULT. Fix the escaping raise, re-run,
-- >>> and get 17 rows.
--
-- =====================================================================
-- THE FALLBACK, IF YOUR CLIENT SHOWS NO GRID
-- =====================================================================
--
-- Some clients render only the LAST result set in a batch, and in this
-- file the ROLLBACK follows the SELECT. If that is what you are hitting -
-- the run succeeds, no error, but no grid - this reports the tally as an
-- ERROR instead, and an error is displayed by every client there is. It
-- also aborts the transaction, which is the SAME outcome as the ROLLBACK:
-- nothing persists either way.
--
-- ONE UNCOMMENT. Replace the final `END` of the DO block in section B
-- with the four lines below. You lose the per-assertion grid and keep the
-- tally, so use it to find out whether the run is working at all, then
-- put it back.
--
--     RAISE EXCEPTION
--       '091 PRE-APPLY: ran=% (expected 11)  PASS=%  FAIL=%  INCONCLUSIVE=%  VERDICT: %',
--       v_ran, v_pass, v_fail, v_inconc, v_verdict_text;
--     END
--
--
-- =====================================================================
-- HOW TO READ IT. AN ERROR IS A PASS FOR SOME OF THESE.
-- =====================================================================
--
-- The tests fall into three groups and they are scored in opposite
-- directions, which is why each line says so rather than leaving it to
-- be inferred:
--
--   T1-T3   THINGS THAT MUST STILL WORK. A settings-shaped save, a
--           portal switch, a secondary_role self-grant. PASS = the write
--           SUCCEEDED and matched exactly one row. If any of these FAILs,
--           DO NOT APPLY 091 - the authority set is wrong.
--
--   T4      THINGS THAT MUST NOW BE REFUSED. A self-grant of each of the
--           five guarded columns, one at a time, as the signed-in user.
--           PASS = the write RAISED LG007. A success here is a FAIL: it
--           means the guard is not biting.
--
--   T5-T6   THE TWO ESCAPE HATCHES. A no-op write that sends the same
--           values back must pass the early return; a write with no
--           end-user session must be exempt. PASS = SUCCEEDED for both.
--           T6 failing is the serious one - it would mean 091 has locked
--           migrations and the admin routes out of the profiles table.
--
-- EVERY REFUSAL TEST RUNS IN ITS OWN plpgsql SUBTRANSACTION, so an
-- expected LG007 does not abort the run. That is what lets all eleven
-- assertions report from a single paste.
--
-- TWO IMPLEMENTATION NOTES, BOTH DELIBERATE:
--
--   BOTH JWT GUCs ARE SET, not one. Supabase's auth.uid() has shipped in
--   two forms across its history - one reading request.jwt.claim.sub,
--   one reading request.jwt.claims ->> 'sub'. Setting only the form this
--   session guessed at would leave auth.uid() NULL, every T4 write would
--   sail through the exemption, and all five would report FAIL against a
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
-- ONE OUTCOME IS NEITHER PASS NOR FAIL AND IT IS REPORTED SEPARATELY:
-- if a T4 write comes back 42501 (insufficient_privilege) instead of
-- LG007, then role `authenticated` does not hold UPDATE on profiles at
-- all, the self-grant hole never existed, and 091 is unnecessary rather
-- than wrong. That is 090's OPEN-5 and this file settles it as a side
-- effect. It is reported as INCONCLUSIVE, not as a failure.
--
-- =====================================================================
-- THE ONE MAINTENANCE HAZARD IN THIS FILE
-- =====================================================================
--
-- SECTION A BELOW IS A COPY of sections 1-3 of
-- supabase/migrations/091_profiles_column_guard.sql, with that file's
-- BEGIN/COMMIT removed so it can run inside this transaction. It has to
-- be a copy: the brief is one paste, and the SQL Editor cannot \include.
--
-- IF YOU EDIT THE MIGRATION - and in particular IF YOU ADD A COLUMN TO
-- THE AUTHORITY SET - RE-COPY SECTION A HERE AND ADD A T4 CASE FOR THE
-- NEW COLUMN. A test file that tests last week's function is worse than
-- no test file.
--
-- THREE NUMBERS MOVE TOGETHER when you add an assertion, and all three
-- are hard-coded: the `v_ran = 11` term in the VERDICT condition, the
-- 'expected 11' strings in the tally rows, and THE EXPECTED ROW COUNT OF
-- 17 stated above and in section C. A set of six guarded columns makes
-- them 12, 12 and 18. The ROW COUNT CHECK row does NOT catch a missed
-- update to those - it checks that every assertion that RAN also logged,
-- which is a different question.
-- =====================================================================


BEGIN;


-- =====================================================================
-- SECTION 0. WHERE THE RESULTS GO.
--
-- THE SUPABASE SQL EDITOR DOES NOT RENDER NOTICES. It has no Messages
-- panel, so RAISE NOTICE output is invisible in the only client this
-- project uses - the file runs, every assertion executes, and the editor
-- says "Success. No rows returned". That is what happened the first time
-- this was run.
--
-- So every verdict is ALSO written to this table, and section C SELECTs
-- it as the last statement inside the transaction. THE RESULT SET IS THE
-- AUTHORITATIVE OUTPUT. The RAISE NOTICE lines are kept because they cost
-- nothing and they keep the file usable in psql, where notices DO render.
--
-- NO `ON COMMIT DROP`, DELIBERATELY. This transaction ends in ROLLBACK,
-- never in COMMIT, so an ON COMMIT clause would describe an event that
-- never happens and would read as though the table outlives the run. It
-- does not: CREATE TEMP TABLE is DDL, PostgreSQL rolls DDL back, and the
-- ROLLBACK at the foot of this file removes the table along with
-- everything else. Nothing persists either way; this spelling just does
-- not lie about the reason.
--
-- =====================================================================
-- EVERY REFERENCE TO THIS TABLE IS WRITTEN pg_temp._lg091_results,
-- INCLUDING THIS CREATE. DO NOT "SIMPLIFY" THE QUALIFIER AWAY.
-- =====================================================================
--
-- The unqualified spelling shipped first and a real run in the Supabase
-- SQL Editor returned, on the first INSERT:
--
--     ERROR: 42P01: relation "_lg091_results" does not exist
--
-- The table had been created. It was the NAME that did not resolve.
--
-- THE DISTINCTION THAT MATTERS, AND IT IS THE WHOLE REASON THIS LOOKS
-- REDUNDANT. `pg_temp` behaves differently in the two places it can
-- appear:
--
--   AS A search_path ENTRY it is unreliable. PostgreSQL resolves the
--   literal `pg_temp` to the session's real temp schema - pg_temp_N -
--   when it RECOMPUTES the path. If the session had no temp namespace at
--   that moment, the entry resolves to nothing and silently drops off,
--   and every unqualified relation name stops finding the temp schema.
--   Nothing warns. You get 42P01 on a table you just created.
--
--   AS A QUALIFIER it is reliable. `pg_temp.x` is resolved at USE time,
--   against this session's temp namespace, every time. It does not
--   depend on any search_path, on who set one, or on when.
--
-- So the qualifier is not belt-and-braces around the same mechanism. It
-- is a DIFFERENT mechanism, and it is the one that holds.
--
-- WHERE THE BAD search_path CAME FROM IS NOT IN THIS FILE, and that was
-- checked rather than assumed: the only `SET search_path` here is the
-- one on profiles_guard_authority_columns() below, which is a FUNCTION
-- ATTRIBUTE copied byte-identically from migration 091 - it applies
-- while that function runs and to nothing else, and that function never
-- touches this table. It must stay exactly as it is or this file stops
-- testing the real migration. The path that failed belongs to the
-- executing client's own session or wrapper.
--
-- IF IT FAILS AGAIN, THE NEW ERROR NAMES THE CAUSE. Qualification turns
-- one ambiguous error into three that can be told apart:
--
--   3F000  schema "pg_temp" does not exist
--          -> this session has NO temp namespace, so the CREATE above ran
--             somewhere else. The client is splitting the batch across
--             connections and no in-file change can fix it.
--   42P01  relation "pg_temp._lg091_results" does not exist
--          -> the temp schema is there and the table is not: the CREATE
--             did not run, or was rolled back before the reference.
--   42501  permission denied for schema pg_temp_N
--          -> a role change is still in effect at that statement.
--
-- =====================================================================
-- =====================================================================
CREATE TEMP TABLE pg_temp._lg091_results (
  seq     integer GENERATED ALWAYS AS IDENTITY,
  test    text,
  verdict text,
  detail  text
);


-- =====================================================================
-- SECTION A. THE MIGRATION, INLINE. Copy of 091 sections 1-3.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.profiles_guard_authority_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF  NEW.is_paid          IS NOT DISTINCT FROM OLD.is_paid
  AND NEW.is_admin         IS NOT DISTINCT FROM OLD.is_admin
  AND NEW.demo_access      IS NOT DISTINCT FROM OLD.demo_access
  AND NEW.email            IS NOT DISTINCT FROM OLD.email
  AND NEW.linked_agency_id IS NOT DISTINCT FROM OLD.linked_agency_id
  THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_paid IS DISTINCT FROM OLD.is_paid THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.is_paid is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.is_admin is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.demo_access IS DISTINCT FROM OLD.demo_access THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.demo_access is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.email is an authority column guarded by migration 091. It is read by current_user_email() and compared against invitation addresses by accept_org_invitation(). Only the service role, a database function, or a migration may write it.';
  END IF;

  IF NEW.linked_agency_id IS DISTINCT FROM OLD.linked_agency_id THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG007',
            DETAIL  = 'profiles.linked_agency_id is an authority column guarded by migration 091. Only the service role, a database function, or a migration may write it.';
  END IF;

  RAISE EXCEPTION 'That is not a field you can change.'
    USING ERRCODE = 'LG007',
          DETAIL  = 'A guarded column on profiles moved but migration 091 has no refusal for it. The authority set in profiles_guard_authority_columns() is out of step with itself - see the ROT instruction in 091_profiles_column_guard.sql.';
END;
$$;

DROP TRIGGER IF EXISTS profiles_authority_columns_guard ON public.profiles;

CREATE TRIGGER profiles_authority_columns_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_authority_columns();

REVOKE EXECUTE ON FUNCTION public.profiles_guard_authority_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_authority_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_authority_columns() FROM authenticated;


-- =====================================================================
-- SECTION B. THE TESTS.
-- =====================================================================

DO $test$
DECLARE
  v_uid        uuid;
  v_role       text;
  v_claims     text;
  v_rows       integer;
  v_pass       integer := 0;
  v_fail       integer := 0;
  v_inconc     integer := 0;
  v_ran        integer := 0;
  v_verdict      text;
  v_verdict_text text;
  v_rows_logged  integer;
BEGIN
  -- THE SUBJECT. One real profile, chosen deterministically so a re-run
  -- exercises the same row. Nothing is written to it that outlives this
  -- transaction.
  SELECT p.id, p.active_role
    INTO v_uid, v_role
  FROM public.profiles p
  ORDER BY p.created_at, p.id
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No profiles rows. There is nothing to test against.';
  END IF;

  -- THE IMPERSONATION. This is what makes auth.uid() non-null, which is
  -- the whole condition the guard turns on. `sub` is what auth.uid()
  -- reads; `role` is what auth.role() reads and is set for completeness.
  v_claims := json_build_object('sub', v_uid::text, 'role', 'authenticated')::text;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE '091 PRE-APPLY TEST';
  RAISE NOTICE 'subject profile id : %', v_uid;
  RAISE NOTICE 'subject active_role: %', v_role;
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '';
  RAISE NOTICE '-- T1-T3: MUST STILL WORK. PASS = the write succeeded. --';

  -- -------------------------------------------------------------------
  -- T1. A LEGITIMATE SETTINGS-SHAPED WRITE.
  -- Mirrors census writer 3, app/agency/settings/user/page.tsx:101:
  -- full_name, display_name, notification_preferences, updated_at.
  -- PASS = SUCCEEDS and matches exactly 1 row.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;

    UPDATE public.profiles
       SET full_name                = '091 pre-apply test',
           display_name             = '091 pre-apply test',
           notification_preferences = '{"email": true}'::jsonb,
           updated_at               = now()
     WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T1  settings-shaped save          PASS   (1 row written)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T1  settings-shaped save', 'PASS', '(1 row written)');
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T1  settings-shaped save          FAIL   <- matched % rows, expected 1. A zero-row write is not a success.', v_rows;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T1  settings-shaped save', 'FAIL', format('matched %s rows, expected 1. A zero-row write is not a success.', v_rows));
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T1  settings-shaped save          FAIL   <- % %  DO NOT APPLY 091.', SQLSTATE, SQLERRM;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T1  settings-shaped save', 'FAIL', format('%s %s  DO NOT APPLY 091.', SQLSTATE, SQLERRM));
    v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T2. THE PORTAL SWITCH. active_role, flipped.
  -- Mirrors census writers 17-20 (switch-role:43/:67, active-role:48,
  -- partner/rfps/claim:110). active_role is DELIBERATELY NOT GUARDED.
  -- PASS = SUCCEEDS.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;

    UPDATE public.profiles
       SET active_role = CASE WHEN active_role = 'agency' THEN 'partner' ELSE 'agency' END
     WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T2  portal switch (active_role)   PASS   (1 row written)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T2  portal switch (active_role)', 'PASS', '(1 row written)');
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T2  portal switch (active_role)   FAIL   <- matched % rows, expected 1.', v_rows;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T2  portal switch (active_role)', 'FAIL', format('matched %s rows, expected 1.', v_rows));
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2  portal switch (active_role)   FAIL   <- % %  DO NOT APPLY 091.', SQLSTATE, SQLERRM;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T2  portal switch (active_role)', 'FAIL', format('%s %s  DO NOT APPLY 091.', SQLSTATE, SQLERRM));
    v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T3. THE OTHER HALF OF THE PORTAL SWITCH. secondary_role.
  -- switch-role:43 SELF-GRANTS secondary_role='partner' as a free,
  -- self-serve act. It is on the same column grant-agency-access uses
  -- for an admin grant, which is why it is OUT of the authority set and
  -- why it is tested rather than assumed. PASS = SUCCEEDS.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;

    UPDATE public.profiles SET secondary_role = 'partner' WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T3  self-grant secondary_role     PASS   (1 row written)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T3  self-grant secondary_role', 'PASS', '(1 row written)');
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T3  self-grant secondary_role     FAIL   <- matched % rows, expected 1.', v_rows;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T3  self-grant secondary_role', 'FAIL', format('matched %s rows, expected 1.', v_rows));
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T3  self-grant secondary_role     FAIL   <- % %  DO NOT APPLY 091.', SQLSTATE, SQLERRM;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T3  self-grant secondary_role', 'FAIL', format('%s %s  DO NOT APPLY 091.', SQLSTATE, SQLERRM));
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T4: MUST NOW BE REFUSED. PASS = the write RAISED LG007. --';

  -- -------------------------------------------------------------------
  -- T4a. SELF-GRANT is_paid. THE ONE THIS MIGRATION EXISTS FOR.
  -- PASS = LG007.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;
    UPDATE public.profiles SET is_paid = NOT COALESCE(is_paid, false) WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE 'T4a self-grant is_paid            FAIL   <- SUCCEEDED, % row(s). The guard is not biting.', v_rows;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T4a self-grant is_paid', 'FAIL', format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows));
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4a self-grant is_paid            PASS   (refused, LG007)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4a self-grant is_paid', 'PASS', '(refused, LG007)');
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4a self-grant is_paid            INCONCLUSIVE  42501: authenticated holds no UPDATE on profiles. See the header.';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4a self-grant is_paid', 'INCONCLUSIVE', '42501: authenticated holds no UPDATE on profiles. See the header.');
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4a self-grant is_paid            FAIL   <- refused, but with the WRONG error: % %', SQLSTATE, SQLERRM;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4a self-grant is_paid', 'FAIL', format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM));
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4b. SELF-GRANT is_admin. Strictly worse than is_paid: it grants the
  -- admin panel and a bypass in every entitlement function. PASS = LG007.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;
    UPDATE public.profiles SET is_admin = NOT COALESCE(is_admin, false) WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE 'T4b self-grant is_admin           FAIL   <- SUCCEEDED, % row(s). The guard is not biting.', v_rows;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T4b self-grant is_admin', 'FAIL', format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows));
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4b self-grant is_admin           PASS   (refused, LG007)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4b self-grant is_admin', 'PASS', '(refused, LG007)');
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4b self-grant is_admin           INCONCLUSIVE  42501, see T4a.';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4b self-grant is_admin', 'INCONCLUSIVE', '42501, see T4a.');
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4b self-grant is_admin           FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4b self-grant is_admin', 'FAIL', format('wrong error: %s %s', SQLSTATE, SQLERRM));
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4c. SELF-GRANT demo_access. PASS = LG007.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;
    UPDATE public.profiles SET demo_access = NOT COALESCE(demo_access, false) WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE 'T4c self-grant demo_access        FAIL   <- SUCCEEDED, % row(s). The guard is not biting.', v_rows;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T4c self-grant demo_access', 'FAIL', format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows));
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4c self-grant demo_access        PASS   (refused, LG007)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4c self-grant demo_access', 'PASS', '(refused, LG007)');
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4c self-grant demo_access        INCONCLUSIVE  42501, see T4a.';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4c self-grant demo_access', 'INCONCLUSIVE', '42501, see T4a.');
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4c self-grant demo_access        FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4c self-grant demo_access', 'FAIL', format('wrong error: %s %s', SQLSTATE, SQLERRM));
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4d. REWRITE email. The invitation-hijack one: current_user_email()
  -- reads this column and accept_org_invitation compares an invitation
  -- address against it. PASS = LG007.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;
    UPDATE public.profiles SET email = 'someone-elses-address@example.invalid' WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE 'T4d rewrite email                 FAIL   <- SUCCEEDED, % row(s). The guard is not biting.', v_rows;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T4d rewrite email', 'FAIL', format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows));
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4d rewrite email                 PASS   (refused, LG007)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4d rewrite email', 'PASS', '(refused, LG007)');
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4d rewrite email                 INCONCLUSIVE  42501, see T4a.';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4d rewrite email', 'INCONCLUSIVE', '42501, see T4a.');
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4d rewrite email                 FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4d rewrite email', 'FAIL', format('wrong error: %s %s', SQLSTATE, SQLERRM));
      v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T4e. CLAIM linked_agency_id. PASS = LG007.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;
    UPDATE public.profiles SET linked_agency_id = v_uid WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    RAISE NOTICE 'T4e claim linked_agency_id        FAIL   <- SUCCEEDED, % row(s). The guard is not biting.', v_rows;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T4e claim linked_agency_id', 'FAIL', format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows));
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4e claim linked_agency_id        PASS   (refused, LG007)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4e claim linked_agency_id', 'PASS', '(refused, LG007)');
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4e claim linked_agency_id        INCONCLUSIVE  42501, see T4a.';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4e claim linked_agency_id', 'INCONCLUSIVE', '42501, see T4a.');
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4e claim linked_agency_id        FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T4e claim linked_agency_id', 'FAIL', format('wrong error: %s %s', SQLSTATE, SQLERRM));
      v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '-- T5-T6: THE ESCAPE HATCHES. PASS = the write succeeded. --';

  -- -------------------------------------------------------------------
  -- T5. THE NO-OP. A read-modify-write that sends every guarded value
  -- BACK UNCHANGED must pass the early return. This is the normal case,
  -- not an edge one: both settings forms send whole payloads read off
  -- the row. It is also what proves IS NOT DISTINCT FROM was used rather
  -- than <>, which would fail on a NULL sent back as NULL.
  -- PASS = SUCCEEDS.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,     true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text,  true);
    SET LOCAL ROLE authenticated;

    UPDATE public.profiles
       SET is_paid          = is_paid,
           is_admin         = is_admin,
           demo_access      = demo_access,
           email            = email,
           linked_agency_id = linked_agency_id,
           updated_at       = now()
     WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T5  no-op write, all five back    PASS   (early return, 1 row)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T5  no-op write, all five back', 'PASS', '(early return, 1 row)');
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T5  no-op write, all five back    FAIL   <- matched % rows, expected 1.', v_rows;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T5  no-op write, all five back', 'FAIL', format('matched %s rows, expected 1.', v_rows));
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T5  no-op write, all five back    FAIL   <- % %  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T5  no-op write, all five back', 'FAIL', format('%s %s  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM));
    v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T6. THE EXEMPTION. No claims, no role change - so auth.uid() is NULL,
  -- exactly as it is for the service-role admin routes, for
  -- handle_new_user's ON CONFLICT DO UPDATE, and for every migration.
  -- PASS = SUCCEEDS.
  --
  -- THIS IS THE MOST IMPORTANT LINE IN THE FILE. If it FAILs, 091 has
  -- locked the database's own maintainer out of the profiles table and
  -- must not be applied at all.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);

    UPDATE public.profiles
       SET is_paid = NOT COALESCE(is_paid, false),
           email   = 'exempt-path-test@example.invalid'
     WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 1 THEN
      RAISE NOTICE 'T6  no-session write is exempt    PASS   (1 row written)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T6  no-session write is exempt', 'PASS', '(1 row written)');
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T6  no-session write is exempt    FAIL   <- matched % rows, expected 1.', v_rows;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T6  no-session write is exempt', 'FAIL', format('matched %s rows, expected 1.', v_rows));
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T6  no-session write is exempt    FAIL   <- % %  091 WOULD BLOCK MIGRATIONS. DO NOT APPLY.', SQLSTATE, SQLERRM;
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T6  no-session write is exempt', 'FAIL', format('%s %s  091 WOULD BLOCK MIGRATIONS. DO NOT APPLY.', SQLSTATE, SQLERRM));
    v_fail := v_fail + 1;
  END;

  -- -------------------------------------------------------------------
  -- T7. 090'S SIBLING GUARD STILL BITES. 091 must not have displaced it.
  -- PASS = LG005, 090's code, not LG007.
  -- -------------------------------------------------------------------
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    UPDATE public.profiles
       SET active_org_id = '00000000-0000-0000-0000-000000000000'
     WHERE id = v_uid;
    RAISE NOTICE 'T7  090 guard still bites         FAIL   <- SUCCEEDED. 090s trigger is not firing.';
    INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
      ('T7  090 guard still bites', 'FAIL', 'SUCCEEDED. 090s trigger is not firing.');
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG005' THEN
      RAISE NOTICE 'T7  090 guard still bites         PASS   (refused, LG005 - 090s code, not 091s)';
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T7  090 guard still bites', 'PASS', '(refused, LG005 - 090s code, not 091s)');
      v_pass := v_pass + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T7  090 guard still bites         FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
        ('T7  090 guard still bites', 'FAIL', format('wrong error: %s %s', SQLSTATE, SQLERRM));
      v_fail := v_fail + 1;
  END;

  RESET ROLE;

  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'assertions run : %   (expected 11)', v_ran;
  RAISE NOTICE 'PASS           : %', v_pass;
  RAISE NOTICE 'FAIL           : %', v_fail;
  RAISE NOTICE 'INCONCLUSIVE   : %', v_inconc;
  -- THE CONDITIONS BELOW ARE UNCHANGED. The only additions are the two
  -- variables, so the verdict can be written to the result set as well as
  -- to a notice nobody can see.
  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 11 AND v_pass = 11 THEN
    RAISE NOTICE 'VERDICT        : SAFE TO APPLY 091.';
    v_verdict      := 'SAFE TO APPLY';
    v_verdict_text := 'SAFE TO APPLY 091.';
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    RAISE NOTICE 'VERDICT        : nothing is BROKEN, but the guarded writes could';
    RAISE NOTICE '                 not be exercised - authenticated appears to hold';
    RAISE NOTICE '                 no UPDATE on profiles. Settle that before';
    RAISE NOTICE '                 applying: 091 may be unnecessary.';
    v_verdict      := 'INCONCLUSIVE';
    v_verdict_text := 'nothing is BROKEN, but the guarded writes could not be exercised - authenticated appears to hold no UPDATE on profiles. Settle that before applying: 091 may be unnecessary.';
  ELSE
    RAISE NOTICE 'VERDICT        : DO NOT APPLY. Read every FAIL line above.';
    v_verdict      := 'DO NOT APPLY';
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row above.';
  END IF;

  -- THE TALLY, AS ROWS. Five of them, matching the five notices above.
  INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
    ('TALLY  assertions run', v_ran::text,    'expected 11');
  INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
    ('TALLY  PASS',           v_pass::text,   'expected 11');
  INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
    ('TALLY  FAIL',           v_fail::text,   'expected 0');
  INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
    ('TALLY  INCONCLUSIVE',   v_inconc::text, 'expected 0');
  INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
    ('VERDICT',               v_verdict,      v_verdict_text);

  -- THE SELF-CHECK. It catches the one thing this reporting change could
  -- have broken: a report site that got a notice and no INSERT. The DO
  -- block counts assertions in v_ran independently of the table, so if an
  -- assertion ran and did not log, the two numbers disagree HERE, in the
  -- output, rather than showing up as a silently shorter grid that looks
  -- fine unless you happen to know how many rows to expect.
  SELECT count(*) INTO v_rows_logged FROM pg_temp._lg091_results;
  INSERT INTO pg_temp._lg091_results (test, verdict, detail) VALUES
    ('ROW COUNT CHECK',
     CASE WHEN v_rows_logged = v_ran + 5 THEN 'OK' ELSE 'MISMATCH' END,
     format('%s rows logged before this one; expected %s, being %s assertions plus 5 tally rows. With this row the grid is %s rows. MISMATCH means an assertion ran but logged nothing - a report site was missed, and the grid is incomplete.',
            v_rows_logged, v_ran + 5, v_ran, v_rows_logged + 1));
  RAISE NOTICE 'Everything above is about to be rolled back.';
  RAISE NOTICE '=====================================================';
END
$test$;


-- =====================================================================
-- SECTION C. THE OUTPUT. THIS IS THE RESULT, AND IT IS AUTHORITATIVE.
--
-- The LAST statement inside the transaction, immediately before the
-- ROLLBACK. EXPECT 17 ROWS: 11 assertions, 5 tally rows, 1 row count
-- check. Any other number is itself a finding - see the header.
-- =====================================================================
SELECT seq, test, verdict, detail
FROM pg_temp._lg091_results
ORDER BY seq;


-- =====================================================================
-- NOTHING PERSISTS. This is the line that makes the whole file safe.
-- It removes the temp table above along with everything else.
-- =====================================================================
ROLLBACK;
