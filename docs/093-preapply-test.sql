-- =====================================================================
-- 093 PRE-APPLY TEST. ONE PASTE. WRITES, THEN ROLLS BACK.
--
-- WHY THIS FILE EXISTS AND WHY IT IS NOT OPTIONAL.
--
-- A dry run of 093 proves the file PARSES. It says NOTHING about whether
-- a vendor can still accept an invitation, decline one, or request
-- payment terms. Those are the questions this file answers, before
-- anything is committed.
--
-- >>> AND IT MATTERS MORE HERE THAN IT DID FOR 092, WHICH IS THE
-- >>> OPPOSITE OF WHAT 092'S HEADER COULD SAY ABOUT ITSELF. 092's permit
-- >>> list guarded ONE COLUMN THAT DID NOT EXIST until line 1 of its own
-- >>> transaction, so no write that worked that morning could move it.
-- >>> 093'S PERMIT LIST GUARDS TWENTY-SIX COLUMNS THAT ALL EXIST TODAY,
-- >>> five of which are written by live vendor sessions every day.
-- >>>
-- >>> A DENY LIST CAN ONLY BE TOO SMALL IN ONE DIRECTION - it can miss a
-- >>> column that ought to be guarded, which is a hole you can close
-- >>> later. A PERMIT LIST CAN BE TOO SMALL IN THE OTHER DIRECTION TOO: a
-- >>> column a vendor session legitimately writes, left off the list, is
-- >>> A WRITE THAT STARTS RAISING LG009 THE MOMENT THE MIGRATION IS
-- >>> APPLIED. T1 to T5 exist for exactly that, and a FAIL in that block
-- >>> is more urgent than a FAIL anywhere else in this file.
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
-- docs/091-preapply-test.sql and docs/092-preapply-test.sql and not
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
--     SAFE TO APPLY 093.  All 15 assertions passed.
--     =====================================================
--     assertions run  : 15   (expected 15)
--     PASS            : 15   (expected 15)
--     FAIL            : 0    (expected 0)
--     INCONCLUSIVE    : 0    (expected 0)
--     verdicts logged : 15   (must equal assertions run: OK)
--
--     VERDICT         : SAFE TO APPLY 093.
--     -----------------------------------------------------
--       T1  vendor accepts invitation     PASS      (1 row written)
--       ... fourteen more ...
--     =====================================================
--     This error IS the result. The transaction is rolled back with it.
--
-- READ THE FIRST LINE AND NOTHING ELSE IF YOU READ NOTHING ELSE:
--
--     "SAFE TO APPLY 093."        -> and only this - apply it.
--     "DO NOT APPLY 093."         -> an assertion FAILED, or the test
--                                    itself is broken. Do not apply.
--     "DO NOT APPLY 093 YET."     -> INCONCLUSIVE. Nothing failed, but
--                                    an assertion could not be exercised,
--                                    so the run says NOTHING about the
--                                    thing it was meant to prove. IT IS
--                                    NOT A GREEN LIGHT.
--
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- It is not the expected message and it never was. If you see it, the DO
-- block did not reach its RAISE - most likely the batch was run in pieces
-- or the editor swallowed the error. You have learned nothing about 093
-- and you must not apply it on that basis.
--
-- IT LEAVES NOTHING BEHIND. Every statement below - the ALTER POLICY, the
-- CREATE OR REPLACE FUNCTION, every UPDATE against real partnership rows
-- and the two writes to profiles.email in section B - is inside one
-- transaction, and the RAISE EXCEPTION aborts it. PostgreSQL rolls back
-- DDL, so after this runs the database is byte-identical to before,
-- whether 093 has been applied or not.
--
-- >>> IT WRITES TO REAL ROWS. SAID PLAINLY BECAUSE IT IS TRUE. This test
-- >>> mutates a live partnership (status, notes, timestamps) and a live
-- >>> profiles.email, because the guard can only be exercised against a
-- >>> row it is protecting. Every one of those writes is inside the
-- >>> transaction and every one is undone by the abort. If the batch is
-- >>> run in PIECES rather than as one paste, the transaction may commit
-- >>> and those writes become real. RUN IT AS ONE PASTE.
--
-- IT IS SAFE TO RUN WHETHER OR NOT 093 IS ALREADY APPLIED. The ALTER
-- POLICY and the CREATE OR REPLACE simply reinstall the same objects, and
-- the abort restores whatever was there.
--
-- =====================================================================
-- THREE WAYS THIS RUN CAN END, AND ONLY ONE OF THEM IS A VERDICT
-- =====================================================================
--
-- (1) AN ERROR WITH THE ===== BANNER AND A TALLY.  That is the report.
--     Read the headline.
--
-- (2) AN ERROR SAYING 'undefined_object' OR '42704' FROM SECTION A.
--     THAT IS NOT A CRASH AND IT IS NOT A BUG IN THIS FILE. It is the
--     ALTER POLICY failing because the policy name has drifted. 093 is
--     written to fail exactly that way rather than silently create a
--     second policy. Establish what the policy is actually called before
--     going further, with:
--
--         SELECT policyname, cmd FROM pg_policies
--         WHERE schemaname='public' AND tablename='partnerships'
--         ORDER BY policyname;
--
-- (3) "Success. No rows returned".  THE RUN DID NOT WORK. See above.
--
-- =====================================================================
-- WHAT IT IMPERSONATES, AND WHY THAT IS THE WHOLE POINT
-- =====================================================================
--
-- 093's guard turns on auth.uid() being non-null and on the caller NOT
-- being a member of the partnership's lead_org_id. Neither is true of the
-- SQL Editor's own session, so a test that just ran UPDATEs as postgres
-- would exercise EXIT 2 every time and prove nothing at all.
--
-- So each assertion sets `request.jwt.claims` and `request.jwt.claim.sub`
-- and then `SET LOCAL ROLE authenticated`. Both claim spellings are set
-- because Supabase's auth.uid() has been shipped reading each of them at
-- different versions; setting only one is how a test like this silently
-- becomes a test of EXIT 2.
--
-- If your database refuses `SET LOCAL ROLE authenticated` you will see
-- INCONCLUSIVE lines rather than passes. Replace every `SET LOCAL ROLE
-- authenticated;` with `PERFORM set_config('role', 'authenticated',
-- true);` and every `RESET ROLE;` with `PERFORM set_config('role',
-- 'none', true);`. They are equivalent - `role` is an ordinary GUC.
--
-- THE SUBJECT. A partnership that has a linked vendor organization, a
-- real member of that vendor organization, and whose lead organization
-- that member does NOT belong to. That last condition is what keeps the
-- subject on the vendor side of EXIT 3; without it every refusal
-- assertion would pass for the wrong reason.
--
-- =====================================================================
-- TWO NUMBERS MOVE TOGETHER when you add or move an assertion, and both
-- are in this file: the `expected 15` literals in the report, and the
-- `v_ran = 15 AND v_pass = 15` condition in the verdict. The self-check
-- at the foot compares v_ran against v_logged - two counters incremented
-- in different places - so it catches an assertion that ran without
-- reporting, which no eyeball review reliably does.
-- =====================================================================


