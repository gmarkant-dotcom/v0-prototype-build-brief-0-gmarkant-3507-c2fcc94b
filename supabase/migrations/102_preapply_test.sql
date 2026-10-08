-- =====================================================================
-- 102 PRE-APPLY TEST. ONE PASTE. APPLIES 102, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-08 on fix/post-093-cleanup. PARSE-CHECKED ONLY. NOT RUN.
--
-- WHY THIS FILE EXISTS. 102 is a trigger that REFUSES writes. A trigger
-- that refuses too much breaks a live feature (accept, decline, payment
-- terms, suspend, terminate) and raises nothing at apply time; a trigger
-- that refuses too little leaves the defect open and ALSO raises nothing.
-- Both are invisible until somebody writes. This file writes first, inside
-- a transaction that rolls back.
--
-- THE DEFECT, STATED AS A MEASUREMENT. Every refusal scenario is run TWICE
-- in one transaction: BEFORE 102 is applied and AFTER. The BEFORE column is
-- the executed answer to "after 093, can a vendor still write status
-- through PostgREST?". It should show the vendor WRITING the refused
-- states. If BEFORE is also refused the scenario cannot tell a working
-- guard from a vacuous one, and the verdict is INCONCLUSIVE, never PASS.
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
-- The DO block finishes with RAISE EXCEPTION carrying the whole report.
-- The mechanism is the one 091, 092 and 093 established for this client:
-- RAISE NOTICE is not rendered, a temp table gives 3F000, and a pg_temp
-- helper function is not used here for the same reason (this file defines
-- NO function in pg_temp). Everything is inline.
--
-- READ THE FIRST LINE:
--     "SAFE TO APPLY 102."       -> and only this.
--     "DO NOT APPLY 102 YET."    -> INCONCLUSIVE. Not a green light.
--     "DO NOT APPLY 102."        -> a scenario FAILED, or the test is broken.
--
-- THE SQL EDITOR MAY ASK YOU TO CONFIRM. Nothing here is an UPDATE without
-- a WHERE, but the editor may still warn on UPDATE text inside a DO block.
-- Confirm: it is inside a rolled-back transaction.
--
-- =====================================================================
-- IT IMPERSONATES, AND PROVES IT DID
-- =====================================================================
-- Each scenario sets request.jwt.claims and request.jwt.claim.sub and then
-- SET LOCAL ROLE authenticated, then READS auth.uid() BACK and raises LG098
-- if it is not the intended user. LG098 is reported as INCONCLUSIVE with
-- the words TEST FAULT. The owner state (auth.uid() NULL) is checked before
-- every setup write.
--
-- ISOLATION. Every scenario runs in its own nested BEGIN ... EXCEPTION block
-- and ends in RAISE EXCEPTION ... ERRCODE 'LG097', which that block's own
-- handler swallows, undoing the setup write, the attempted write, the role
-- switch and the claims. A fingerprint of every partnerships row is taken
-- before the first scenario and recomputed after EACH one; any difference
-- ends the run with "THE TEST ITSELF IS BROKEN". The same mechanism ran in
-- the 093 test (its 2026-10-08 run reported 20 PASS and 1 KNOWN LIMIT).
--
-- SUBJECT. A vendor-org member on a partnership whose lead organization
-- that member does NOT belong to, and a member of that lead organization
-- for the agency scenarios. NO SUBJECT IS REPORTED, NEVER PASSED.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * CREATE TRIGGER inside the DO block after rolled-back UPDATEs on the
--     same table does not hit 55006 "pending trigger events". Rolled-back
--     subtransactions discard their events, so it should not.
--   * EXECUTE of a two-statement string (scenario R14) is accepted.
--
-- THE NUMBER OF ASSERTIONS is c_expected below (28 = 24 scenarios + 4
-- structural). Change it with the scenario list.
-- =====================================================================

BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 28;
  v_uid          uuid;
  v_org          uuid;
  v_lead         uuid;
  v_pship        uuid;
  v_agency_uid   uuid;
  v_claims       text;
  v_agency_claims text;
  v_rows         integer;
  v_final        text;
  v_actor        text;
  v_ph           integer;
  v_i            integer;
  v_n            integer;
  v_idx          integer;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_pol_before   text;
  v_pol_after    text;
  v_has_101      boolean;
  v_has_102_pre  boolean;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_ran          integer := 0;
  v_logged       integer := 0;
  v_lines        text := '';
  v_headline     text;
  v_verdict_text text;
  v_report       text;
  v_ba           text := '';
  v_bc           text;
  v_ac           text;
  v_t_ok         boolean;
  v_t_first      boolean;
  v_t_cfg        text[];

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_prior  text[];
  sc_acc    text[];
  sc_sql    text[];
  sc_expect text[];
  sc_final  text[];
  r_cls     text[];
  r_rows    integer[];
  r_final   text[];
