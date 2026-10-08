-- =====================================================================
-- 107 PRE-APPLY TEST. ONE PASTE. APPLIES 107 AND 108, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-08 on fix/107-reliability-split. NOT RUN: THERE IS NO LOCAL POSTGRES AND
-- NO CREDENTIALS HERE, so this file was READ, NOT PARSED. Expect to fix a typo on the first run;
-- a typo ends in a plain error, not in "SAFE TO APPLY".
-- GENERATED so that the inlined migration code is byte-identical to the migration files.
--
-- WHY THIS FILE EXISTS. 107 creates the table that holds the lead agency's private reliability narrative and 108 empties the columns a vendor can read.
-- A table that is too open leaks and one that is too closed breaks the Performance History panel; neither raises anything at
-- apply time. This file exercises both, as every party, in a transaction that rolls back.
--
-- >>> THE LEAK WINDOW IS MEASURED, NOT ASSUMED. Phase 2 (after 107, before 108) shows the vendor STILL
-- >>> reading the summary and its timestamp. That is expected and is reported as such. It closes only in phase 3.
--
-- EVERY ASSERTION RUNS IN EVERY PHASE (like 102 did): phase 1 BEFORE 107, phase 2 AFTER 107 and BEFORE 108, phase 3 AFTER 108.
-- The BEFORE column MEASURES the defect rather than assuming it: the vendor scenarios V3 and V3b must
-- show the vendor READING the summary and its timestamp today. If they do not, the verdict is INCONCLUSIVE.
-- V3 and V3b are separate because the two columns are separate columns: a timestamp can leak or be
-- closed independently of the text, and this file reports them independently. They are expected to move
-- together here because the migrations copy and null them as a pair.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch. Do NOT run it in pieces.
--   3. READ THE ERROR MESSAGE. That is where the result is.
--
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT. <<<
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- READ THE FIRST LINE:
--     "SAFE TO APPLY 107."       -> and only this.
--     "DO NOT APPLY 107 YET."    -> INCONCLUSIVE. Not a green light.
--     "DO NOT APPLY 107."        -> an assertion FAILED, or the test is broken.
--
-- THIS FILE DEFINES NO FUNCTION IN pg_temp (the SQL Editor returns 3F000 for them) and no temp
-- table. The only objects it creates are the migration's own, inside the rolled-back transaction.
--
-- THE SQL EDITOR MAY ASK YOU TO CONFIRM. UPDATE text inside a DO block may trigger a warning.
-- Confirm: it is inside a rolled-back transaction.
--
-- =====================================================================
-- IT IMPERSONATES, AND PROVES IT DID
-- =====================================================================
-- Each scenario sets request.jwt.claims and request.jwt.claim.sub and then SET LOCAL ROLE, then
-- READS auth.uid() (or current_user for service_role and anon) BACK and raises LG098 if it is not
-- the intended identity. LG098 is reported as INCONCLUSIVE with the words TEST FAULT.
--
-- ISOLATION. Every scenario runs in its own nested BEGIN ... EXCEPTION block and ends in
-- RAISE EXCEPTION ... ERRCODE 'LG097', which that block's own handler swallows, undoing the setup
-- write, the attempted write, the role switch and the claims. A fingerprint of every partnerships
-- row AND of the reliability table is taken at the start of each phase and recomputed after EACH
-- scenario; any difference ends the run with "THE TEST ITSELF IS BROKEN".
--
-- ACTORS: vendor (a member of the vendor organization on the subject partnership, not of its lead
-- organization), vendor_pure (the same user, only if they lead no partnership at all, so "all rows"
-- reads are meaningful), agency (a member of the lead organization), agency_x (the same, for the
-- scenarios that need a partnership led by somebody else), other (a member of a DIFFERENT lead
-- organization), service (SET LOCAL ROLE service_role), anon (SET LOCAL ROLE anon).
-- NO SUBJECT for any of them is reported, NEVER passed. EXPECT NO SUBJECT for agency_x, other and
-- therefore A6, A7, B1, B2, B3: one lead organization holds every partnership and it is the only one
-- with members. That is structural, not a defect of this file, and it means cross-agency isolation is
-- NOT shown by this run. It would be shown by a second lead organization with a member and a partnership.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * EXECUTE of a multi-statement string (the inlined migration) is accepted.
--   * CREATE TABLE / CREATE FUNCTION / CREATE TRIGGER inside the DO block, after rolled-back
--     writes to the same tables, does not hit 55006 "pending trigger events".
--   * BEFORE INSERT triggers fire before the INSERT policy's WITH CHECK, so A6 and A7 are
--     refused by the guard (LG107) rather than by the policy (42501). Either is a refusal; the
--     expectation accepts any REFUSED.
--   * A table-owner UPDATE of partnerships inside the DO block does not trip the 093 column guard.
--     (The 105 test relied on the same thing for partnership_notes.)
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 30;
  c_phases       CONSTANT integer := 3;
  v_pship        uuid;
  v_lead         uuid;
  v_vorg         uuid;
  v_uid          uuid;
  v_pure         boolean;
  v_agency_uid   uuid;
  v_other_uid    uuid;
  v_other_pship  uuid;
  v_other_lead   uuid;
  v_claims       text;
  v_agency_claims text;
  v_other_claims text;
  v_txt          text;
  v_actor        text;
  v_ph           integer;
  v_i            integer;
  v_k            integer;
  v_idx          integer;
  v_fp0          text;
  v_fp           text;
  v_fpn          text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_pol_before   text;
  v_pol_after    text;
  v_acl_before   text;
  v_acl_after    text;
  v_ok           boolean;
  v_detail       text;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_ran          integer := 0;
  v_logged       integer := 0;
  v_lines        text := '';
  v_ba           text := '';
  v_headline     text;
  v_verdict_text text;
  v_report       text;
  v_apply_err    text[] := ARRAY[]::text[];
  v_cls          text;
  v_exp          text;
  v_st           text;
  v_n_a          integer;
  v_n_b          integer;
  v_n_c          integer;
  v_window       text := '';
  v_bf           text := NULL;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_sql    text[];
  sc_exp    text[];   -- flattened: (scenario - 1) * c_phases + phase
  r_cls     text[];   -- flattened the same way