BEGIN;

-- =====================================================================
-- SECTION A. 093 ITSELF. Both statements, verbatim from
-- supabase/migrations/093_partnership_claim_and_column_guard.sql.
--
-- The COMMENT ON FUNCTION from that file is NOT copied: it writes no data
-- and no schema and nothing here asserts on it.
-- =====================================================================

ALTER POLICY "Partners can claim partnership by email"
  ON public.partnerships
  USING (
    vendor_org_id IS NULL
    AND partner_email IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.id = auth.uid()
        AND pr.email IS NOT NULL
        AND lower(btrim(pr.email)) = lower(btrim(partnerships.partner_email))
    )
  )
  WITH CHECK (vendor_org_id IN (SELECT public.current_user_org_ids()));

CREATE OR REPLACE FUNCTION public.partnerships_guard_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_permitted CONSTANT text[] := ARRAY[
    'status',
    'accepted_at',
    'updated_at',
    'payment_terms_requests',
    'vendor_org_id'
  ];
  v_permitted text[];
  v_old_rest  jsonb;
  v_new_rest  jsonb;
  v_moved     text[];
BEGIN
  IF NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
    RAISE EXCEPTION
      'partnerships.lead_org_id is immutable (attempted % -> %)',
      OLD.lead_org_id, NEW.lead_org_id
      USING ERRCODE = '42501';
  END IF;

  IF OLD.vendor_org_id IS NOT NULL AND NEW.vendor_org_id IS NULL THEN
    RAISE EXCEPTION
      'partnerships.vendor_org_id cannot be cleared once set (attempted % -> NULL)',
      OLD.vendor_org_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.vendor_org_id IS DISTINCT FROM OLD.vendor_org_id
     AND NEW.vendor_org_id IS NOT NULL THEN
    IF OLD.vendor_org_id IS NOT NULL THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id cannot be repointed once set (attempted % -> %)',
        OLD.vendor_org_id, NEW.vendor_org_id
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.org_has_member_with_email(NEW.vendor_org_id, NEW.partner_email) THEN
      RAISE EXCEPTION
        'partnerships.vendor_org_id % has no member whose email matches partner_email %',
        NEW.vendor_org_id, NEW.partner_email
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_permitted := v_vendor_permitted;
  IF OLD.vendor_org_id IS NULL AND NEW.vendor_org_id IS NOT NULL THEN
    v_permitted := v_permitted || 'profile_status';
  END IF;

  v_old_rest := to_jsonb(OLD) - v_permitted;
  v_new_rest := to_jsonb(NEW) - v_permitted;

  IF v_new_rest = v_old_rest THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.lead_org_id IN (SELECT public.current_user_org_ids()) THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(k ORDER BY k)
    INTO v_moved
  FROM jsonb_object_keys(v_new_rest) AS k
  WHERE v_new_rest -> k IS DISTINCT FROM v_old_rest -> k;

  RAISE EXCEPTION 'That is not a field you can change on this partnership.'
    USING ERRCODE = 'LG009',
          DETAIL  = format(
            'partnerships.%s may not be written by the vendor on the partnership. Migration 093 guards every column on this table except %s, which are the only ones a vendor session legitimately writes, plus profile_status on the claim transition. The lead agency, the service role, a database function and a migration may all write the rest.',
            array_to_string(v_moved, ', partnerships.'),
            array_to_string(v_permitted, ', ')
          );
