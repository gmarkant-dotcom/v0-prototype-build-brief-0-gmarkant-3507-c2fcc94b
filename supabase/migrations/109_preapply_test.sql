-- =====================================================================
-- 109 PRE-APPLY TEST. ONE PASTE. APPLIES 109 AND 110, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-09 on fix/109-112-scoring-and-reviews-split. NOT RUN: THERE IS NO LOCAL POSTGRES AND
-- NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain error, not in
-- "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- GENERATED so that the inlined migration code is byte-identical to the migration files.
--
-- WHY THIS FILE EXISTS. 109 creates the table that holds the lead agency's composite score and AI summaries of a bid, and 110 empties and guards the
-- legacy columns a vendor can read. A table that is too open leaks; one that is too closed breaks the agency
-- screens; neither raises anything at apply time. This file exercises both, as every party, and rolls back.
--
-- PHASES: phase 1 BEFORE 109 (today), phase 2 AFTER 109 and BEFORE 110 (the leak window), phase 3 AFTER 110.
--
-- EVERY ASSERTION RUNS IN EVERY PHASE. The BEFORE column MEASURES the defect rather than assuming it: the
-- vendor's V3* reads and its legacy writes must SUCCEED before 110. If they do not, the verdict is
-- INCONCLUSIVE (the test's premise is wrong), never PASS.
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
--     "SAFE TO APPLY 109."       -> and only this.
--     "DO NOT APPLY 109 YET."    -> INCONCLUSIVE or NO SUBJECT. Not a green light.
--     "DO NOT APPLY 109."        -> an assertion FAILED, or the test is broken.
-- Each row reads PASS, FAIL, INCONCLUSIVE, NOT DISCRIMINATING (a scenario whose expectation is the same in
-- every phase, reported as PASS with that note) or NO SUBJECT (reported as INCONCLUSIVE, never PASS).
--
-- THIS FILE DEFINES NO FUNCTION IN pg_temp (the SQL Editor returns 3F000 for them) and no temp table.
--
-- =====================================================================
-- THE SUBJECT
-- =====================================================================
-- THE VENDOR IS THE APRIL PARTNER TEST AGENCY (by organization name; failing that, the organization of
-- gmarkant@icloud.com). The vendor user is gmarkant@icloud.com where possible; the agency colleague is
-- gmarkant@gmail.com where possible (a member of the subject's lead organization, m a r k a n t).
-- The subject is one of the April vendor's real bids. The owner writes sentinels into it per scenario and
-- every write is undone.
--
-- ACTORS: vendor, vendor_pure (the same user, only if they belong to no organization that owns a row of
-- partner_rfp_responses, so "all rows" reads mean something), agency (a lead-org member: the colleague), agency_x (the
-- same, aimed at a row another organization owns), other (a member of a DIFFERENT lead organization),
-- service (SET LOCAL ROLE service_role), anon (SET LOCAL ROLE anon).
-- EXPECT NO SUBJECT for other, and therefore B1 and B2: m a r k a n t is the only lead organization with
-- members. That is INCONCLUSIVE, never PASS, and it means cross-agency isolation is NOT shown by this run.
-- It would be shown by a second lead organization with a member.
--
-- IT IMPERSONATES, AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE, then auth.uid() (or current_user)
-- is read back; a mismatch raises LG098, reported as INCONCLUSIVE with the words TEST FAULT.
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block that ends in LG097, undoing its setup
-- and its write. A fingerprint of every partner_rfp_responses row AND of the private table is compared after each one.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * EXECUTE of a multi-statement string (the inlined migration) is accepted.
--   * CREATE TABLE / FUNCTION / TRIGGER inside the DO block, after rolled-back writes, does not hit 55006.
--   * A BEFORE INSERT trigger fires before the INSERT policy's WITH CHECK (V6 / A6 accept any REFUSED).
--   * INSERT ... RETURNING as the vendor (V10) is checked against the SELECT policies too.
--   * S9/S10 copy the subject bid with jsonb_populate_record; a unique constraint this repository does not
--     know about would make that setup fail, which is reported as INCONCLUSIVE, not FAIL.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 39;
  c_phases       CONSTANT integer := 3;
  v_sub          uuid;
  v_lead         uuid;
  v_vorg         uuid;
  v_vorg_name    text;
  v_uid          uuid;
  v_pure         boolean;
  v_agency_uid   uuid;
  v_other_uid    uuid;
  v_other_sub    uuid;
  v_other_lead   uuid;
  v_proj         uuid;
  v_x6           uuid;
  v_x7           uuid;
  v_tmp          uuid;
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
  v_s9           boolean;
  v_s10          boolean;
  v_s9d          text;
  v_s10d         text;
  v_s9t          text;
  v_s10t         text;
  v_live_unacc   bigint;
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
  v_bf           text := NULL;
  v_same         boolean;

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
  -- THE VENDOR ORGANIZATION IS THE APRIL PARTNER TEST AGENCY, by name; failing that, the organization
  -- of gmarkant@icloud.com that is the vendor on something. Never any other vendor: NO SUBJECT instead.
  SELECT o.id INTO v_vorg FROM public.organizations o
   WHERE lower(btrim(o.name)) = 'april partner test agency'
   ORDER BY o.id LIMIT 1;
  IF v_vorg IS NULL THEN
    SELECT m.org_id INTO v_vorg
    FROM public.org_members m JOIN public.profiles pr ON pr.id = m.user_id
    WHERE lower(btrim(pr.email)) = 'gmarkant@icloud.com'
      AND (EXISTS (SELECT 1 FROM public.partner_rfp_responses r WHERE r.vendor_org_id = m.org_id)
           OR EXISTS (SELECT 1 FROM public.partnerships p WHERE p.vendor_org_id = m.org_id))
    ORDER BY m.org_id LIMIT 1;
  END IF;
  SELECT o.name INTO v_vorg_name FROM public.organizations o WHERE o.id = v_vorg;

  -- THE SUBJECT BID: one the April vendor submitted to a lead organization that has a member outside
  -- the vendor organization, and where the vendor organization has a member outside the lead.
  SELECT r.id, r.lead_org_id INTO v_sub, v_lead
  FROM public.partner_rfp_responses r
  WHERE r.vendor_org_id = v_vorg AND r.lead_org_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_members a WHERE a.org_id = r.lead_org_id
                  AND NOT EXISTS (SELECT 1 FROM public.org_members b WHERE b.user_id = a.user_id AND b.org_id = v_vorg))
    AND EXISTS (SELECT 1 FROM public.org_members a WHERE a.org_id = v_vorg
                  AND NOT EXISTS (SELECT 1 FROM public.org_members b WHERE b.user_id = a.user_id AND b.org_id = r.lead_org_id))
  ORDER BY r.id
  LIMIT 1;

  SELECT m.user_id INTO v_uid
  FROM public.org_members m LEFT JOIN public.profiles pr ON pr.id = m.user_id
  WHERE m.org_id = v_vorg
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id = v_lead)
  ORDER BY (lower(btrim(coalesce(pr.email, ''))) = 'gmarkant@icloud.com') DESC, m.user_id
  LIMIT 1;

  SELECT m.user_id INTO v_agency_uid
  FROM public.org_members m LEFT JOIN public.profiles pr ON pr.id = m.user_id
  WHERE m.org_id = v_lead
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id = v_vorg)
  ORDER BY (lower(btrim(coalesce(pr.email, ''))) = 'gmarkant@gmail.com') DESC, m.user_id
  LIMIT 1;

  IF v_sub IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 109 YET.  NO SUBJECT: the April Partner Test Agency (organization %) has no bid to a lead organization with a separate member. Nothing was tested. This is not a pass.\n=====================================================\n', coalesce(v_vorg::text, 'NOT FOUND');
  END IF;

  v_pure := NOT EXISTS (SELECT 1 FROM public.org_members m3
                        JOIN public.partner_rfp_responses r3 ON r3.lead_org_id = m3.org_id
                        WHERE m3.user_id = v_uid);

  SELECT m.user_id, r.lead_org_id INTO v_other_uid, v_other_lead
  FROM public.partner_rfp_responses r
  JOIN public.org_members m ON m.org_id = r.lead_org_id
  WHERE r.lead_org_id <> v_lead
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id IN (v_lead, v_vorg))
  ORDER BY r.id, m.user_id
  LIMIT 1;

  -- A bid the agency member does NOT lead, for A6. Members are not needed on its lead organization.
  SELECT r.id INTO v_other_sub
  FROM public.partner_rfp_responses r
  WHERE r.lead_org_id IS NOT NULL AND r.lead_org_id <> v_lead
    AND (v_agency_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_members x
                                             WHERE x.user_id = v_agency_uid AND x.org_id = r.lead_org_id))
  ORDER BY r.id
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
    $q$V3a$q$,
    $q$V3b$q$,
    $q$V3c$q$,
    $q$V3d$q$,
    $q$V4$q$,
    $q$V5$q$,
    $q$V6$q$,
    $q$V7$q$,
    $q$V8$q$,
    $q$V9a$q$,
    $q$V9b$q$,
    $q$V10$q$,
    $q$A1$q$,
    $q$A2$q$,
    $q$A3$q$,
    $q$A4$q$,
    $q$A5$q$,
    $q$A6$q$,
    $q$A7$q$,
    $q$A8$q$,
    $q$B1$q$,
    $q$B2$q$,
    $q$Z1$q$,
    $q$Z2$q$,
    $q$Z3$q$,
    $q$Z4$q$,
    $q$Z5$q$];

  sc_label := ARRAY[
    $q$V1   vendor: select * on its bid$q$,
    $q$V2   vendor: reads every vendor-rendered column$q$,
    $q$V3a  vendor: reads legacy composite_score$q$,
    $q$V3b  vendor: reads legacy ai_summary_short$q$,
    $q$V3c  vendor: reads legacy ai_summary_detailed$q$,
    $q$V3d  vendor: reads legacy ai_summary_generated_at$q$,
    $q$V4   vendor: reads the table (its bid)$q$,
    $q$V5   vendor: reads the table (all rows)$q$,
    $q$V6   vendor: inserts into the table$q$,
    $q$V7   vendor: updates the table$q$,
    $q$V8   vendor: deletes from the table$q$,
    $q$V9a  vendor: sets legacy composite_score on its bid$q$,
    $q$V9b  vendor: sets legacy ai_summary_short on its bid$q$,
    $q$V10  vendor: edits its bid's proposal text (still works)$q$,
    $q$A1   agency: select * on the bid$q$,
    $q$A2   agency: reads legacy composite_score$q$,
    $q$A3   agency colleague: reads the table$q$,
    $q$A4   agency colleague: updates the table$q$,
    $q$A5   agency colleague: upserts (the helper's write)$q$,
    $q$A6   agency: private row for a bid it does not lead$q$,
    $q$A7   agency: a forged lead_org_id does not move the row$q$,
    $q$A8   agency: sets legacy composite_score$q$,
    $q$B1   other agency: reads this agency's row$q$,
    $q$B2   other agency: updates this agency's row$q$,
    $q$Z1   service role: reads the table$q$,
    $q$Z2   service role: upserts the table$q$,
    $q$Z3   anon: reads the table$q$,
    $q$Z4   anon: reads legacy composite_score$q$,
    $q$Z5   service role: sets legacy ai_summary_detailed$q$];

  sc_actor := ARRAY[
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor_pure$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$vendor$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency_x$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$other$q$,
    $q$other$q$,
    $q$service$q$,
    $q$service$q$,
    $q$anon$q$,
    $q$anon$q$,
    $q$service$q$];

  sc_sql := ARRAY[
    $q$SELECT count(*)::text FROM (SELECT * FROM public.partner_rfp_responses WHERE id = %1$L) x$q$,
    $q$SELECT count(*)::text FROM (SELECT id, proposal_text, budget_proposal, timeline_proposal, payment_terms, terms_disclosure, attachments, business_criteria_responses, status, agency_feedback, feedback_updated_at, submitted_at, updated_at, business_criteria_acknowledgments, budget_lines, proposal_sections FROM public.partner_rfp_responses WHERE id = %1$L) x$q$,
    $q$SELECT coalesce((SELECT composite_score::text FROM public.partner_rfp_responses WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT ai_summary_short FROM public.partner_rfp_responses WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT ai_summary_detailed FROM public.partner_rfp_responses WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT (ai_summary_generated_at IS NOT NULL)::text FROM public.partner_rfp_responses WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT count(*)::text FROM public.partner_rfp_response_private WHERE response_id = %1$L$q$,
    $q$SELECT count(*)::text FROM public.partner_rfp_response_private$q$,
    $q$WITH i AS (INSERT INTO public.partner_rfp_response_private (response_id, lead_org_id, composite_score) VALUES (%1$L, %5$L, 99) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_response_private SET composite_score = 99 WHERE response_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH d AS (DELETE FROM public.partner_rfp_response_private WHERE response_id = %1$L RETURNING 1) SELECT count(*)::text FROM d$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_responses SET composite_score = 99 WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_responses SET ai_summary_short = 'FORGED' WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_responses SET proposal_text = proposal_text WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM (SELECT * FROM public.partner_rfp_responses WHERE id = %1$L) x$q$,
    $q$SELECT coalesce((SELECT composite_score::text FROM public.partner_rfp_responses WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT composite_score::text || '/' || ai_summary_short FROM public.partner_rfp_response_private WHERE response_id = %1$L), 'NULL')$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_response_private SET composite_score = 77, ai_summary_short = 'EDITED' WHERE response_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (INSERT INTO public.partner_rfp_response_private (response_id, composite_score) VALUES (%1$L, 66) ON CONFLICT (response_id) DO UPDATE SET composite_score = EXCLUDED.composite_score RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH i AS (INSERT INTO public.partner_rfp_response_private (response_id, lead_org_id, composite_score) VALUES (%3$L, %2$L, 1) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH u AS (INSERT INTO public.partner_rfp_response_private (response_id, lead_org_id, composite_score) VALUES (%1$L, %5$L, 1) ON CONFLICT (response_id) DO UPDATE SET composite_score = EXCLUDED.composite_score RETURNING lead_org_id) SELECT ((SELECT lead_org_id FROM u) = %2$L::uuid)::text$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_responses SET composite_score = 55 WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.partner_rfp_response_private WHERE response_id = %1$L$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_response_private SET composite_score = 1 WHERE response_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.partner_rfp_response_private WHERE response_id = %1$L$q$,
    $q$WITH u AS (INSERT INTO public.partner_rfp_response_private (response_id, ai_summary_short) VALUES (%1$L, 'SERVICE') ON CONFLICT (response_id) DO UPDATE SET ai_summary_short = EXCLUDED.ai_summary_short RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.partner_rfp_response_private$q$,
    $q$SELECT coalesce((SELECT composite_score::text FROM public.partner_rfp_responses WHERE id = %1$L), 'NULL')$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_responses SET ai_summary_detailed = 'SERVICE' WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$];

  sc_exp := ARRAY[
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:42.5$q$,
    $q$OK:42.5$q$,
    $q$OK:NULL$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
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
    $q$REFUSED:*$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:42.5$q$,
    $q$OK:42.5$q$,
    $q$OK:NULL$q$,
    $q$NOTABLE$q$,
    $q$OK:42.5/SENTINEL$q$,
    $q$OK:42.5/SENTINEL$q$,
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
    $q$OK:true$q$,
    $q$OK:true$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$,
    $q$NOTABLE$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$NOTABLE$q$,
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
    $q$OK:NULL$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$];


  v_n_a := array_length(sc_id, 1);
  IF v_n_a <> 29 OR array_length(sc_label, 1) <> v_n_a OR array_length(sc_actor, 1) <> v_n_a
     OR array_length(sc_sql, 1) <> v_n_a OR array_length(sc_exp, 1) <> v_n_a * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (id %, label %, actor %, sql %, exp %)',
      array_length(sc_id, 1), array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_sql, 1), array_length(sc_exp, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n_a * c_phases]);

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses';

  SELECT relacl::text INTO v_acl_before FROM pg_class WHERE oid = 'public.partner_rfp_responses'::regclass;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE. Between phases the migration code is executed
  -- in this same transaction.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partner_rfp_responses x), ''));
    v_fpn := '';
    IF to_regclass('public.partner_rfp_response_private') IS NOT NULL THEN
      EXECUTE 'SELECT md5(coalesce(string_agg(x::text, ''|'' ORDER BY x.response_id), '''')) FROM public.partner_rfp_response_private x' INTO v_fpn;
    END IF;
    v_fp0 := v_fp0 || v_fpn;

    FOR v_i IN 1 .. v_n_a LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];

      IF (v_actor = 'agency' AND v_agency_uid IS NULL)
         OR (v_actor = 'agency_x' AND (v_agency_uid IS NULL OR v_other_sub IS NULL))
         OR (v_actor = 'other' AND v_other_uid IS NULL)
         OR (v_actor = 'vendor_pure' AND NOT v_pure)
         OR (v_actor = 'vendor_p2' AND v_x6 IS NULL) THEN
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
              EXECUTE format($s$UPDATE public.partner_rfp_responses SET composite_score = 42.5, ai_summary_short = 'SENTINEL', ai_summary_detailed = 'SENTINEL', ai_summary_generated_at = '2026-01-01 00:00:00+00' WHERE id = %1$L$s$, v_sub, v_lead, v_proj, v_x7);
            WHEN 2 THEN
              EXECUTE format($s$UPDATE public.partner_rfp_responses SET composite_score = 42.5, ai_summary_short = 'SENTINEL', ai_summary_detailed = 'SENTINEL', ai_summary_generated_at = '2026-01-01 00:00:00+00' WHERE id = %1$L$s$, v_sub, v_lead, v_proj, v_x7);
              EXECUTE format($s$INSERT INTO public.partner_rfp_response_private (response_id, lead_org_id, composite_score, ai_summary_short, ai_summary_detailed, ai_summary_generated_at) VALUES (%1$L, %2$L, 42.5, 'SENTINEL', 'SENTINEL', '2026-01-01 00:00:00+00') ON CONFLICT (response_id) DO UPDATE SET composite_score = EXCLUDED.composite_score, ai_summary_short = EXCLUDED.ai_summary_short, ai_summary_detailed = EXCLUDED.ai_summary_detailed, ai_summary_generated_at = EXCLUDED.ai_summary_generated_at$s$, v_sub, v_lead, v_proj, v_x7);
            WHEN 3 THEN
              EXECUTE format($s$INSERT INTO public.partner_rfp_response_private (response_id, lead_org_id, composite_score, ai_summary_short, ai_summary_detailed, ai_summary_generated_at) VALUES (%1$L, %2$L, 42.5, 'SENTINEL', 'SENTINEL', '2026-01-01 00:00:00+00') ON CONFLICT (response_id) DO UPDATE SET composite_score = EXCLUDED.composite_score, ai_summary_short = EXCLUDED.ai_summary_short, ai_summary_detailed = EXCLUDED.ai_summary_detailed, ai_summary_generated_at = EXCLUDED.ai_summary_generated_at$s$, v_sub, v_lead, v_proj, v_x7);
          END CASE;

          IF v_actor IN ('vendor', 'vendor_pure', 'vendor_p2') THEN
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

          EXECUTE format(sc_sql[v_i], v_sub, v_lead, v_other_sub, v_other_lead, v_vorg, v_x6, v_x7) INTO v_txt;
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
              WHEN SQLSTATE IN ('42501', 'LG109', 'LG110') THEN 'REFUSED:' || SQLSTATE
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partner_rfp_responses x), ''));
      v_fpn := '';
      IF to_regclass('public.partner_rfp_response_private') IS NOT NULL THEN
        EXECUTE 'SELECT md5(coalesce(string_agg(x::text, ''|'' ORDER BY x.response_id), '''')) FROM public.partner_rfp_response_private x' INTO v_fpn;
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
        EXECUTE $m109$

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_orphans bigint;
BEGIN
  IF to_regclass('public.partner_rfp_responses') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '109 refuses to apply: public.partner_rfp_responses or public.organizations does not exist.'
      USING ERRCODE = 'LG109';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '109 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG109';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'partner_rfp_responses'
         AND column_name IN ('lead_org_id', 'composite_score', 'ai_summary_short',
                             'ai_summary_detailed', 'ai_summary_generated_at')) <> 5 THEN
    RAISE EXCEPTION '109 refuses to apply: partner_rfp_responses is missing lead_org_id or one of the four columns to copy.'
      USING ERRCODE = 'LG109';
  END IF;

  IF to_regclass('public.partner_rfp_response_private') IS NOT NULL THEN
    RAISE EXCEPTION '109 refuses to apply: public.partner_rfp_response_private already exists. Read the schema before going further.'
      USING ERRCODE = 'LG109';
  END IF;

  SELECT count(*) INTO v_orphans FROM public.partner_rfp_responses
   WHERE lead_org_id IS NULL
     AND (composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
          OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL);
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION '109 refuses to apply: % response(s) hold a value to copy but have no lead_org_id, so no agency could own the copy.', v_orphans
      USING ERRCODE = 'LG109';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. THE TABLE.
-- ---------------------------------------------------------------------
CREATE TABLE public.partner_rfp_response_private (
  response_id             uuid         PRIMARY KEY REFERENCES public.partner_rfp_responses (id) ON DELETE CASCADE,
  lead_org_id             uuid         NOT NULL    REFERENCES public.organizations (id),
  composite_score         numeric(4,1),
  ai_summary_short        text,
  ai_summary_detailed     text,
  ai_summary_generated_at timestamptz,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX partner_rfp_response_private_lead_org_id_idx
  ON public.partner_rfp_response_private (lead_org_id);

COMMENT ON TABLE public.partner_rfp_response_private IS
  'Migration 109. The lead agency''s composite score and AI procurement summaries of a bid. Agency-only: there is NO vendor policy. Replaces partner_rfp_responses.composite_score and ai_summary_short / _detailed / _generated_at, which the vendor can read and (before 110) write through its whole-row policies.';

-- ---------------------------------------------------------------------
-- 2. THE GUARD. Sets lead_org_id from the parent; pins both keys; owns the timestamps.
--    It runs for every caller, the service role included.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partner_rfp_response_private_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.response_id IS DISTINCT FROM OLD.response_id
       OR NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
      RAISE EXCEPTION 'partner_rfp_response_private.response_id and lead_org_id cannot be changed'
        USING ERRCODE = 'LG109';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  -- INSERT. Read under the CALLER's row level security. The caller's lead_org_id is ignored:
  -- the agency key always comes from the parent row.
  SELECT r.lead_org_id INTO v_lead FROM public.partner_rfp_responses r WHERE r.id = NEW.response_id;

  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'partner_rfp_response_private: response_id must be an existing response the caller can see'
      USING ERRCODE = 'LG109';
  END IF;

  NEW.lead_org_id := v_lead;
  NEW.created_at  := now();
  NEW.updated_at  := NEW.created_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_rfp_response_private_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_response_private
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_response_private_guard();

REVOKE EXECUTE ON FUNCTION public.partner_rfp_response_private_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_response_private_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_response_private_guard() FROM authenticated;

-- ---------------------------------------------------------------------
-- 3. PRIVILEGES. anon gets nothing, by name. authenticated gets SELECT, INSERT, UPDATE only.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.partner_rfp_response_private FROM PUBLIC;
REVOKE ALL ON TABLE public.partner_rfp_response_private FROM anon;
REVOKE ALL ON TABLE public.partner_rfp_response_private FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.partner_rfp_response_private TO authenticated;
GRANT ALL ON TABLE public.partner_rfp_response_private TO service_role;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY. THREE POLICIES. NONE IS FOR A VENDOR. NO DELETE POLICY.
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_response_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_rfp_response_private_org_select"
  ON public.partner_rfp_response_private AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partner_rfp_response_private_org_insert"
  ON public.partner_rfp_response_private AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partner_rfp_response_private_org_update"
  ON public.partner_rfp_response_private AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

-- ---------------------------------------------------------------------
-- 5. BACKFILL. A COPY of every response holding any of the four. The legacy columns are NOT touched.
-- ---------------------------------------------------------------------
INSERT INTO public.partner_rfp_response_private
  (response_id, lead_org_id, composite_score, ai_summary_short, ai_summary_detailed, ai_summary_generated_at)
SELECT r.id, r.lead_org_id, r.composite_score, r.ai_summary_short, r.ai_summary_detailed, r.ai_summary_generated_at
FROM public.partner_rfp_responses r
WHERE r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
   OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL
ON CONFLICT (response_id) DO NOTHING;

DO $backfill_check$
DECLARE
  v_src      bigint;
  v_dst      bigint;
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_src FROM public.partner_rfp_responses
   WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
      OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.partner_rfp_response_private;
  SELECT count(*) INTO v_mismatch
  FROM public.partner_rfp_responses r
  LEFT JOIN public.partner_rfp_response_private n ON n.response_id = r.id
  WHERE (r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
         OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL)
    AND (n.response_id IS NULL
         OR n.lead_org_id             IS DISTINCT FROM r.lead_org_id
         OR n.composite_score         IS DISTINCT FROM r.composite_score
         OR n.ai_summary_short        IS DISTINCT FROM r.ai_summary_short
         OR n.ai_summary_detailed     IS DISTINCT FROM r.ai_summary_detailed
         OR n.ai_summary_generated_at IS DISTINCT FROM r.ai_summary_generated_at);

  IF v_mismatch <> 0 OR v_dst <> v_src THEN
    RAISE EXCEPTION '109 backfill is not an exact copy: % response(s) with a value, % row(s) in the new table, % mismatched. Nothing was committed.',
      v_src, v_dst, v_mismatch
      USING ERRCODE = 'LG109';
  END IF;
END
$backfill_check$;

-- PostgREST must see the table at commit, or the code keeps falling back to the legacy columns.
NOTIFY pgrst, 'reload schema';


        $m109$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ($l$109$l$ || ' raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
      IF to_regclass('public.partner_rfp_response_private') IS NOT NULL THEN
        EXECUTE $bf$SELECT (SELECT count(*) FROM public.partner_rfp_responses p WHERE p.composite_score IS NOT NULL OR p.ai_summary_short IS NOT NULL OR p.ai_summary_detailed IS NOT NULL OR p.ai_summary_generated_at IS NOT NULL)::text || ' / ' || (SELECT count(*) FROM public.partner_rfp_response_private)::text || ' / ' || (SELECT count(*) FROM public.partner_rfp_responses p LEFT JOIN public.partner_rfp_response_private n ON n.response_id = p.id WHERE (p.composite_score IS NOT NULL OR p.ai_summary_short IS NOT NULL OR p.ai_summary_detailed IS NOT NULL OR p.ai_summary_generated_at IS NOT NULL) AND (n.response_id IS NULL OR n.composite_score IS DISTINCT FROM p.composite_score OR n.ai_summary_short IS DISTINCT FROM p.ai_summary_short OR n.ai_summary_detailed IS DISTINCT FROM p.ai_summary_detailed OR n.ai_summary_generated_at IS DISTINCT FROM p.ai_summary_generated_at))::text$bf$ INTO v_bf;
      END IF;
    END IF;
    IF v_ph = 2 THEN
      RESET ROLE;
      BEGIN
        EXECUTE $m110$

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.partner_rfp_response_private') IS NULL THEN
    RAISE EXCEPTION '110 refuses to apply: public.partner_rfp_response_private does not exist. Apply 109 first.'
      USING ERRCODE = 'LG110';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.partner_rfp_responses r
  LEFT JOIN public.partner_rfp_response_private n ON n.response_id = r.id
  WHERE (r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
         OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL)
    AND NOT (n.response_id IS NOT NULL
             AND (r.composite_score IS NULL
                  OR n.composite_score IS NOT DISTINCT FROM r.composite_score
                  OR n.updated_at > n.created_at)
             AND ((r.ai_summary_short IS NULL AND r.ai_summary_detailed IS NULL AND r.ai_summary_generated_at IS NULL)
                  OR (n.ai_summary_short        IS NOT DISTINCT FROM r.ai_summary_short
                      AND n.ai_summary_detailed     IS NOT DISTINCT FROM r.ai_summary_detailed
                      AND n.ai_summary_generated_at IS NOT DISTINCT FROM r.ai_summary_generated_at)
                  OR (r.ai_summary_generated_at IS NOT NULL
                      AND n.ai_summary_generated_at IS NOT NULL
                      AND n.ai_summary_generated_at > r.ai_summary_generated_at)));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '110 refuses to apply: % response(s) hold a legacy score or summary that partner_rfp_response_private does not account for. Nulling would destroy it, and it may have been written by a vendor. See the DRIFT section of this file (P1b lists them).', v_unaccounted
      USING ERRCODE = 'LG110';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partner_rfp_responses'::regclass
              AND tgname = 'partner_rfp_responses_private_columns_guard') THEN
    RAISE EXCEPTION '110 refuses to apply: the guard trigger already exists. Read the schema before going further.'
      USING ERRCODE = 'LG110';
  END IF;
END
$preflight$;

UPDATE public.partner_rfp_responses
   SET composite_score         = NULL,
       ai_summary_short        = NULL,
       ai_summary_detailed     = NULL,
       ai_summary_generated_at = NULL
 WHERE composite_score IS NOT NULL
    OR ai_summary_short IS NOT NULL
    OR ai_summary_detailed IS NOT NULL
    OR ai_summary_generated_at IS NOT NULL;

CREATE FUNCTION public.partner_rfp_responses_private_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.composite_score         IS NOT NULL THEN v_set := array_append(v_set, 'composite_score'); END IF;
  IF NEW.ai_summary_short        IS NOT NULL THEN v_set := array_append(v_set, 'ai_summary_short'); END IF;
  IF NEW.ai_summary_detailed     IS NOT NULL THEN v_set := array_append(v_set, 'ai_summary_detailed'); END IF;
  IF NEW.ai_summary_generated_at IS NOT NULL THEN v_set := array_append(v_set, 'ai_summary_generated_at'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a bid.'
    USING ERRCODE = 'LG110',
          DETAIL  = format(
            'partner_rfp_responses.%s must stay null. Since migration 110 the lead agency''s score and AI summaries live in partner_rfp_response_private, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', partner_rfp_responses.')
          );
END;
$$;

COMMENT ON FUNCTION public.partner_rfp_responses_private_columns_guard() IS
  'Migration 110. BEFORE INSERT OR UPDATE guard on public.partner_rfp_responses: composite_score, ai_summary_short, ai_summary_detailed and ai_summary_generated_at must stay NULL, for EVERY caller, because their only home is partner_rfp_response_private (109). Refuses with LG110; never silently nulls. Closes the vendor write path through "Partners update own RFP responses" and "Partners insert RFP responses for their inbox", which have no column limit.';

CREATE TRIGGER partner_rfp_responses_private_columns_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_responses_private_columns_guard();

REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_private_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_private_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_private_columns_guard() FROM authenticated;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.partner_rfp_responses
   WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
      OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '110: % response(s) still hold a legacy value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG110';
  END IF;
END
$verify$;


        $m110$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ($l$110$l$ || ' raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
    END IF;
  END LOOP;

  RESET ROLE;

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_after
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses';
  SELECT relacl::text INTO v_acl_after FROM pg_class WHERE oid = 'public.partner_rfp_responses'::regclass;

  ---------------------------------------------------------------------
  -- JUDGEMENT. Phase 1 is the BEFORE state: a mismatch there is INCONCLUSIVE (the premise is wrong),
  -- never FAIL. A mismatch in a later phase is a FAIL. FAULT and NOSUBJECT are INCONCLUSIVE.
  -- A scenario with the same expectation in every phase is marked NOT DISCRIMINATING: it shows the
  -- migration did not break something, not that it changed something.
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n_a LOOP
    v_ran := v_ran + 1;
    v_logged := v_logged + 1;
    v_ba := v_ba || '  ' || sc_label[v_i] || E'\n';
    v_st := 'PASS';
    v_detail := '';
    v_same := true;
    FOR v_k IN 1 .. c_phases LOOP
      v_idx := (v_i - 1) * c_phases + v_k;
      v_cls := r_cls[v_idx];
      v_exp := sc_exp[v_idx];
      IF v_exp IS DISTINCT FROM sc_exp[(v_i - 1) * c_phases + 1] THEN v_same := false; END IF;
      v_ba := v_ba || format(E'      phase %s : %s   (expected %s)\n', v_k, v_cls, v_exp);
      IF v_cls LIKE 'FAULT%' OR v_cls = 'NOSUBJECT' OR v_cls = 'NOT RUN' THEN
        IF v_st = 'PASS' THEN v_st := 'INCONCLUSIVE'; END IF;
        v_detail := v_detail || format(' [phase %s: %s - %s]', v_k, CASE WHEN v_cls = 'NOSUBJECT' THEN 'NO SUBJECT' ELSE v_cls END, 'says nothing about 109');
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
    IF v_st = 'PASS' AND v_same THEN v_detail := v_detail || ' (NOT DISCRIMINATING: same expectation in every phase)'; END IF;

    IF v_st = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_st = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1; END IF;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 60) || rpad(v_st, 14) || v_detail;
  END LOOP;

  -- S9 and S10 share one owner setup: a throwaway parent row, a private row whose caller-supplied
  -- lead_org_id is the VENDOR's organization, then a DELETE of the parent. Rolled back with LG097.
  v_s9 := NULL; v_s10 := NULL; v_s9d := ''; v_s10d := '';
  SELECT confdeltype::text INTO v_txt FROM pg_constraint
   WHERE conrelid = to_regclass('public.partner_rfp_response_private') AND contype = 'f' AND confrelid = 'public.partner_rfp_responses'::regclass;
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_tmp := gen_random_uuid();
    EXECUTE format($d$INSERT INTO public.partner_rfp_responses SELECT (jsonb_populate_record(NULL::public.partner_rfp_responses, to_jsonb(r) || jsonb_build_object('id', %L, 'inbox_item_id', NULL, 'composite_score', NULL, 'ai_summary_short', NULL, 'ai_summary_detailed', NULL, 'ai_summary_generated_at', NULL))).* FROM public.partner_rfp_responses r WHERE r.id = %L$d$, v_tmp, v_sub);
    EXECUTE format($d$INSERT INTO public.partner_rfp_response_private (response_id, lead_org_id, ai_summary_short) VALUES (%L, %L, 'CASCADE')$d$, v_tmp, v_vorg);
    EXECUTE format($d$SELECT (lead_org_id = %L::uuid)::text FROM public.partner_rfp_response_private WHERE response_id = %L$d$, v_lead, v_tmp) INTO v_s9t;
    EXECUTE format($d$DELETE FROM public.partner_rfp_responses WHERE id = %L$d$, v_tmp);
    EXECUTE format($d$SELECT count(*)::text FROM public.partner_rfp_response_private WHERE response_id = %L$d$, v_tmp) INTO v_s10t;
    v_s9  := v_s9t = 'true';
    v_s9d := format('(caller sent the vendor org %s; stored lead_org_id equals the parent''s: %s)', v_vorg, v_s9t);
    v_s10 := v_s10t = '0' AND v_txt = 'c';
    v_s10d := format('(confdeltype %s; private rows left after the parent delete: %s)', coalesce(v_txt, 'NONE'), v_s10t);
    RAISE EXCEPTION 'cascade check complete' USING ERRCODE = 'LG097';
  EXCEPTION
    WHEN sqlstate 'LG097' THEN NULL;
    WHEN OTHERS THEN
      v_s9 := NULL; v_s10 := NULL;
      v_s9d  := 'TEST FAULT: the owner setup raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
      v_s10d := format('(confdeltype %s) ', coalesce(v_txt, 'NONE')) || v_s9d;
  END;

  v_ok := NULL; v_detail := '';
  IF v_bf IS NULL THEN
    v_ok := false; v_detail := 'the table did not exist after 109 ran, so no copy was measured';
  ELSE
    v_ok := split_part(v_bf, ' / ', 1) = split_part(v_bf, ' / ', 2) AND split_part(v_bf, ' / ', 3) = '0';
    v_detail := format('(measured right after 109: %s legacy rows / %s table rows / %s mismatched)', split_part(v_bf, ' / ', 1), split_part(v_bf, ' / ', 2), split_part(v_bf, ' / ', 3));
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S1  backfill is an exact copy of the legacy columns$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S1  backfill is an exact copy of the legacy columns$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S1  backfill is an exact copy of the legacy columns$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  SELECT count(*), count(*) FILTER (WHERE roles::text <> '{authenticated}'),
         count(*) FILTER (WHERE cmd = 'DELETE' OR cmd = 'ALL'),
         count(*) FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~* '(vendor_org_id|partnerships|partner_rfp_responses)')
    INTO v_n_a, v_n_b, v_n_c, v_k
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_response_private';
  v_ok := coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.partner_rfp_response_private')), false)
          AND v_n_a = 3 AND v_n_b = 0 AND v_n_c = 0 AND v_k = 0;
  v_detail := format('(policies %s, not-authenticated-only %s, delete-or-all %s, mention vendor or parent %s)', v_n_a, v_n_b, v_n_c, v_k);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S2  table: RLS on, 3 policies, authenticated, no vendor$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S2  table: RLS on, 3 policies, authenticated, no vendor$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S2  table: RLS on, 3 policies, authenticated, no vendor$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  IF to_regclass('public.partner_rfp_response_private') IS NULL THEN
    v_ok := false; v_detail := 'the table does not exist';
  ELSE
    SELECT string_agg(p.priv || '=' || has_table_privilege('anon', 'public.partner_rfp_response_private', p.priv)::text, ' ' ORDER BY p.ord),
           string_agg(p.priv || '=' || has_table_privilege('authenticated', 'public.partner_rfp_response_private', p.priv)::text, ' ' ORDER BY p.ord)
      INTO v_txt, v_detail
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) WITH ORDINALITY AS p(priv, ord);
    v_ok := v_txt = 'SELECT=false INSERT=false UPDATE=false DELETE=false TRUNCATE=false REFERENCES=false TRIGGER=false'
            AND v_detail = 'SELECT=true INSERT=true UPDATE=true DELETE=false TRUNCATE=false REFERENCES=false TRIGGER=false';
    v_detail := format('(anon: %s ; authenticated: %s)', v_txt, v_detail);
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S3  privileges: anon none; authenticated S/I/U only$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S3  privileges: anon none; authenticated S/I/U only$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S3  privileges: anon none; authenticated S/I/U only$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  SELECT (t.tgenabled = 'O') AND ((t.tgtype & 2) = 2) AND ((t.tgtype & 4) = 4) AND ((t.tgtype & 16) = 16)
    INTO v_ok
  FROM pg_trigger t
  WHERE t.tgrelid = to_regclass('public.partner_rfp_response_private') AND t.tgname = 'partner_rfp_response_private_guard';
  v_ok := coalesce(v_ok, false)
          AND NOT has_function_privilege('anon', 'public.partner_rfp_response_private_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.partner_rfp_response_private_guard()', 'EXECUTE');
  v_detail := '(109''s V5 would return the same)';
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S4  partner_rfp_response_private guard: BEFORE INSERT OR UPDATE, not callable$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S4  partner_rfp_response_private guard: BEFORE INSERT OR UPDATE, not callable$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S4  partner_rfp_response_private guard: BEFORE INSERT OR UPDATE, not callable$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(fingerprint %s before, %s after)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on partner_rfp_responses changed$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on partner_rfp_responses changed$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on partner_rfp_responses changed$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on partner_rfp_responses changed (relacl)$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on partner_rfp_responses changed (relacl)$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on partner_rfp_responses changed (relacl)$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  SELECT count(*) INTO v_n_a FROM public.partner_rfp_responses WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL;
  v_ok := v_n_a = 0;
  v_detail := format('(%s row(s) still hold one of the columns)', v_n_a);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 110 no partner_rfp_responses row carries a legacy value$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 110 no partner_rfp_responses row carries a legacy value$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 110 no partner_rfp_responses row carries a legacy value$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  SELECT (t.tgenabled = 'O') AND ((t.tgtype & 2) = 2) AND ((t.tgtype & 4) = 4) AND ((t.tgtype & 16) = 16)
    INTO v_ok
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass AND t.tgname = 'partner_rfp_responses_private_columns_guard';
  v_ok := coalesce(v_ok, false)
          AND NOT has_function_privilege('anon', 'public.partner_rfp_responses_private_columns_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.partner_rfp_responses_private_columns_guard()', 'EXECUTE');
  v_detail := '(enabled, BEFORE, INSERT and UPDATE; EXECUTE revoked from anon and authenticated)';
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S8  110 guard on partner_rfp_responses: BEFORE INSERT OR UPDATE$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S8  110 guard on partner_rfp_responses: BEFORE INSERT OR UPDATE$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S8  110 guard on partner_rfp_responses: BEFORE INSERT OR UPDATE$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := v_s9; v_detail := v_s9d;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S9  lead_org_id is set from the parent, not the caller$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S9  lead_org_id is set from the parent, not the caller$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S9  lead_org_id is set from the parent, not the caller$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := v_s10; v_detail := v_s10d;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S10 deleting the parent deletes the private row$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S10 deleting the parent deletes the private row$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S10 deleting the parent deletes the private row$l$, 60) || rpad('FAIL', 14) || v_detail;
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
    v_headline := format('DO NOT APPLY 109.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 109.';
    v_headline := format('SAFE TO APPLY 109.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 109 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 109 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 109.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0; NO SUBJECT counts here)\n', v_inconc)
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n', v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'isolation check : %s scenario run(s) each compared to the pre-loop fingerprint of partner_rfp_responses AND partner_rfp_response_private: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT          : vendor org %s (%s), vendor user %s (vendor-only: %s), lead org %s, subject row %s, agency colleague %s, other agency member %s, other row %s\n',
              v_vorg, coalesce(v_vorg_name, '?'), v_uid, v_pure, v_lead, v_sub, coalesce(v_agency_uid::text, 'NONE'), coalesce(v_other_uid::text, 'NONE'), coalesce(v_other_sub::text, 'NONE'))
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE (same subject, same transaction)\n'
    || E'  phase 1 = BEFORE 109 (today)\n  phase 2 = AFTER 109, BEFORE 110 (the leak window)\n  phase 3 = AFTER 110 (leak closed)\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

-- THE BACKSTOP. IT STAYS. Not reached on the expected path (the DO block ends in RAISE
-- EXCEPTION and aborts the transaction). It is the net for a client that swallows the error.
ROLLBACK;
