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
-- WHY IT HAS TO BE AN ERROR, since it looks perverse. Two other
-- mechanisms were tried against this editor and both were dead ends:
--
--   RAISE NOTICE - the Supabase SQL Editor has no Messages panel and does
--   not render notices at all. Every assertion ran, every verdict was
--   produced, and the editor said "Success. No rows returned".
--
--   A TEMP TABLE AND A FINAL SELECT - the editor returned
--   3F000 schema "pg_temp" does not exist. That session has no temp
--   namespace, so no results table can exist in it under any spelling.
--   Nothing written inside this file can create one.
--
-- An error is the one channel every SQL client displays. It also aborts
-- the transaction, which is the same outcome the ROLLBACK at the foot was
-- always there to produce - so nothing is given up in safety.
--
-- WHAT THE ERROR LOOKS LIKE. Verdict first, tally second, per-assertion
-- lines last, because a client that truncates a long message truncates
-- the END of it:
--
--     ERROR:  P0001
--     =====================================================
--     SAFE TO APPLY 091.  All 11 assertions passed.
--     =====================================================
--     assertions run  : 11   (expected 11)
--     PASS            : 11   (expected 11)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 11   (must equal assertions run: OK)
--
--     VERDICT         : SAFE TO APPLY 091.
--     -----------------------------------------------------
--       T1  settings-shaped save        PASS          (1 row written)
--       T2  portal switch (active_role) PASS          (1 row written)
--       ... nine more ...
--     =====================================================
--     This error IS the result. The transaction is rolled back with it.
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 091."        -> and only this - apply it.
--     "DO NOT APPLY 091."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 091 YET."     -> INCONCLUSIVE. Nothing failed, but
--                                    the guarded writes were never
--                                    exercised, so the run says NOTHING
--                                    about whether the guard bites. IT IS
--                                    NOT A GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- It is not the expected message and it never was. If you see it, the DO
-- block did not reach its RAISE - most likely the batch was run in pieces
-- or the editor swallowed the error. You have learned nothing about 091
-- and you must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the CREATE FUNCTION,
-- the CREATE TRIGGER, the REVOKEs and every UPDATE - is inside one
-- transaction, and the RAISE EXCEPTION aborts it. PostgreSQL rolls back
-- DDL, so after this runs the database is byte-identical to before,
-- whether 091 has been applied or not.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 091 IS ALREADY APPLIED. If it is, the
-- CREATE OR REPLACE and the DROP/CREATE TRIGGER simply reinstall the same
-- objects and the abort restores the originals.
--
-- =====================================================================
-- THE ONE FAILURE MODE OF THIS DESIGN: AN EARLY ABORT
-- =====================================================================
--
-- Every assertion is wrapped in its own plpgsql subtransaction with an
-- EXCEPTION handler, so an expected LG007 is caught and reported. IF ANY
-- RAISE EVER ESCAPES A HANDLER - a statement outside a BEGIN/EXCEPTION
-- block, or an error class no handler names - the DO block aborts THERE,
-- before it reaches the report.
--
-- WHAT YOU WOULD SEE: an error, as usual, but one WITHOUT the
-- ===== banner and WITHOUT a tally. A raw SQLSTATE and a one-line
-- message instead of the report shape above.
--
-- >>> THAT OUTCOME IS A FAILURE OF THIS TEST FILE. IT IS NOT A VERDICT
-- >>> ON MIGRATION 091, IN EITHER DIRECTION. It tells you an assertion
-- >>> raised outside its handler. It does not tell you the guard works,
-- >>> and it does not tell you the guard is broken.
-- >>>
-- >>> DO NOT APPLY 091 ON THAT RESULT. Fix the escaping raise and re-run
-- >>> until you get the banner and a tally.
--
-- TELLING THE TWO ERRORS APART IS THE WHOLE SKILL HERE: an error with the
-- banner and a tally is the report. An error without them is a crash.
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
-- TWO NUMBERS MOVE TOGETHER when you add an assertion, and both are
-- hard-coded: the `v_ran = 11` term in the VERDICT condition, and the
-- '(expected 11)' strings in the tally the report prints. A sixth guarded
-- column makes them both 12.
--
-- THE SELF-CHECK DOES NOT CATCH A MISSED UPDATE TO THOSE, and it is worth
-- knowing what it does and does not do. It compares v_logged against
-- v_ran - two counters incremented in different places - so it catches an
-- assertion that RAN WITHOUT REPORTING. It cannot catch a stale literal in
-- a comparison, because nothing counts those.
-- =====================================================================