BEGIN
  ---------------------------------------------------------------------
  -- SUBJECT. NO SUBJECT IS REPORTED, NEVER PASSED.
  ---------------------------------------------------------------------
  SELECT p.id, p.vendor_org_id, p.lead_org_id, m.user_id
    INTO v_pship, v_vorg, v_lead, v_uid
  FROM public.partnerships p
  JOIN public.org_members m ON m.org_id = p.vendor_org_id
  WHERE p.vendor_org_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.org_members m2
      WHERE m2.user_id = m.user_id AND m2.org_id = p.lead_org_id
    )
  ORDER BY (NOT EXISTS (
              SELECT 1 FROM public.org_members m3
              JOIN public.partnerships p3 ON p3.lead_org_id = m3.org_id
              WHERE m3.user_id = m.user_id)) DESC,
           p.id
  LIMIT 1;

  IF v_pship IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 107 YET.  NO SUBJECT: no partnership has a vendor organization with a member who is not also a member of the lead organization. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  v_pure := NOT EXISTS (
    SELECT 1 FROM public.org_members m3
    JOIN public.partnerships p3 ON p3.lead_org_id = m3.org_id
    WHERE m3.user_id = v_uid);

  SELECT m.user_id INTO v_agency_uid
  FROM public.org_members m
  WHERE m.org_id = v_lead
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id = v_vorg)
  ORDER BY m.user_id
  LIMIT 1;

  SELECT m.user_id, p.id, p.lead_org_id INTO v_other_uid, v_other_pship, v_other_lead
  FROM public.partnerships p
  JOIN public.org_members m ON m.org_id = p.lead_org_id
  WHERE p.lead_org_id <> v_lead AND p.id <> v_pship
    AND NOT EXISTS (SELECT 1 FROM public.org_members x
                     WHERE x.user_id = m.user_id AND x.org_id IN (v_lead, v_vorg))
  ORDER BY p.id, m.user_id
  LIMIT 1;

  v_claims        := json_build_object('sub', v_uid::text,        'role', 'authenticated')::text;
  v_agency_claims := json_build_object('sub', v_agency_uid::text, 'role', 'authenticated')::text;
  v_other_claims  := json_build_object('sub', v_other_uid::text,  'role', 'authenticated')::text;

  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  sc_id := ARRAY[
    $q$V1$q$,
    $q$V2$q$,
    $q$V3$q$,
    $q$V3b$q$,
    $q$V4$q$,
    $q$V5$q$,
    $q$V6$q$,
    $q$V7$q$,
    $q$V8$q$,
    $q$A1$q$,
    $q$A2$q$,
    $q$A3$q$,
    $q$A4$q$,
    $q$A5$q$,
    $q$A6$q$,
    $q$A7$q$,
    $q$B1$q$,
    $q$B2$q$,
    $q$B3$q$,
    $q$Z1$q$,
    $q$Z2$q$,
    $q$Z3$q$,
    $q$Z4$q$];

  sc_label := ARRAY[
    $q$V1  vendor: select * on its partnership$q$,
    $q$V2  vendor: reads the columns it needs$q$,
    $q$V3  vendor: reads reliability_summary$q$,
    $q$V3b vendor: reads the generated_at stamp$q$,
    $q$V4  vendor: reads the table (its row)$q$,
    $q$V5  vendor: reads the table (all rows)$q$,
    $q$V6  vendor: inserts into the table$q$,
    $q$V7  vendor: updates the table$q$,
    $q$V8  vendor: deletes from the table$q$,
    $q$A1  agency: select * on the partnership$q$,
    $q$A2  agency: reads the legacy column$q$,
    $q$A3  agency: reads its cache from the table$q$,
    $q$A4  agency: updates its cache in the table$q$,
    $q$A5  agency: upserts (insert on conflict update)$q$,
    $q$A6  agency: cache for a partnership it does not lead (own org)$q$,
    $q$A7  agency: cache for a partnership it does not lead (their org)$q$,
    $q$B1  other agency: reads this agency's cache$q$,
    $q$B2  other agency: updates this agency's cache$q$,
    $q$B3  other agency: select * on this partnership$q$,
    $q$Z1  service role: reads the table$q$,
    $q$Z2  service role: upserts the table$q$,
    $q$Z3  anon: reads the table$q$,
    $q$Z4  anon: reads partnerships.reliability_summary$q$];

  sc_actor := ARRAY[
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor_pure$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency_x$q$,
    $q$agency_x$q$,
    $q$other$q$,
    $q$other$q$,
    $q$other$q$,
    $q$service$q$,
    $q$service$q$,
    $q$anon$q$,
    $q$anon$q$];

  sc_sql := ARRAY[
    $q$SELECT count(*)::text FROM (SELECT * FROM public.partnerships WHERE id = %1$L) x$q$,
    $q$SELECT count(*)::text FROM (SELECT id, status, lead_org_id, vendor_org_id, accepted_at, partner_email, payment_terms_requests FROM public.partnerships WHERE id = %1$L) x$q$,
    $q$SELECT coalesce((SELECT reliability_summary FROM public.partnerships WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT (reliability_summary_generated_at IS NOT NULL)::text FROM public.partnerships WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT count(*)::text FROM public.partnership_private_reliability WHERE partnership_id = %1$L$q$,
    $q$SELECT count(*)::text FROM public.partnership_private_reliability$q$,
    $q$WITH i AS (INSERT INTO public.partnership_private_reliability (partnership_id, lead_org_id, reliability_summary, reliability_summary_generated_at) VALUES (%1$L, %2$L, 'X', now()) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH u AS (UPDATE public.partnership_private_reliability SET reliability_summary = 'EDITED', updated_at = now() WHERE partnership_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH d AS (DELETE FROM public.partnership_private_reliability WHERE partnership_id = %1$L RETURNING 1) SELECT count(*)::text FROM d$q$,
    $q$SELECT count(*)::text FROM (SELECT * FROM public.partnerships WHERE id = %1$L) x$q$,
    $q$SELECT coalesce((SELECT reliability_summary FROM public.partnerships WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT reliability_summary FROM public.partnership_private_reliability WHERE partnership_id = %1$L), 'NULL')$q$,
    $q$WITH u AS (UPDATE public.partnership_private_reliability SET reliability_summary = 'EDITED', reliability_summary_generated_at = now(), updated_at = now() WHERE partnership_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (INSERT INTO public.partnership_private_reliability (partnership_id, lead_org_id, reliability_summary, reliability_summary_generated_at) VALUES (%1$L, %2$L, 'UPSERTED', now()) ON CONFLICT (partnership_id) DO UPDATE SET reliability_summary = EXCLUDED.reliability_summary, reliability_summary_generated_at = EXCLUDED.reliability_summary_generated_at RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH i AS (INSERT INTO public.partnership_private_reliability (partnership_id, lead_org_id, reliability_summary) VALUES (%3$L, %2$L, 'X') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.partnership_private_reliability (partnership_id, lead_org_id, reliability_summary) VALUES (%3$L, %4$L, 'X') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$SELECT count(*)::text FROM public.partnership_private_reliability WHERE partnership_id = %1$L$q$,
    $q$WITH u AS (UPDATE public.partnership_private_reliability SET reliability_summary = 'EDITED', updated_at = now() WHERE partnership_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM (SELECT * FROM public.partnerships WHERE id = %1$L) x$q$,
    $q$SELECT count(*)::text FROM public.partnership_private_reliability WHERE partnership_id = %1$L$q$,
    $q$WITH u AS (INSERT INTO public.partnership_private_reliability (partnership_id, lead_org_id, reliability_summary, reliability_summary_generated_at) VALUES (%1$L, %2$L, 'UPSERTED', now()) ON CONFLICT (partnership_id) DO UPDATE SET reliability_summary = EXCLUDED.reliability_summary RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.partnership_private_reliability WHERE partnership_id = %1$L$q$,
    $q$SELECT coalesce((SELECT reliability_summary FROM public.partnerships WHERE id = %1$L), 'NULL')$q$];

  sc_exp := ARRAY[
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
    $q$OK:true$q$,
    $q$OK:true$q$,
    $q$OK:false$q$,
    $q$NOTABLE$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$NOTABLE$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$NOTABLE$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$NOTABLE$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$NOTABLE$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
    $q$NOTABLE$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:SENTINEL$q$,
    $q$NOTABLE$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$NOTABLE$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$NOTABLE$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$NOTABLE$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$NOTABLE$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$NOTABLE$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$NOTABLE$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$NOTABLE$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$NOTABLE$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$OK:NULL$q$,
    $q$OK:NULL$q$,
    $q$OK:NULL$q$];


  v_n_a := array_length(sc_id, 1);
  IF v_n_a <> 23 OR array_length(sc_label, 1) <> v_n_a OR array_length(sc_actor, 1) <> v_n_a
     OR array_length(sc_sql, 1) <> v_n_a OR array_length(sc_exp, 1) <> v_n_a * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (id %, label %, actor %, sql %, exp %)',
      array_length(sc_id, 1), array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_sql, 1), array_length(sc_exp, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n_a * c_phases]);

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';

  SELECT relacl::text INTO v_acl_before FROM pg_class WHERE oid = 'public.partnerships'::regclass;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE. Between phases the migration code is
  -- executed in this same transaction.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), ''));
    v_fpn := '';
    IF to_regclass('public.partnership_private_reliability') IS NOT NULL THEN
      EXECUTE 'SELECT md5(coalesce(string_agg(x::text, ''|'' ORDER BY x.partnership_id), '''')) FROM public.partnership_private_reliability x' INTO v_fpn;
    END IF;
    v_fp0 := v_fp0 || v_fpn;

    FOR v_i IN 1 .. v_n_a LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];

      IF (v_actor = 'agency' AND v_agency_uid IS NULL)
         OR (v_actor = 'agency_x' AND (v_agency_uid IS NULL OR v_other_pship IS NULL))
         OR (v_actor = 'other' AND v_other_uid IS NULL)
         OR (v_actor = 'vendor_pure' AND NOT v_pure) THEN
        r_cls[v_idx] := 'NOSUBJECT';
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          -- Setup as the OWNER, per phase. Undone with the scenario.
          CASE v_ph
            WHEN 1 THEN
              EXECUTE format($s$UPDATE public.partnerships SET reliability_summary = 'SENTINEL', reliability_summary_generated_at = '2026-01-01 00:00:00+00' WHERE id = %1$L$s$, v_pship, v_lead);
            WHEN 2 THEN
              EXECUTE format($s$UPDATE public.partnerships SET reliability_summary = 'SENTINEL', reliability_summary_generated_at = '2026-01-01 00:00:00+00' WHERE id = %1$L$s$, v_pship, v_lead);
              EXECUTE format($s$INSERT INTO public.partnership_private_reliability (partnership_id, lead_org_id, reliability_summary, reliability_summary_generated_at) VALUES (%1$L, %2$L, 'SENTINEL', '2026-01-01 00:00:00+00') ON CONFLICT (partnership_id) DO UPDATE SET reliability_summary = EXCLUDED.reliability_summary, reliability_summary_generated_at = EXCLUDED.reliability_summary_generated_at$s$, v_pship, v_lead);
            WHEN 3 THEN
              EXECUTE format($s$INSERT INTO public.partnership_private_reliability (partnership_id, lead_org_id, reliability_summary, reliability_summary_generated_at) VALUES (%1$L, %2$L, 'SENTINEL', '2026-01-01 00:00:00+00') ON CONFLICT (partnership_id) DO UPDATE SET reliability_summary = EXCLUDED.reliability_summary, reliability_summary_generated_at = EXCLUDED.reliability_summary_generated_at$s$, v_pship, v_lead);
          END CASE;

          IF v_actor IN ('vendor', 'vendor_pure') THEN
            PERFORM set_config('request.jwt.claims',    v_claims,    true);
            PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (vendor): auth.uid() is %, expected %', auth.uid(), v_uid USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor IN ('agency', 'agency_x') THEN
            PERFORM set_config('request.jwt.claims',    v_agency_claims,    true);
            PERFORM set_config('request.jwt.claim.sub', v_agency_uid::text, true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_agency_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (agency): auth.uid() is %, expected %', auth.uid(), v_agency_uid USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'other' THEN
            PERFORM set_config('request.jwt.claims',    v_other_claims,    true);
            PERFORM set_config('request.jwt.claim.sub', v_other_uid::text, true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_other_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (other agency): auth.uid() is %, expected %', auth.uid(), v_other_uid USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'service' THEN
            SET LOCAL ROLE service_role;
            IF current_user <> 'service_role' THEN
              RAISE EXCEPTION 'impersonation mismatch (service): current_user is %', current_user USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'anon' THEN
            SET LOCAL ROLE anon;
            IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
              RAISE EXCEPTION 'impersonation mismatch (anon): current_user is %, uid %', current_user, auth.uid() USING ERRCODE = 'LG098';
            END IF;
          END IF;

          EXECUTE format(sc_sql[v_i], v_pship, v_lead, v_other_pship, v_other_lead) INTO v_txt;
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);

          r_cls[v_idx] := 'OK:' || coalesce(v_txt, 'NULL');
          RAISE EXCEPTION 'scenario % complete: undoing its writes', sc_id[v_i] USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN
            NULL;
          WHEN OTHERS THEN
            r_cls[v_idx] := CASE
              WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
              WHEN SQLSTATE = '42P01' THEN 'NOTABLE'
              WHEN SQLSTATE IN ('42501', 'LG107', 'LG108') THEN 'REFUSED:' || SQLSTATE
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), ''));
      v_fpn := '';
      IF to_regclass('public.partnership_private_reliability') IS NOT NULL THEN
        EXECUTE 'SELECT md5(coalesce(string_agg(x::text, ''|'' ORDER BY x.partnership_id), '''')) FROM public.partnership_private_reliability x' INTO v_fpn;
      END IF;
      v_iso_runs := v_iso_runs + 1;
      IF (v_fp || v_fpn) IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc_id[v_i] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;

    -- The migration code, executed between phases, in this transaction.
    IF v_ph = 1 THEN
      RESET ROLE;
      BEGIN
        EXECUTE $m107$

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.partnerships') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '107 refuses to apply: public.partnerships or public.organizations does not exist.'
      USING ERRCODE = 'LG107';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '107 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG107';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'partnerships'
         AND column_name IN ('reliability_summary', 'reliability_summary_generated_at')) <> 2 THEN
    RAISE EXCEPTION '107 refuses to apply: partnerships.reliability_summary or reliability_summary_generated_at does not exist, so there is nothing to copy.'
      USING ERRCODE = 'LG107';
  END IF;

  IF to_regclass('public.partnership_private_reliability') IS NOT NULL THEN
    RAISE EXCEPTION '107 refuses to apply: public.partnership_private_reliability already exists. Read the schema before going further.'
      USING ERRCODE = 'LG107';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. THE TABLE. The summary and its timestamp are ONE row: they are read and written together.
-- ---------------------------------------------------------------------
CREATE TABLE public.partnership_private_reliability (
  partnership_id                   uuid        PRIMARY KEY REFERENCES public.partnerships (id) ON DELETE CASCADE,
  lead_org_id                      uuid        NOT NULL    REFERENCES public.organizations (id),
  reliability_summary              text,
  reliability_summary_generated_at timestamptz,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX partnership_private_reliability_lead_org_id_idx
  ON public.partnership_private_reliability (lead_org_id);

COMMENT ON TABLE public.partnership_private_reliability IS
  'Migration 107. The cached AI reliability narrative about a vendor and the time it was computed. It is computed over EVERY completed delivery review, shared with the vendor or not (073), so it is the lead agency''s private view. Agency-only: there is NO vendor policy. Replaces partnerships.reliability_summary and reliability_summary_generated_at, which a vendor can read through the whole-row SELECT policy.';

-- ---------------------------------------------------------------------
-- 2. THE GUARD. Keeps lead_org_id equal to the partnership's, and both key columns immutable.
--    It runs for every caller, the service role included.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partnership_private_reliability_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.partnership_id IS DISTINCT FROM OLD.partnership_id
       OR NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
      RAISE EXCEPTION 'partnership_private_reliability.partnership_id and lead_org_id cannot be changed'
        USING ERRCODE = 'LG107';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT. Read under the CALLER's row level security: an agency member sees only the
  -- partnerships its own organizations lead, so a partnership it does not lead is "not found".
  SELECT p.lead_org_id INTO v_lead FROM public.partnerships p WHERE p.id = NEW.partnership_id;

  IF v_lead IS NULL OR v_lead IS DISTINCT FROM NEW.lead_org_id THEN
    RAISE EXCEPTION 'partnership_private_reliability: lead_org_id must be the lead organization of an existing partnership the caller can see'
      USING ERRCODE = 'LG107';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER partnership_private_reliability_guard
  BEFORE INSERT OR UPDATE ON public.partnership_private_reliability
  FOR EACH ROW
  EXECUTE FUNCTION public.partnership_private_reliability_guard();

REVOKE EXECUTE ON FUNCTION public.partnership_private_reliability_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partnership_private_reliability_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partnership_private_reliability_guard() FROM authenticated;

-- ---------------------------------------------------------------------
-- 3. PRIVILEGES. anon gets nothing, by name. authenticated gets SELECT, INSERT, UPDATE only.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.partnership_private_reliability FROM PUBLIC;
REVOKE ALL ON TABLE public.partnership_private_reliability FROM anon;
REVOKE ALL ON TABLE public.partnership_private_reliability FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.partnership_private_reliability TO authenticated;
GRANT ALL ON TABLE public.partnership_private_reliability TO service_role;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY. THREE POLICIES. NONE IS FOR A VENDOR. NO DELETE POLICY.
-- ---------------------------------------------------------------------
ALTER TABLE public.partnership_private_reliability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partnership_private_reliability_org_select"
  ON public.partnership_private_reliability AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partnership_private_reliability_org_insert"
  ON public.partnership_private_reliability AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partnership_private_reliability_org_update"
  ON public.partnership_private_reliability AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

-- ---------------------------------------------------------------------
-- 5. BACKFILL. A COPY of every row holding either column. The legacy columns are NOT touched (108 does that).
-- ---------------------------------------------------------------------
INSERT INTO public.partnership_private_reliability
  (partnership_id, lead_org_id, reliability_summary, reliability_summary_generated_at)
SELECT p.id, p.lead_org_id, p.reliability_summary, p.reliability_summary_generated_at
FROM public.partnerships p
WHERE p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL
ON CONFLICT (partnership_id) DO NOTHING;

DO $backfill_check$
DECLARE
  v_src      bigint;
  v_dst      bigint;
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_src FROM public.partnerships
   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.partnership_private_reliability;
  SELECT count(*) INTO v_mismatch
  FROM public.partnerships p
  LEFT JOIN public.partnership_private_reliability n ON n.partnership_id = p.id
  WHERE (p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL)
    AND (n.partnership_id IS NULL
         OR n.reliability_summary IS DISTINCT FROM p.reliability_summary
         OR n.reliability_summary_generated_at IS DISTINCT FROM p.reliability_summary_generated_at);

  IF v_mismatch <> 0 OR v_dst <> v_src THEN
    RAISE EXCEPTION '107 backfill is not an exact copy: % partnership(s) with a cached summary or timestamp, % row(s) in the new table, % mismatched. Nothing was committed.',
      v_src, v_dst, v_mismatch
      USING ERRCODE = 'LG107';
  END IF;
END
$backfill_check$;

-- PostgREST must see the table at commit, or the code keeps falling back to the legacy columns.
NOTIFY pgrst, 'reload schema';

        $m107$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ($l$107$l$ || ' raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
      IF to_regclass('public.partnership_private_reliability') IS NOT NULL THEN
        EXECUTE 'SELECT (SELECT count(*) FROM public.partnerships WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL)::text || '' / '' || (SELECT count(*) FROM public.partnership_private_reliability)::text || '' / '' || (SELECT count(*) FROM public.partnerships p LEFT JOIN public.partnership_private_reliability n ON n.partnership_id = p.id WHERE (p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL) AND (n.partnership_id IS NULL OR n.reliability_summary IS DISTINCT FROM p.reliability_summary OR n.reliability_summary_generated_at IS DISTINCT FROM p.reliability_summary_generated_at))::text' INTO v_bf;
      END IF;
    END IF;
    IF v_ph = 2 THEN
      RESET ROLE;
      BEGIN
        EXECUTE $m108$

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.partnership_private_reliability') IS NULL THEN
    RAISE EXCEPTION '108 refuses to apply: public.partnership_private_reliability does not exist. Apply 107 first.'
      USING ERRCODE = 'LG108';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.partnerships p
  LEFT JOIN public.partnership_private_reliability n ON n.partnership_id = p.id
  WHERE (p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL)
    AND NOT (n.partnership_id IS NOT NULL
             AND ((n.reliability_summary IS NOT DISTINCT FROM p.reliability_summary
                   AND n.reliability_summary_generated_at IS NOT DISTINCT FROM p.reliability_summary_generated_at)
                  OR (p.reliability_summary_generated_at IS NOT NULL
                      AND n.reliability_summary_generated_at IS NOT NULL
                      AND n.reliability_summary_generated_at > p.reliability_summary_generated_at)));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '108 refuses to apply: % partnership(s) hold a legacy reliability value that the private reliability table does not account for (no row, or the legacy value is newer than or unorderable against its row). Nulling the columns would destroy it. See the DRIFT section of this file.', v_unaccounted
      USING ERRCODE = 'LG108';
  END IF;
END
$preflight$;

UPDATE public.partnerships
   SET reliability_summary              = NULL,
       reliability_summary_generated_at = NULL
 WHERE reliability_summary IS NOT NULL
    OR reliability_summary_generated_at IS NOT NULL;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.partnerships
   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '108: % partnership(s) still hold a reliability value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG108';
  END IF;
END
$verify$;

        $m108$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ($l$108$l$ || ' raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
    END IF;
  END LOOP;

  RESET ROLE;

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_after
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';
  SELECT relacl::text INTO v_acl_after FROM pg_class WHERE oid = 'public.partnerships'::regclass;

  ---------------------------------------------------------------------
  -- JUDGEMENT. One verdict per scenario, then the structural assertions.
  -- Phase 1 is the BEFORE state: a mismatch there is INCONCLUSIVE (the test's premise is wrong),
  -- never FAIL. A mismatch in a later phase is a FAIL. FAULT and NOSUBJECT are INCONCLUSIVE.
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n_a LOOP
    v_ran := v_ran + 1;
    v_logged := v_logged + 1;
    v_ba := v_ba || '  ' || sc_label[v_i] || E'\n';
    v_st := 'PASS';
    v_detail := '';
    FOR v_k IN 1 .. c_phases LOOP
      v_idx := (v_i - 1) * c_phases + v_k;
      v_cls := r_cls[v_idx];
      v_exp := sc_exp[v_idx];
      v_ba := v_ba || format(E'      phase %s : %s   (expected %s)\n', v_k, v_cls, v_exp);
      IF v_cls LIKE 'FAULT%' OR v_cls = 'NOSUBJECT' OR v_cls = 'NOT RUN' THEN
        IF v_st = 'PASS' THEN v_st := 'INCONCLUSIVE'; END IF;
        v_detail := v_detail || format(' [phase %s: %s - says nothing about 107]', v_k, v_cls);
      ELSIF NOT (v_cls = v_exp OR (v_exp = 'REFUSED:*' AND v_cls LIKE 'REFUSED:%')) THEN
        IF v_k = 1 THEN
          IF v_st = 'PASS' THEN v_st := 'INCONCLUSIVE'; END IF;
          v_detail := v_detail || format(' [BEFORE state is not what the test assumes: got %s, expected %s]', v_cls, v_exp);
        ELSE
          v_st := 'FAIL';
          v_detail := v_detail || format(' [phase %s: got %s, expected %s]', v_k, v_cls, v_exp);
        END IF;
      END IF;
    END LOOP;

    IF v_st = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_st = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1; END IF;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 60) || rpad(v_st, 14) || v_detail;
  END LOOP;


  -- S1  backfill is an exact copy of the legacy columns
  v_ok := NULL; v_detail := '';
  IF v_bf IS NULL THEN
    v_ok := false; v_detail := 'the table did not exist after 107 ran, so no copy was measured';
  ELSE
    v_ok := split_part(v_bf, ' / ', 1) = split_part(v_bf, ' / ', 2) AND split_part(v_bf, ' / ', 3) = '0';
    v_detail := format('(measured right after 107: %s legacy rows / %s table rows / %s mismatched)', split_part(v_bf, ' / ', 1), split_part(v_bf, ' / ', 2), split_part(v_bf, ' / ', 3));
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S1  backfill is an exact copy of the legacy columns$l$, 52) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S1  backfill is an exact copy of the legacy columns$l$, 52) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S1  backfill is an exact copy of the legacy columns$l$, 52) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S2  table: RLS on, 3 policies, authenticated only, no vendor
  v_ok := NULL; v_detail := '';
  SELECT count(*), count(*) FILTER (WHERE roles::text <> '{authenticated}'),
         count(*) FILTER (WHERE cmd = 'DELETE' OR cmd = 'ALL'),
         count(*) FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~* '(vendor_org_id|partnerships)')
    INTO v_n_a, v_n_b, v_n_c, v_k
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnership_private_reliability';
  v_ok := coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.partnership_private_reliability')), false)
          AND v_n_a = 3 AND v_n_b = 0 AND v_n_c = 0 AND v_k = 0;
  v_detail := format('(policies %s, not-authenticated-only %s, delete-or-all %s, mention vendor/partnerships %s)', v_n_a, v_n_b, v_n_c, v_k);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S2  table: RLS on, 3 policies, authenticated only, no vendor$l$, 52) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S2  table: RLS on, 3 policies, authenticated only, no vendor$l$, 52) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S2  table: RLS on, 3 policies, authenticated only, no vendor$l$, 52) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S3  table: anon has nothing, authenticated has no DELETE
  v_ok := NULL; v_detail := '';
  v_ok := to_regclass('public.partnership_private_reliability') IS NOT NULL
          AND NOT has_table_privilege('anon', 'public.partnership_private_reliability', 'SELECT')
          AND NOT has_table_privilege('anon', 'public.partnership_private_reliability', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.partnership_private_reliability', 'UPDATE')
          AND NOT has_table_privilege('anon', 'public.partnership_private_reliability', 'DELETE')
          AND has_table_privilege('authenticated', 'public.partnership_private_reliability', 'SELECT')
          AND has_table_privilege('authenticated', 'public.partnership_private_reliability', 'INSERT')
          AND has_table_privilege('authenticated', 'public.partnership_private_reliability', 'UPDATE')
          AND NOT has_table_privilege('authenticated', 'public.partnership_private_reliability', 'DELETE')
          AND NOT has_table_privilege('authenticated', 'public.partnership_private_reliability', 'TRUNCATE');
  v_detail := '(anon SELECT/INSERT/UPDATE/DELETE all false; authenticated S/I/U true, DELETE and TRUNCATE false)';
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S3  table: anon has nothing, authenticated has no DELETE$l$, 52) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S3  table: anon has nothing, authenticated has no DELETE$l$, 52) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S3  table: anon has nothing, authenticated has no DELETE$l$, 52) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S4  guard trigger enabled, BEFORE INSERT OR UPDATE, not callable
  v_ok := NULL; v_detail := '';
  SELECT (t.tgenabled = 'O') AND ((t.tgtype & 2) = 2) AND ((t.tgtype & 4) = 4) AND ((t.tgtype & 16) = 16)
    INTO v_ok
  FROM pg_trigger t
  WHERE t.tgrelid = to_regclass('public.partnership_private_reliability') AND t.tgname = 'partnership_private_reliability_guard';
  v_ok := coalesce(v_ok, false)
          AND NOT has_function_privilege('anon', 'public.partnership_private_reliability_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.partnership_private_reliability_guard()', 'EXECUTE');
  v_detail := '(V5 of 107 would return the same)';
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S4  guard trigger enabled, BEFORE INSERT OR UPDATE, not callable$l$, 52) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S4  guard trigger enabled, BEFORE INSERT OR UPDATE, not callable$l$, 52) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S4  guard trigger enabled, BEFORE INSERT OR UPDATE, not callable$l$, 52) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S5  no policy on partnerships changed
  v_ok := NULL; v_detail := '';
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(fingerprint %s before, %s after)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on partnerships changed$l$, 52) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on partnerships changed$l$, 52) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on partnerships changed$l$, 52) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S6  no grant on partnerships changed (relacl)
  v_ok := NULL; v_detail := '';
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on partnerships changed (relacl)$l$, 52) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on partnerships changed (relacl)$l$, 52) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on partnerships changed (relacl)$l$, 52) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S7  after 108 no partnership carries a legacy cache
  v_ok := NULL; v_detail := '';
  SELECT count(*) INTO v_n_a FROM public.partnerships WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
  v_ok := v_n_a = 0;
  v_detail := format('(%s partnership(s) still hold reliability_summary or its stamp)', v_n_a);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 108 no partnership carries a legacy cache$l$, 52) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 108 no partnership carries a legacy cache$l$, 52) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 108 no partnership carries a legacy cache$l$, 52) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  ---------------------------------------------------------------------
  -- VERDICT + REPORT. Self-checks outrank everything.
  ---------------------------------------------------------------------
  IF array_length(v_apply_err, 1) IS NOT NULL THEN
    v_fail := v_fail + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 60) || rpad('FAIL', 14) || array_to_string(v_apply_err, ' | ');
    v_ran := v_ran + 1; v_logged := v_logged + 1;
  ELSE
    v_ran := v_ran + 1; v_logged := v_logged + 1; v_pass := v_pass + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 60) || rpad('PASS', 14) || '(every inlined migration executed to the end)';
  END IF;

  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected + 1 OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 107.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 107.';
    v_headline := format('SAFE TO APPLY 107.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 107 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 107 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 107.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n', v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'isolation check : %s scenario run(s) each compared to the pre-loop fingerprint of partnerships AND the reliability table: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT          : vendor user %s (vendor-only: %s), vendor org %s, lead org %s, partnership %s, agency member %s, other agency member %s, other partnership %s\n',
              v_uid, v_pure, v_vorg, v_lead, v_pship, coalesce(v_agency_uid::text, 'NONE'), coalesce(v_other_uid::text, 'NONE'), coalesce(v_other_pship::text, 'NONE'))
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE (same subject, same transaction)\n'
    || E'  phase 1 = BEFORE 107 (today)\n  phase 2 = AFTER 107, BEFORE 108 (the leak window)\n  phase 3 = AFTER 108 (leak closed)\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

-- THE BACKSTOP. IT STAYS. Not reached on the expected path (the DO block ends in RAISE
-- EXCEPTION and aborts the transaction). It is the net for a client that swallows the error:
-- the transaction would still hold the inlined migration code from the phases.
ROLLBACK;