END;
$$;


-- =====================================================================
-- SECTION B. THE TESTS.
-- =====================================================================

DO $test$
DECLARE
  v_uid          uuid;
  v_org          uuid;
  v_lead         uuid;
  v_pship        uuid;
  v_email        text;
  v_agency_uid   uuid;
  v_ghost        uuid;
  v_ghost_email  text;
  v_claims       text;
  v_agency_claims text;
  v_rows         integer;
  v_uses_btrim   boolean;
  v_uses_ilike   boolean;
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
BEGIN
  -- THE SUBJECT. A linked vendor on a partnership whose LEAD organization
  -- that same user is NOT a member of. The NOT EXISTS is load-bearing: a
  -- subject who belonged to both sides would return at EXIT 3 on every
  -- refusal assertion and this file would report a clean run while
  -- proving nothing.
  SELECT p.id, p.vendor_org_id, p.lead_org_id, m.user_id, pr.email
    INTO v_pship, v_org, v_lead, v_uid, v_email
  FROM public.partnerships p
  JOIN public.org_members m ON m.org_id = p.vendor_org_id
  JOIN public.profiles   pr ON pr.id = m.user_id
  WHERE p.vendor_org_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.org_members m2
      WHERE m2.user_id = m.user_id AND m2.org_id = p.lead_org_id
    )
  ORDER BY p.id
  LIMIT 1;

  IF v_pship IS NULL THEN
    RAISE EXCEPTION 'No partnership exists whose vendor organization has a member who is NOT also a member of the lead organization. There is nothing to test 093''s vendor-side guard against, and every assertion in this file would have passed for the wrong reason.';
  END IF;

  -- The lead agency's side, for T12. Any member of the lead organization.
  SELECT m.user_id INTO v_agency_uid
  FROM public.org_members m
  WHERE m.org_id = v_lead
  ORDER BY m.user_id
  LIMIT 1;

  -- A live ghost row, for T15. Not created here: inserting one would have
  -- to dodge 084's UNIQUE (lead_org_id, lower(partner_email)) index, and a
  -- test that manufactures its own subject proves less than one that uses
  -- a real row.
  SELECT p.id, p.partner_email INTO v_ghost, v_ghost_email
  FROM public.partnerships p
  WHERE p.vendor_org_id IS NULL
    AND p.partner_email IS NOT NULL
    AND btrim(p.partner_email) <> ''
  ORDER BY p.id
  LIMIT 1;

  v_claims        := json_build_object('sub', v_uid::text,        'role', 'authenticated')::text;
  v_agency_claims := json_build_object('sub', v_agency_uid::text, 'role', 'authenticated')::text;

  -- START FROM A KNOWN CALLER STATE. If this batch is pasted after another
  -- that impersonated somebody, those GUCs are still set on this connection.
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  RAISE NOTICE '=====================================================';
  RAISE NOTICE '093 PRE-APPLY TEST';
  RAISE NOTICE 'vendor permit list : status, accepted_at, updated_at, payment_terms_requests, vendor_org_id';
  RAISE NOTICE 'subject user id    : %', v_uid;
  RAISE NOTICE 'subject vendor org : %', v_org;
  RAISE NOTICE 'subject lead org   : %', v_lead;
  RAISE NOTICE 'subject partnership: %', v_pship;
  RAISE NOTICE '=====================================================';

  -- ===================================================================
  -- T1 - T5. THE PERMITTED WRITES. PASS = the write SUCCEEDED.
  -- A FAIL in this block means 093 BREAKS A LIVE VENDOR ACTION ON APPLY.
  -- It is the most urgent kind of failure in this file.
  -- ===================================================================

  -- T1. W1, app/api/partnerships/route.ts:1029. Accept an invitation.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships
       SET status = 'active', accepted_at = now()
     WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('PASS', 14) || '(1 row written, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. A zero-row write is not a success.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('FAIL', 14) || 'LG009. status/accepted_at are NOT on the permit list. 093 breaks every invitation accept. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T1  vendor accepts invitation', 40) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 093.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T2. W2, app/api/partnerships/route.ts:1179. Decline an invitation.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships
       SET status = 'terminated', updated_at = now()
     WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('PASS', 14) || '(1 row written, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('FAIL', 14) || 'LG009. updated_at is NOT on the permit list. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T2  vendor declines invitation', 40) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 093.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T3. W3, app/partner/projects/page.tsx:366. Request payment terms.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships
       SET payment_terms_requests = '[{"status":"pending","note":"093 pre-apply test"}]'::jsonb
     WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('PASS', 14) || '(1 row written, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('FAIL', 14) || 'LG009. payment_terms_requests is NOT on the permit list. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T3  vendor requests payment terms', 40) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 093.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T4. >>> THE ASSERTION THE WHOLE SHAPE DEPENDS ON. <<<
  --
  -- A WHOLE-ROW WRITE naming every guarded column and CHANGING only
  -- `status`. This is what a read-modify-write PATCH produces.
  --
  -- IT PASSES ONLY BECAUSE THE GUARD COMPARES VALUES RATHER THAN THE SET
  -- CLAUSE. A trigger cannot see the SET clause at all, so any
  -- implementation that tried to refuse on "was this column named" would
  -- refuse this write for MENTIONING nda_confirmed_at while sending back
  -- the identical value. A FAIL here is the most important failure in
  -- this file.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships p
       SET status                           = 'active',
           nda_confirmed_at                 = p.nda_confirmed_at,
           nda_confirmed_by                 = p.nda_confirmed_by,
           msa_confirmed_at                 = p.msa_confirmed_at,
           msa_confirmed_by                 = p.msa_confirmed_by,
           partnership_notes                = p.partnership_notes,
           reliability_summary              = p.reliability_summary,
           reliability_summary_generated_at = p.reliability_summary_generated_at,
           partner_email                    = p.partner_email,
           profile_status                   = p.profile_status,
           pool_status                      = p.pool_status,
           invitation_message               = p.invitation_message,
           invited_at                       = p.invited_at,
           invitation_sent_at               = p.invitation_sent_at,
           contact_name                     = p.contact_name,
           company_name                     = p.company_name,
           phone                            = p.phone,
           website                          = p.website
     WHERE p.id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('PASS', 14) || '(1 row, value comparison held)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('FAIL', 14) || 'LG009 ON AN UNCHANGED VALUE. The guard is comparing the SET clause, not values. Every read-modify-write in the product breaks. DO NOT APPLY.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T4  whole-row RMW, only status moves', 40) || rpad('FAIL', 14) || format('%s %s  DO NOT APPLY 093.', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T5. THE NO-OP. Nothing moves at all. Must leave at exit 1 without
  -- calling auth.uid() or issuing a query.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships p SET status = p.status WHERE p.id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 1 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('PASS', 14) || '(1 row, exit 1)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T5  no-op write', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T6 - T10. THE REFUSALS. PASS = the write RAISED LG009.
  -- A "no error" here is the hole still being open.
  -- ===================================================================

  -- T6. Self-confirming the NDA the agency is supposed to confirm.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships SET nda_confirmed_at = now() WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). OPEN-092-9 IS STILL OPEN. DO NOT APPLY on the belief it is closed.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T6  vendor self-confirms NDA', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T7. Rewriting the agency's private notes, which hold {blacklisted}.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships SET partnership_notes = '{"blacklisted":false}'::jsonb WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The vendor can still rewrite the agency''s notes.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T7  vendor un-blacklists itself', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T8. Authoring its own AI performance narrative.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships SET reliability_summary = 'Flawless.' WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The vendor can still author the agency''s view of its performance.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T8  vendor writes own reliability', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T9. Rewriting the pre-claim identifier the claim policy keys on.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships SET partner_email = 'moved@example.com' WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The claim key is still vendor-writable.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('PASS', 14) || '(LG009, refused)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T9  vendor rewrites partner_email', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T10. profile_status OUTSIDE the claim transition. This is the
  -- conditional half of the permit list. The row already has a
  -- vendor_org_id, so 'profile_status' is NOT on the list for this write
  -- and 'removed' must be refused - it is how an agency hides a row from
  -- its own pool.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships SET profile_status = 'removed' WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). The conditional permit is unconditional. DO NOT APPLY.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('PASS', 14) || '(LG009, refused off the claim transition)';
      v_pass := v_pass + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T10 profile_status, not a claim', 40) || rpad('FAIL', 14) || format('refused with %s, expected LG009: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T11. 087 IS STILL THERE AND STILL SPEAKS FIRST.
  -- PASS = 42501 carrying 087's own message, NOT LG009. If this returns
  -- LG009 the permit list has been placed ABOVE 087's refusals and the
  -- specific diagnosis has been replaced by a generic one.
  -- ===================================================================
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships SET lead_org_id = v_org WHERE id = v_pship;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('FAIL', 14) || format('NO ERROR - wrote %s row(s). MIGRATION 087 HAS BEEN UNDONE by this file. DO NOT APPLY.', v_rows);
    v_fail := v_fail + 1;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      -- 42501 is BOTH 087's chosen ERRCODE and the code for a missing
      -- table grant, so the message is what tells them apart.
      IF SQLERRM LIKE '%lead_org_id is immutable%' THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('PASS', 14) || '(42501, 087''s own message, ahead of the permit list)';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('INCONCLUSIVE', 14) || format('42501 but not 087''s message: %s', SQLERRM);
        v_inconc := v_inconc + 1;
      END IF;
    WHEN sqlstate 'LG009' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('FAIL', 14) || 'LG009, not 087''s 42501. The permit list is running BEFORE 087''s refusals and has replaced a precise diagnosis with a generic one.';
      v_fail := v_fail + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T11 087 lead_org_id immutable', 40) || rpad('FAIL', 14) || format('refused with %s: %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- ===================================================================
  -- T12. THE AGENCY SIDE IS UNAFFECTED. EXIT 3.
  -- The lead agency writing nda_confirmed_at is the LEGITIMATE writer
  -- (app/api/partnerships/route.ts:849). PASS = it still succeeds.
  -- ===================================================================
  v_ran := v_ran + 1;
  IF v_agency_uid IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T12 lead agency confirms NDA', 40) || rpad('INCONCLUSIVE', 14) || 'the lead organization has no org_members row. Exit 3 was never exercised.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    v_agency_claims,    true);
      PERFORM set_config('request.jwt.claim.sub', v_agency_uid::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE public.partnerships SET nda_confirmed_at = now(), nda_confirmed_by = v_agency_uid WHERE id = v_pship;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;
      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 lead agency confirms NDA', 40) || rpad('PASS', 14) || '(1 row, exit 3)';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 lead agency confirms NDA', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. 093 BREAKS NDA CONFIRMATION.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN sqlstate 'LG009' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 lead agency confirms NDA', 40) || rpad('FAIL', 14) || 'LG009 AT THE AGENCY. Exit 3 is not working and 093 breaks every NDA and MSA confirmation. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 lead agency confirms NDA', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
        v_inconc := v_inconc + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T12 lead agency confirms NDA', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  -- ===================================================================
  -- T13 - T15. HOLE 1, THE CLAIM POLICY.
  -- ===================================================================

  -- T13. THE PREDICATE ITSELF. Structural, and it is here because it is
  -- the only assertion that cannot be faked by the data happening to
  -- cooperate: it reads what the policy actually says.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    SELECT qual LIKE '%btrim%', qual LIKE '%~~*%'
      INTO v_uses_btrim, v_uses_ilike
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'partnerships'
      AND policyname = 'Partners can claim partnership by email';
    IF v_uses_btrim IS NULL THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('FAIL', 14) || 'the policy does not exist under that name. The ALTER in section A cannot have run.';
      v_fail := v_fail + 1;
    ELSIF v_uses_btrim AND NOT v_uses_ilike THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('PASS', 14) || '(btrim present, ~~* gone)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('FAIL', 14) || format('btrim=%s ilike=%s. OPEN-092-8 IS STILL OPEN.', v_uses_btrim, v_uses_ilike);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T13 claim predicate is equality', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T14. THE WILDCARD, BEHAVIOURALLY. The subject's profile email is set
  -- to '%' - as postgres, which 091's guard exempts - and they then
  -- attempt to claim EVERY unclaimed row in one statement. Under the old
  -- ILIKE predicate that matched all of them. PASS = it matches ZERO.
  --
  -- A 23514 here is ALSO a failure: that is 087's trigger firing, which
  -- means rows DID match the policy and the wildcard is still live.
  v_ran := v_ran + 1;
  BEGIN
    RESET ROLE;
    -- CLEAR THE CLAIMS BEFORE WRITING AS postgres. set_config(..., true) is
    -- LOCAL TO THE TRANSACTION, not to the statement, so the sub set by T1
    -- is STILL SET here. Without this, auth.uid() is non-null while the role
    -- is postgres, migration 091's guard sees a signed-in caller moving
    -- profiles.email, and this assertion dies with LG00x for a reason that
    -- has nothing to do with 093.
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    UPDATE public.profiles SET email = '%' WHERE id = v_uid;
    PERFORM set_config('request.jwt.claims',    v_claims,    true);
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.partnerships SET vendor_org_id = v_org WHERE vendor_org_id IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows = 0 THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('PASS', 14) || '(0 rows matched)';
      v_pass := v_pass + 1;
    ELSE
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('FAIL', 14) || format('CLAIMED %s GHOST ROW(S) WITH THE EMAIL "%%". OPEN-092-8 IS STILL OPEN. DO NOT APPLY on the belief it is closed.', v_rows);
      v_fail := v_fail + 1;
    END IF;
  EXCEPTION
    WHEN sqlstate '23514' THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('FAIL', 14) || '087''s trigger fired, which means rows MATCHED the claim policy. The wildcard is still live.';
      v_fail := v_fail + 1;
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
      v_inconc := v_inconc + 1;
    WHEN OTHERS THEN
      RESET ROLE;
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad('T14 wildcard email claims nothing', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
      v_fail := v_fail + 1;
  END;

  -- T15. >>> THE OTHER DIRECTION, AND THE ONE THAT BREAKS PRODUCTION. <<<
  -- A LEGITIMATE claim must still be admitted. The subject's email is set
  -- to a real ghost row's partner_email and they claim that one row,
  -- writing profile_status alongside vendor_org_id exactly as W4 does -
  -- which also exercises the conditional half of the permit list from the
  -- permitted side. PASS = 1 row.
  v_ran := v_ran + 1;
  IF v_ghost IS NULL THEN
    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('T15 legitimate claim still works', 40) || rpad('INCONCLUSIVE', 14) || 'no unclaimed partnership with a partner_email exists. THE CLAIM PATH WAS NEVER EXERCISED - this run does NOT show 093 leaves it working.';
    v_inconc := v_inconc + 1;
  ELSE
    BEGIN
      RESET ROLE;
      -- Same reason as T14: clear the claims so 091's guard exempts this
      -- write as an unauthenticated one.
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      UPDATE public.profiles SET email = v_ghost_email WHERE id = v_uid;
      PERFORM set_config('request.jwt.claims',    v_claims,    true);
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE public.partnerships
         SET vendor_org_id = v_org, profile_status = 'active', updated_at = now()
       WHERE id = v_ghost;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RESET ROLE;
      IF v_rows = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T15 legitimate claim still works', 40) || rpad('PASS', 14) || '(1 row, profile_status permitted on the transition)';
        v_pass := v_pass + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T15 legitimate claim still works', 40) || rpad('FAIL', 14) || format('matched %s rows, expected 1. 093 BREAKS THE CLAIM PATH. DO NOT APPLY.', v_rows);
        v_fail := v_fail + 1;
      END IF;
    EXCEPTION
      WHEN sqlstate 'LG009' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T15 legitimate claim still works', 40) || rpad('FAIL', 14) || 'LG009. profile_status is NOT being added on the claim transition. W4 (app/auth/callback/route.ts:183) breaks on apply. DO NOT APPLY.';
        v_fail := v_fail + 1;
      WHEN sqlstate '23514' THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T15 legitimate claim still works', 40) || rpad('INCONCLUSIVE', 14) || '087''s org_has_member_with_email refused. The subject is not reachable at that email through org_members, so this says nothing about 093.';
        v_inconc := v_inconc + 1;
      WHEN insufficient_privilege THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T15 legitimate claim still works', 40) || rpad('INCONCLUSIVE', 14) || '42501. See the header on SET LOCAL ROLE.';
        v_inconc := v_inconc + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad('T15 legitimate claim still works', 40) || rpad('FAIL', 14) || format('%s %s', SQLSTATE, SQLERRM);
        v_fail := v_fail + 1;
    END;
  END IF;

  RESET ROLE;

  IF v_fail = 0 AND v_inconc = 0 AND v_ran = 15 AND v_pass = 15 THEN
    v_verdict_text := 'SAFE TO APPLY 093.';
    v_headline     := format('SAFE TO APPLY 093.  All %s assertions passed.', v_pass);
  ELSIF v_inconc > 0 AND v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised - read the INCONCLUSIVE line below. Settle it before applying.';
    -- NOT A GREEN LIGHT, and the first line has to say so. Nothing FAILED,
    -- but something 093 exists to do was never actually attempted, so this
    -- run says nothing at all about it.
    v_headline     := format('DO NOT APPLY 093 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 093 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline     := format('DO NOT APPLY 093.  %s assertion(s) FAILED.', v_fail);
  END IF;

  -- THE SELF-CHECK OVERRIDES THE HEADLINE. If an assertion ran without
  -- logging a line, the report is incomplete and no verdict drawn from it
  -- can be trusted, INCLUDING A CLEAN ONE. That has to outrank SAFE TO
  -- APPLY, so it is applied after the condition above rather than folded
  -- into it.
  IF v_logged <> v_ran THEN
    v_headline := format('DO NOT APPLY 093.  THE TEST ITSELF IS BROKEN: %s assertions ran but %s logged a verdict. The report below is incomplete and no verdict drawn from it means anything.', v_ran, v_logged);
  END IF;

  -- =================================================================
  -- THE REPORT.
  --
  -- ORDER IS LOAD-BEARING: HEADLINE, THEN TALLY, THEN THE PER-ASSERTION
  -- LINES. A client that truncates a long error message truncates the
  -- END of it, so the verdict and the counts must be at the TOP where
  -- they survive. The 15 detail lines are the part that can afford to be
  -- cut off - if they are, the tally still says how many failed and the
  -- headline still says whether to apply.
  -- =================================================================
  v_report :=
       E'\n'
    || E'=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected 15)\n', v_ran)
    || format(E'PASS            : %s   (expected 15)\n', v_pass)
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
    || 'PERMIT LIST     : status, accepted_at, updated_at, payment_terms_requests, vendor_org_id' || E'\n'
    || '                  (+ profile_status on the claim transition only)' || E'\n'
    || format(E'SUBJECT         : user %s, vendor org %s, partnership %s\n', v_uid, v_org, v_pship)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  -- >>> THE RESULT ARRIVES AS AN ERROR, AND THAT IS THE DESIGN. <<<
  --
  -- NO CUSTOM ERRCODE. This is not a database condition and must never be
  -- mistaken for one of the LG0xx codes 089 to 093 define. The default
  -- P0001 (raise_exception) is correct and deliberate.
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
-- transaction is still open and still holds an ALTER POLICY, a CREATE OR
-- REPLACE FUNCTION, a dozen UPDATEs against a real partnership, TWO
-- WRITES TO A REAL profiles.email, and one claim against a real ghost
-- row. This line is the only thing that undoes them.
-- =====================================================================
ROLLBACK;