BEGIN;


-- =====================================================================
-- SECTION 0. WHERE THE RESULTS GO. READ THIS FIRST.
--
-- >>> THE RESULT OF THIS FILE ARRIVES AS AN ERROR. THAT IS CORRECT. <<<
--
-- Two reporting mechanisms were tried against the Supabase SQL Editor and
-- both failed, for different reasons. This is the third, and the reason
-- it works is that an error is the ONE thing every client displays.
--
--   ATTEMPT 1 - RAISE NOTICE.  The editor has no Messages panel and does
--   not render notices at all. Every assertion ran and the entire output
--   was invisible: the editor reported "Success. No rows returned".
--
--   ATTEMPT 2 - a temp table plus a final SELECT.  The editor returned
--   3F000 schema "pg_temp" does not exist - the first rung of the ladder
--   this file used to document. THAT SESSION HAS NO TEMP NAMESPACE, so a
--   results table cannot exist in it under any spelling, qualified or
--   not. No in-file change can create one.
--
--   ATTEMPT 3 - THIS ONE.  Every verdict is accumulated into a plain text
--   variable and the DO block ends with RAISE EXCEPTION carrying it. No
--   table, no temp schema, no result set, no notices. An error is
--   displayed by every SQL client there is, and it aborts the
--   transaction, which is the same outcome the ROLLBACK at the foot was
--   always there to produce. NOTHING PERSISTS EITHER WAY.
--
-- WHAT REPLACED WHAT, so the shape is not mistaken for an accident:
-- v_lines accumulates one line per assertion in the order they run, using
-- the same wording the table rows carried. v_logged counts them, and is
-- checked against v_ran - which the assertions increment independently -
-- so an assertion that ran without logging still shows up.
--
-- THE RAISE NOTICE LINES ARE ALL KEPT AND UNCHANGED. They cost nothing
-- and they are the whole output in psql, where notices do render. They
-- are simply not the mechanism this file relies on any more.
-- =====================================================================


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
  -- THE ACCUMULATOR AND ITS COUNTER. v_lines holds one line per assertion,
  -- appended in the order the assertions run. v_logged counts them and is
  -- checked against v_ran at the foot - see THE SELF-CHECK there.
  v_lines        text := '';
  v_logged       integer := 0;
  v_headline     text;
  v_report       text;
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
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  settings-shaped save', 34) || rpad('PASS', 14) || '(1 row written)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T1  settings-shaped save          FAIL   <- matched % rows, expected 1. A zero-row write is not a success.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T1  settings-shaped save', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1. A zero-row write is not a success.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T1  settings-shaped save          FAIL   <- % %  DO NOT APPLY 091.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T1  settings-shaped save', 34) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 091.', SQLSTATE, SQLERRM);
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
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  portal switch (active_role)', 34) || rpad('PASS', 14) || '(1 row written)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T2  portal switch (active_role)   FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T2  portal switch (active_role)', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2  portal switch (active_role)   FAIL   <- % %  DO NOT APPLY 091.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T2  portal switch (active_role)', 34) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 091.', SQLSTATE, SQLERRM);
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
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  self-grant secondary_role', 34) || rpad('PASS', 14) || '(1 row written)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T3  self-grant secondary_role     FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T3  self-grant secondary_role', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T3  self-grant secondary_role     FAIL   <- % %  DO NOT APPLY 091.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T3  self-grant secondary_role', 34) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 091.', SQLSTATE, SQLERRM);
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
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T4a self-grant is_paid', 34) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4a self-grant is_paid            PASS   (refused, LG007)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a self-grant is_paid', 34) || rpad('PASS', 14) || '(refused, LG007)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4a self-grant is_paid            INCONCLUSIVE  42501: authenticated holds no UPDATE on profiles. See the header.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a self-grant is_paid', 34) || rpad('INCONCLUSIVE', 14) || '42501: authenticated holds no UPDATE on profiles. See the header.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4a self-grant is_paid            FAIL   <- refused, but with the WRONG error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4a self-grant is_paid', 34) || rpad('FAIL', 14) || format('refused, but with the WRONG error: %s %s', SQLSTATE, SQLERRM);
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
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T4b self-grant is_admin', 34) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4b self-grant is_admin           PASS   (refused, LG007)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b self-grant is_admin', 34) || rpad('PASS', 14) || '(refused, LG007)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4b self-grant is_admin           INCONCLUSIVE  42501, see T4a.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b self-grant is_admin', 34) || rpad('INCONCLUSIVE', 14) || '42501, see T4a.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4b self-grant is_admin           FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4b self-grant is_admin', 34) || rpad('FAIL', 14) || format('wrong error: %s %s', SQLSTATE, SQLERRM);
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
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T4c self-grant demo_access', 34) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4c self-grant demo_access        PASS   (refused, LG007)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c self-grant demo_access', 34) || rpad('PASS', 14) || '(refused, LG007)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4c self-grant demo_access        INCONCLUSIVE  42501, see T4a.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c self-grant demo_access', 34) || rpad('INCONCLUSIVE', 14) || '42501, see T4a.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4c self-grant demo_access        FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4c self-grant demo_access', 34) || rpad('FAIL', 14) || format('wrong error: %s %s', SQLSTATE, SQLERRM);
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
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T4d rewrite email', 34) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4d rewrite email                 PASS   (refused, LG007)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d rewrite email', 34) || rpad('PASS', 14) || '(refused, LG007)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4d rewrite email                 INCONCLUSIVE  42501, see T4a.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d rewrite email', 34) || rpad('INCONCLUSIVE', 14) || '42501, see T4a.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4d rewrite email                 FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4d rewrite email', 34) || rpad('FAIL', 14) || format('wrong error: %s %s', SQLSTATE, SQLERRM);
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
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T4e claim linked_agency_id', 34) || rpad('FAIL', 14) || format('SUCCEEDED, %s row(s). The guard is not biting.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG007' THEN
      RAISE NOTICE 'T4e claim linked_agency_id        PASS   (refused, LG007)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e claim linked_agency_id', 34) || rpad('PASS', 14) || '(refused, LG007)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T4e claim linked_agency_id        INCONCLUSIVE  42501, see T4a.';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e claim linked_agency_id', 34) || rpad('INCONCLUSIVE', 14) || '42501, see T4a.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T4e claim linked_agency_id        FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T4e claim linked_agency_id', 34) || rpad('FAIL', 14) || format('wrong error: %s %s', SQLSTATE, SQLERRM);
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
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  no-op write, all five back', 34) || rpad('PASS', 14) || '(early return, 1 row)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T5  no-op write, all five back    FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T5  no-op write, all five back', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T5  no-op write, all five back    FAIL   <- % %  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T5  no-op write, all five back', 34) || rpad('FAIL', 14) || format('%s %s  The early return is wrong. DO NOT APPLY.', SQLSTATE, SQLERRM);
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
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  no-session write is exempt', 34) || rpad('PASS', 14) || '(1 row written)';
      v_pass := v_pass + 1;
    ELSE
      RAISE NOTICE 'T6  no-session write is exempt    FAIL   <- matched % rows, expected 1.', v_rows;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T6  no-session write is exempt', 34) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T6  no-session write is exempt    FAIL   <- % %  091 WOULD BLOCK MIGRATIONS. DO NOT APPLY.', SQLSTATE, SQLERRM;
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T6  no-session write is exempt', 34) || rpad('FAIL', 14) || format('%s %s  091 WOULD BLOCK MIGRATIONS. DO NOT APPLY.', SQLSTATE, SQLERRM);
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
    v_logged := v_logged + 1;
    v_lines  := v_lines || E'\n  ' || rpad('T7  090 guard still bites', 34) || rpad('FAIL', 14) || 'SUCCEEDED. 090s trigger is not firing.';
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG005' THEN
      RAISE NOTICE 'T7  090 guard still bites         PASS   (refused, LG005 - 090s code, not 091s)';
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  090 guard still bites', 34) || rpad('PASS', 14) || '(refused, LG005 - 090s code, not 091s)';
      v_pass := v_pass + 1;
    WHEN OTHERS THEN
      RAISE NOTICE 'T7  090 guard still bites         FAIL   <- wrong error: % %', SQLSTATE, SQLERRM;
      v_logged := v_logged + 1;
      v_lines  := v_lines || E'\n  ' || rpad('T7  090 guard still bites', 34) || rpad('FAIL', 14) || format('wrong error: %s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  RESET ROLE;

  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'assertions run : %   (expected 11)', v_ran;
  RAISE NOTICE 'PASS           : %', v_pass;
  RAISE NOTICE 'FAIL           : %', v_fail;
  RAISE NOTICE 'INCONCLUSIVE   : %', v_inconc;
  -- THE CONDITIONS BELOW ARE UNCHANGED, across two reporting rewrites now.
  -- The only additions are the variables that carry the verdict into the
  -- raised message, because neither a notice nor a result set can be seen
  -- in the editor this has to run in.
  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 11 AND v_pass = 11 THEN
    RAISE NOTICE 'VERDICT        : SAFE TO APPLY 091.';
    v_verdict      := 'SAFE TO APPLY';
    v_verdict_text := 'SAFE TO APPLY 091.';
    v_headline     := format('SAFE TO APPLY 091.  All %s assertions passed.', v_pass);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    RAISE NOTICE 'VERDICT        : nothing is BROKEN, but the guarded writes could';
    RAISE NOTICE '                 not be exercised - authenticated appears to hold';
    RAISE NOTICE '                 no UPDATE on profiles. Settle that before';
    RAISE NOTICE '                 applying: 091 may be unnecessary.';
    v_verdict      := 'INCONCLUSIVE';
    v_verdict_text := 'nothing is BROKEN, but the guarded writes could not be exercised - authenticated appears to hold no UPDATE on profiles. Settle that before applying: 091 may be unnecessary.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing FAILED,
    -- but the writes 091 exists to refuse were never actually attempted, so
    -- this run says nothing at all about whether the guard bites.
    v_headline     := format('DO NOT APPLY 091 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the guarded writes were never exercised, so this run does NOT show the guard works. It is not a green light.', v_inconc);
  ELSE
    RAISE NOTICE 'VERDICT        : DO NOT APPLY. Read every FAIL line above.';
    v_verdict      := 'DO NOT APPLY';
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row above.';
    v_headline     := format('DO NOT APPLY 091.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE, and it is an ADDITION - the
  -- condition above is untouched. If an assertion ran without logging a
  -- line, the report is incomplete and no verdict drawn from it can be
  -- trusted, including a clean one. That has to outrank SAFE TO APPLY.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 091.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  RAISE NOTICE 'Everything above is about to be rolled back.';
  RAISE NOTICE '=====================================================';

  -- =================================================================
  -- THE REPORT.
  --
  -- ORDER IS LOAD-BEARING: HEADLINE, THEN TALLY, THEN THE PER-ASSERTION
  -- LINES. A client that truncates a long error message truncates the
  -- END of it, so the verdict and the counts must be at the TOP where
  -- they survive. The 11 detail lines are the part that can afford to be
  -- cut off - if they are, the tally still says how many failed and the
  -- headline still says whether to apply.
  -- =================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 11)\n', v_ran)
    || format(E'PASS            : %s   (expected 11)\n', v_pass)
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
  -- Notices are invisible in the Supabase SQL Editor and a temp table
  -- cannot be created in that session at all (3F000). An error is the one
  -- channel every client renders. It also aborts the transaction, which is
  -- exactly what the ROLLBACK at the foot was always there to do - so
  -- reporting this way costs nothing in safety and buys the only output
  -- that can actually be read.
  --
  -- NO CUSTOM ERRCODE. This is not a database condition and must never be
  -- mistaken for one of the LG0xx codes 089, 090 and 091 define. The
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
-- transaction is still open and still holds a CREATE FUNCTION, a CREATE
-- TRIGGER and eight UPDATEs against real profiles, and this line is the
-- only thing that undoes them.
--
-- Cheap insurance against a failure mode that leaves writes behind.
-- =====================================================================
ROLLBACK;