BEGIN
  ---------------------------------------------------------------------
  -- SUBJECT
  ---------------------------------------------------------------------
  SELECT p.id, p.vendor_org_id, p.lead_org_id, m.user_id
    INTO v_pship, v_org, v_lead, v_uid
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
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 102 YET.  NO SUBJECT: no partnership has a vendor organization with a member who is not also a member of the lead organization. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  SELECT m.user_id INTO v_agency_uid
  FROM public.org_members m
  WHERE m.org_id = v_lead
  ORDER BY m.user_id
  LIMIT 1;

  v_claims        := json_build_object('sub', v_uid::text,        'role', 'authenticated')::text;
  v_agency_claims := json_build_object('sub', v_agency_uid::text, 'role', 'authenticated')::text;

  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  ---------------------------------------------------------------------
  -- THE SCENARIOS. Parallel arrays; position i describes scenario i.
  -- sc_sql uses %1$L for the partnership id. sc_acc: 'null' or 'set'.
  -- sc_final: the status the row must end on for an ADMIT scenario.
  ---------------------------------------------------------------------
  sc_id := ARRAY['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10',
                 'R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','R12','R13','R14'];
  sc_label := ARRAY[
    'A1  vendor accepts while pending',
    'A2  vendor declines while pending',
    'A3  vendor writes payment terms (active)',
    'A4  vendor writes payment terms (suspended)',
    'A5  agency suspends',
    'A6  agency terminates an active row',
    'A7  agency terminates a suspended row',
    'A8  agency reinstates a suspension',
    'A9  agency re-invites a terminated row',
    'A10 service role is exempt',
    'R1  vendor: active over suspension',
    'R2  vendor: accept-shape over suspension',
    'R3  vendor: reinstates a terminated row',
    'R4  vendor: terminates a live row',
    'R5  vendor: terminates a suspended row',
    'R6  vendor: suspends itself',
    'R7  vendor: removes itself',
    'R8  vendor: pending onto active',
    'R9  vendor: pending onto suspended',
    'R10 vendor: pending onto terminated',
    'R11 vendor: pending to pending, accepted_at',
    'R12 vendor: accepted_at alone',
    'R13 vendor: decline that moves accepted_at',
    'R14 vendor: self-escalation chain'];
  sc_actor := ARRAY['vendor','vendor','vendor','vendor','agency','agency','agency','agency','agency','owner',
                    'vendor','vendor','vendor','vendor','vendor','vendor','vendor','vendor','vendor','vendor','vendor','vendor','vendor','vendor'];
  sc_prior := ARRAY['pending','pending','active','suspended','active','active','suspended','suspended','terminated','suspended',
                    'suspended','suspended','terminated','active','suspended','active','active','active','suspended','terminated','pending','active','pending','suspended'];
  sc_acc   := ARRAY['null','null','set','set','set','set','set','set','set','set',
                    'set','set','set','set','set','set','set','set','set','set','null','set','null','set'];
  sc_expect := ARRAY['ADMIT','ADMIT','ADMIT','ADMIT','ADMIT','ADMIT','ADMIT','ADMIT','ADMIT','ADMIT',
                     'REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE','REFUSE'];
  sc_final := ARRAY['active','terminated','active','suspended','suspended','terminated','terminated','active','pending','active',
                    '','','','','','','','','','','','','',''];
  sc_sql := ARRAY[
    $q$UPDATE public.partnerships SET status = 'active', accepted_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated', updated_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET payment_terms_requests = '[{"status":"pending","note":"102 pre-apply test"}]'::jsonb WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET payment_terms_requests = '[{"status":"pending","note":"102 pre-apply test"}]'::jsonb WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'suspended', updated_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated', updated_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated', updated_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'active', updated_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'pending', updated_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'active' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'active' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'active', accepted_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'active', accepted_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'suspended' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'removed' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'pending' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'pending' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'pending' WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET accepted_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET accepted_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated', accepted_at = now() WHERE id = %1$L$q$,
    $q$UPDATE public.partnerships SET status = 'pending' WHERE id = %1$L; UPDATE public.partnerships SET status = 'active', accepted_at = now() WHERE id = %1$L$q$];

  v_n := array_length(sc_id, 1);
  IF v_n <> 24 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_prior, 1) <> v_n OR array_length(sc_acc, 1) <> v_n
     OR array_length(sc_sql, 1) <> v_n OR array_length(sc_expect, 1) <> v_n
     OR array_length(sc_final, 1) <> v_n THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (id %, label %, actor %, prior %, acc %, sql %, expect %, final %)',
      array_length(sc_id, 1), array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_prior, 1),
      array_length(sc_acc, 1), array_length(sc_sql, 1), array_length(sc_expect, 1), array_length(sc_final, 1);
  END IF;

  r_cls   := array_fill('NOT RUN'::text, ARRAY[2 * v_n]);
  r_rows  := array_fill(NULL::integer,   ARRAY[2 * v_n]);
  r_final := array_fill(NULL::text,      ARRAY[2 * v_n]);

  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal
                   AND tgname = 'partnerships_guard_vendor_state'),
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal
                   AND tgname = 'partnerships_guard_status_transition')
    INTO v_has_101, v_has_102_pre;

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';

  v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), ''));

  ---------------------------------------------------------------------
  -- THE LOOP. PHASE 1 = BEFORE 102. PHASE 2 = AFTER 102.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. 2 LOOP
    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_ph - 1) * v_n + v_i;
      v_actor := sc_actor[v_i];

      IF v_actor = 'agency' AND v_agency_uid IS NULL THEN
        r_cls[v_idx] := 'NOSUBJECT';
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          -- Setup as the OWNER (no end-user session, so exit 2 of every guard). Undone with the scenario.
          UPDATE public.partnerships
             SET status      = sc_prior[v_i],
                 accepted_at = CASE WHEN sc_acc[v_i] = 'null' THEN NULL ELSE now() - interval '1 day' END
           WHERE id = v_pship;

          IF v_actor = 'vendor' THEN
            PERFORM set_config('request.jwt.claims',    v_claims,    true);
            PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (vendor): auth.uid() is %, expected %', auth.uid(), v_uid USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'agency' THEN
            PERFORM set_config('request.jwt.claims',    v_agency_claims,    true);
            PERFORM set_config('request.jwt.claim.sub', v_agency_uid::text, true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_agency_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (agency): auth.uid() is %, expected %', auth.uid(), v_agency_uid USING ERRCODE = 'LG098';
            END IF;
          END IF;

          EXECUTE format(sc_sql[v_i], v_pship);
          GET DIAGNOSTICS v_rows = ROW_COUNT;
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          SELECT status INTO v_final FROM public.partnerships WHERE id = v_pship;

          r_cls[v_idx]   := 'DONE';
          r_rows[v_idx]  := v_rows;
          r_final[v_idx] := v_final;
          RAISE EXCEPTION 'scenario % complete: undoing its writes', sc_id[v_i] USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN
            NULL;
          WHEN OTHERS THEN
            r_cls[v_idx] := CASE
              WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
              WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'partnerships.status and accepted_at%' THEN 'REFUSED:102'
              WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'partnerships.status may not be changed%' THEN 'REFUSED:101'
              WHEN SQLSTATE = 'LG009' THEN 'REFUSED:093 (LG009)'
              WHEN SQLSTATE = '42501' THEN 'REFUSED:OTHER ' || left(SQLERRM, 110)
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), ''));
      v_iso_runs := v_iso_runs + 1;
      IF v_fp IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc_id[v_i] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;

    -- 102 ITSELF, between the phases: the CODE of
    -- supabase/migrations/102_partnership_status_transitions.sql with its comments
    -- left out (the migration's own pre-flight DO block is replaced by the
    -- v_has_101 / v_has_102_pre flags above, reported rather than raised).
    IF v_ph = 1 THEN
      RESET ROLE;
      IF NOT v_has_102_pre THEN
        EXECUTE $t102_fn$
CREATE FUNCTION public.partnerships_guard_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.lead_org_id IN (SELECT public.current_user_org_ids()) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending'
     AND NEW.status = 'terminated'
     AND NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'partnerships.status and accepted_at may be changed by a vendor only to accept or decline a pending invitation (attempted status % -> %, accepted_at % -> %)',
    OLD.status, NEW.status, OLD.accepted_at, NEW.accepted_at
    USING ERRCODE = '42501',
          DETAIL  = 'Migration 102. A vendor session may only accept (pending -> active) or decline (pending -> terminated, accepted_at unchanged). Suspending, terminating, reinstating and re-inviting belong to the lead agency.';
END;
$$;
        $t102_fn$;

        EXECUTE $t102_trg$
CREATE TRIGGER partnerships_guard_status_transition
  BEFORE UPDATE ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.partnerships_guard_status_transition();
        $t102_trg$;
      END IF;
    END IF;
  END LOOP;

  RESET ROLE;

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_after
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';

  ---------------------------------------------------------------------
  -- JUDGEMENT. One verdict line per scenario, then four structural lines.
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    v_ran := v_ran + 1;
    v_bc := CASE WHEN r_cls[v_i] = 'DONE'
                 THEN format('wrote it: %s row(s), status now %s', r_rows[v_i], r_final[v_i]) ELSE r_cls[v_i] END;
    v_ac := CASE WHEN r_cls[v_n + v_i] = 'DONE'
                 THEN format('wrote it: %s row(s), status now %s', r_rows[v_n + v_i], r_final[v_n + v_i]) ELSE r_cls[v_n + v_i] END;
    v_ba := v_ba || format(E'  %s\n      BEFORE : %s\n      AFTER  : %s\n', sc_label[v_i], v_bc, v_ac);

    IF r_cls[v_n + v_i] LIKE 'FAULT%' OR r_cls[v_i] LIKE 'FAULT%' THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('INCONCLUSIVE', 14) || format('TEST FAULT, impersonation did not take (BEFORE: %s; AFTER: %s). Says nothing about 102.', r_cls[v_i], r_cls[v_n + v_i]);
      v_inconc := v_inconc + 1;

    ELSIF r_cls[v_n + v_i] = 'NOSUBJECT' THEN
      v_logged := v_logged + 1;
      v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('INCONCLUSIVE', 14) || 'NO SUBJECT: the lead organization has no member to act as the agency. Not exercised.';
      v_inconc := v_inconc + 1;

    ELSIF sc_expect[v_i] = 'ADMIT' THEN
      IF r_cls[v_n + v_i] = 'DONE' AND r_rows[v_n + v_i] = 1 AND r_final[v_n + v_i] = sc_final[v_i] THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('PASS', 14) || format('(AFTER: 1 row, status %s. BEFORE: %s)', r_final[v_n + v_i], v_bc);
        v_pass := v_pass + 1;
      ELSIF r_cls[v_n + v_i] = 'REFUSED:102' THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('FAIL', 14) || 'OVER-NARROW. 102 REFUSED a write the live product performs. Applying it breaks that feature. DO NOT APPLY.';
        v_fail := v_fail + 1;
      ELSIF r_cls[v_n + v_i] LIKE 'REFUSED:%' THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('FAIL', 14) || format('a live write was refused by something other than 102 (%s). Not caused by 102 but the feature is broken as the schema stands. DO NOT APPLY until read.', r_cls[v_n + v_i]);
        v_fail := v_fail + 1;
      ELSIF r_cls[v_n + v_i] = 'DONE' AND r_rows[v_n + v_i] = 1 THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('FAIL', 14) || format('the write succeeded but the status is %s, expected %s.', r_final[v_n + v_i], sc_final[v_i]);
        v_fail := v_fail + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('INCONCLUSIVE', 14) || format('AFTER: %s (rows %s). The write did not complete or did not reach the row; says nothing about 102.', r_cls[v_n + v_i], r_rows[v_n + v_i]);
        v_inconc := v_inconc + 1;
      END IF;

    ELSE
      -- REFUSE scenario.
      IF r_cls[v_n + v_i] = 'REFUSED:102' THEN
        IF r_cls[v_i] = 'DONE' AND r_rows[v_i] = 1 THEN
          v_logged := v_logged + 1;
          v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('PASS', 14) || format('(AFTER: refused by 102. BEFORE: the vendor WROTE it, status now %s)', r_final[v_i]);
          v_pass := v_pass + 1;
        ELSE
          v_logged := v_logged + 1;
          v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('INCONCLUSIVE', 14) || format('NOT DISCRIMINATING. AFTER refused it, but BEFORE was %s, so the refusal cannot be credited to 102 (a 101 trigger, or 102 itself, may already be live: 101=%s, 102=%s).', v_bc, v_has_101, v_has_102_pre);
          v_inconc := v_inconc + 1;
        END IF;
      ELSIF r_cls[v_n + v_i] = 'DONE' THEN
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('FAIL', 14) || format('102 DID NOT REFUSE. The vendor wrote it: %s row(s), status now %s. THE DEFECT IS STILL OPEN. DO NOT APPLY on the belief it is closed.', r_rows[v_n + v_i], r_final[v_n + v_i]);
        v_fail := v_fail + 1;
      ELSE
        v_logged := v_logged + 1;
        v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 44) || rpad('INCONCLUSIVE', 14) || format('AFTER was %s, not a refusal by 102 and not a write. Read it.', r_cls[v_n + v_i]);
        v_inconc := v_inconc + 1;
      END IF;
    END IF;
  END LOOP;

  -- S1. the trigger exists, enabled, BEFORE UPDATE FOR EACH ROW.
  v_ran := v_ran + 1;
  SELECT (t.tgenabled = 'O') AND ((t.tgtype & 1) = 1) AND ((t.tgtype & 2) = 2) AND ((t.tgtype & 16) = 16)
    INTO v_t_ok
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.partnerships'::regclass AND t.tgname = 'partnerships_guard_status_transition';
  v_logged := v_logged + 1;
  IF coalesce(v_t_ok, false) THEN
    v_lines := v_lines || E'\n  ' || rpad('S1  trigger enabled, BEFORE UPDATE, per row', 44) || rpad('PASS', 14) || '(V1 would return the same)';
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S1  trigger enabled, BEFORE UPDATE, per row', 44) || rpad('FAIL', 14) || 'the trigger is missing or not enabled BEFORE UPDATE FOR EACH ROW after the test applied it.';
    v_fail := v_fail + 1;
  END IF;

  -- S2. 093's trigger exists and sorts first.
  v_ran := v_ran + 1;
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partnerships'::regclass
                   AND tgname = 'partnerships_guard_identity_columns')
         AND ('partnerships_guard_identity_columns' COLLATE "C" < 'partnerships_guard_status_transition' COLLATE "C")
    INTO v_t_first;
  v_logged := v_logged + 1;
  IF coalesce(v_t_first, false) THEN
    v_lines := v_lines || E'\n  ' || rpad('S2  093 trigger exists and fires first', 44) || rpad('PASS', 14) || '(partnerships_guard_identity_columns sorts before partnerships_guard_status_transition)';
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S2  093 trigger exists and fires first', 44) || rpad('FAIL', 14) || 'partnerships_guard_identity_columns is absent (093 not applied?) or does not sort first.';
    v_fail := v_fail + 1;
  END IF;

  -- S3. no policy moved.
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  IF v_pol_before IS NOT DISTINCT FROM v_pol_after THEN
    v_lines := v_lines || E'\n  ' || rpad('S3  no policy on partnerships changed', 44) || rpad('PASS', 14) || format('(fingerprint %s before and after)', v_pol_before);
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S3  no policy on partnerships changed', 44) || rpad('FAIL', 14) || format('the policy fingerprint moved (%s -> %s). 102 is supposed to change no policy.', v_pol_before, v_pol_after);
    v_fail := v_fail + 1;
  END IF;

  -- S4. 101 is not live.
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  IF NOT v_has_101 THEN
    v_lines := v_lines || E'\n  ' || rpad('S4  101 trigger is absent', 44) || rpad('PASS', 14) || '(partnerships_guard_vendor_state not found)';
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S4  101 trigger is absent', 44) || rpad('INCONCLUSIVE', 14) || '101 is live. 102 supersedes it and the migration refuses to coexist; the BEFORE column is not the unguarded state.';
    v_inconc := v_inconc + 1;
  END IF;

  ---------------------------------------------------------------------
  -- VERDICT + REPORT. Self-checks outrank everything.
  ---------------------------------------------------------------------
  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 102.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected THEN
    v_verdict_text := 'SAFE TO APPLY 102.';
    v_headline := format('SAFE TO APPLY 102.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 102 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 102 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 102.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected)
    || format(E'PASS            : %s   (expected %s)\n', v_pass, c_expected)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n', v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'isolation check : %s scenario run(s) each compared to the pre-loop fingerprint: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'state at start   : 101 trigger present = %s, 102 trigger present = %s\n', v_has_101, v_has_102_pre)
    || format(E'SUBJECT          : vendor user %s, vendor org %s, lead org %s, partnership %s, agency member %s\n',
              v_uid, v_org, v_lead, v_pship, coalesce(v_agency_uid::text, 'NONE'))
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nBEFORE 102 AND AFTER (same scenarios, same subject, same transaction)\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

-- THE BACKSTOP. IT STAYS. Not reached on the expected path (the DO block
-- ends in RAISE EXCEPTION and aborts the transaction). It is the net for a
-- client that swallows the error: the transaction would still hold the
-- CREATE FUNCTION and CREATE TRIGGER from phase 1.
ROLLBACK;
