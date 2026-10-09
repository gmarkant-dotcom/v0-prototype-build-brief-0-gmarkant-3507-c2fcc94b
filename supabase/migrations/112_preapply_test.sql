-- =====================================================================
-- 112 PRE-APPLY TEST. ONE PASTE. APPLIES 112, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-09 on fix/109-112-scoring-and-reviews-split. NOT RUN: THERE IS NO LOCAL POSTGRES AND
-- NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain error, not in
-- "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- GENERATED so that the inlined migration code is byte-identical to the migration files.
--
-- WHY THIS FILE EXISTS. 112 nulls the legacy columns on delivery_reviews and adds a guard that refuses any later write
-- that sets them. Too eager and it destroys a value the table never received; too timid and the vendor
-- still reads them. THIS FILE REQUIRES 111 TO BE APPLIED FOR REAL FIRST: it stops if the table is absent.
--
-- PHASES: phase 1 BEFORE 112 (111 live: the leak window), phase 2 AFTER 112.
-- THE DRIFT CASES (D*) run BEFORE the phase loop, because after 112 the guard refuses the setup writes.
--
-- EVERY ASSERTION RUNS IN EVERY PHASE. The BEFORE column MEASURES the defect rather than assuming it: the
-- vendor's V3* reads and its legacy writes must SUCCEED before 112. If they do not, the verdict is
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
--     "SAFE TO APPLY 112."       -> and only this.
--     "DO NOT APPLY 112 YET."    -> INCONCLUSIVE or NO SUBJECT. Not a green light.
--     "DO NOT APPLY 112."        -> an assertion FAILED, or the test is broken.
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
-- THE SUBJECT REVIEW IS SYNTHETIC: a status = 'complete' delivery review on the April vendor's partnership,
-- on a project that partnership has no review for, inserted by the owner inside every scenario and undone
-- with it. V10 needs a second such project (NO SUBJECT without one).
--
-- ACTORS: vendor, vendor_pure (the same user, only if they belong to no organization that owns a row of
-- delivery_reviews, so "all rows" reads mean something), agency (a lead-org member: the colleague), agency_x (the
-- same, aimed at a row another organization owns), other (a member of a DIFFERENT lead organization),
-- service (SET LOCAL ROLE service_role), anon (SET LOCAL ROLE anon).
-- EXPECT NO SUBJECT for other, and therefore B1 and B2: m a r k a n t is the only lead organization with
-- members. That is INCONCLUSIVE, never PASS, and it means cross-agency isolation is NOT shown by this run.
-- It would be shown by a second lead organization with a member.
--
-- IT IMPERSONATES, AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE, then auth.uid() (or current_user)
-- is read back; a mismatch raises LG098, reported as INCONCLUSIVE with the words TEST FAULT.
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block that ends in LG097, undoing its setup
-- and its write. A fingerprint of every delivery_reviews row AND of the private table is compared after each one.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * EXECUTE of a multi-statement string (the inlined migration) is accepted.
--   * CREATE TABLE / FUNCTION / TRIGGER inside the DO block, after rolled-back writes, does not hit 55006.
--   * A BEFORE INSERT trigger fires before the INSERT policy's WITH CHECK (V6 / A6 accept any REFUSED).
--   * INSERT ... RETURNING as the vendor (V10) is checked against the SELECT policies too.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 38;
  c_phases       CONSTANT integer := 2;
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
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 112 YET.  111 IS NOT APPLIED: public.delivery_review_private does not exist. Apply 111 first. Nothing was tested.\n=====================================================\n';
  END IF;

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

  -- THE SUBJECT PARTNERSHIP: the April vendor's, with a lead organization that has a member outside the
  -- vendor organization, and vice versa. THE SUBJECT REVIEW IS SYNTHETIC: a status = 'complete' review
  -- on that partnership and on a project it has no review for, inserted by the owner inside each
  -- scenario and undone with it. That way the run does not depend on the vendor having a real review.
  SELECT p.id, p.lead_org_id INTO v_x7, v_lead
  FROM public.partnerships p
  WHERE p.vendor_org_id = v_vorg AND p.lead_org_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_members a WHERE a.org_id = p.lead_org_id
                  AND NOT EXISTS (SELECT 1 FROM public.org_members b WHERE b.user_id = a.user_id AND b.org_id = v_vorg))
    AND EXISTS (SELECT 1 FROM public.org_members a WHERE a.org_id = v_vorg
                  AND NOT EXISTS (SELECT 1 FROM public.org_members b WHERE b.user_id = a.user_id AND b.org_id = p.lead_org_id))
  ORDER BY p.id
  LIMIT 1;

  SELECT pj.id INTO v_proj FROM public.projects pj
  WHERE NOT EXISTS (SELECT 1 FROM public.delivery_reviews d WHERE d.project_id = pj.id AND d.partnership_id = v_x7)
  ORDER BY pj.id LIMIT 1;
  SELECT pj.id INTO v_x6 FROM public.projects pj
  WHERE pj.id <> v_proj
    AND NOT EXISTS (SELECT 1 FROM public.delivery_reviews d WHERE d.project_id = pj.id AND d.partnership_id = v_x7)
  ORDER BY pj.id LIMIT 1;
  v_sub := gen_random_uuid();

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

  IF v_x7 IS NULL OR v_uid IS NULL OR v_proj IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 112 YET.  NO SUBJECT: the April Partner Test Agency (organization %) has no partnership with a lead organization that has a separate member, or there is no project to hang a synthetic review on. Nothing was tested. This is not a pass.\n=====================================================\n', coalesce(v_vorg::text, 'NOT FOUND');
  END IF;

  v_pure := NOT EXISTS (SELECT 1 FROM public.org_members m3
                        JOIN public.delivery_reviews d3 ON d3.org_id = m3.org_id
                        WHERE m3.user_id = v_uid);

  SELECT m.user_id, p.lead_org_id INTO v_other_uid, v_other_lead
  FROM public.partnerships p
  JOIN public.org_members m ON m.org_id = p.lead_org_id
  WHERE p.lead_org_id <> v_lead
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id IN (v_lead, v_vorg))
  ORDER BY p.id, m.user_id
  LIMIT 1;

  -- A review the agency member does NOT own, for A6.
  SELECT d.id INTO v_other_sub
  FROM public.delivery_reviews d
  WHERE d.org_id <> v_lead
    AND (v_agency_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_members x
                                             WHERE x.user_id = v_agency_uid AND x.org_id = d.org_id))
  ORDER BY d.id
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
    $q$V3e$q$,
    $q$V3f$q$,
    $q$V4$q$,
    $q$V5$q$,
    $q$V6$q$,
    $q$V7$q$,
    $q$V8$q$,
    $q$V9$q$,
    $q$V10$q$,
    $q$A1$q$,
    $q$A2$q$,
    $q$A3$q$,
    $q$A4$q$,
    $q$A5$q$,
    $q$A6$q$,
    $q$A7$q$,
    $q$A8$q$,
    $q$A9$q$,
    $q$B1$q$,
    $q$B2$q$,
    $q$Z1$q$,
    $q$Z2$q$,
    $q$Z3$q$,
    $q$Z4$q$,
    $q$Z5$q$];

  sc_label := ARRAY[
    $q$V1   vendor: select * on the completed review$q$,
    $q$V2   vendor: reads every vendor-rendered column$q$,
    $q$V3a  vendor: reads legacy on_time_notes$q$,
    $q$V3b  vendor: reads legacy on_budget_notes$q$,
    $q$V3c  vendor: reads legacy client_feedback$q$,
    $q$V3d  vendor: reads legacy ai_delta_summary$q$,
    $q$V3e  vendor: reads legacy would_work_again$q$,
    $q$V3f  vendor: reads legacy budget_variance_pct$q$,
    $q$V4   vendor: reads the table (the review)$q$,
    $q$V5   vendor: reads the table (all rows)$q$,
    $q$V6   vendor: inserts into the table$q$,
    $q$V7   vendor: updates the table$q$,
    $q$V8   vendor: deletes from the table$q$,
    $q$V9   vendor: sets a legacy column on the review$q$,
    $q$V10  vendor: inserts its own review carrying a legacy note$q$,
    $q$A1   agency: select * on the review$q$,
    $q$A2   agency: reads legacy client_feedback$q$,
    $q$A3   agency colleague: reads the table$q$,
    $q$A4   agency colleague: updates the table$q$,
    $q$A5   agency colleague: upserts (the helper's write)$q$,
    $q$A6   agency: private row for a review it does not own$q$,
    $q$A7   agency: a forged org_id does not move the row$q$,
    $q$A8   agency: sets a legacy column on its review$q$,
    $q$A9   agency: edits a vendor-visible field (still works)$q$,
    $q$B1   other agency: reads this agency's row$q$,
    $q$B2   other agency: updates this agency's row$q$,
    $q$Z1   service role: reads the table$q$,
    $q$Z2   service role: upserts the table$q$,
    $q$Z3   anon: reads the table$q$,
    $q$Z4   anon: reads legacy client_feedback$q$,
    $q$Z5   service role: sets a legacy column$q$];

  sc_actor := ARRAY[
    $q$vendor$q$,
    $q$vendor$q$,
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
    $q$vendor_p2$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency$q$,
    $q$agency_x$q$,
    $q$agency$q$,
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
    $q$SELECT count(*)::text FROM (SELECT * FROM public.delivery_reviews WHERE id = %1$L) x$q$,
    $q$SELECT count(*)::text FROM (SELECT id, project_id, composite_score, on_time, on_budget, overall_satisfaction FROM public.delivery_reviews WHERE id = %1$L) x$q$,
    $q$SELECT coalesce((SELECT on_time_notes::text FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT on_budget_notes::text FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT client_feedback::text FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT ai_delta_summary::text FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT would_work_again::text FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT budget_variance_pct::text FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT count(*)::text FROM public.delivery_review_private WHERE review_id = %1$L$q$,
    $q$SELECT count(*)::text FROM public.delivery_review_private$q$,
    $q$WITH i AS (INSERT INTO public.delivery_review_private (review_id, org_id, client_feedback) VALUES (%1$L, %5$L, 'X') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH u AS (UPDATE public.delivery_review_private SET client_feedback = 'X' WHERE review_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH d AS (DELETE FROM public.delivery_review_private WHERE review_id = %1$L RETURNING 1) SELECT count(*)::text FROM d$q$,
    $q$WITH u AS (UPDATE public.delivery_reviews SET client_feedback = 'FORGED' WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH i AS (INSERT INTO public.delivery_reviews (project_id, partnership_id, org_id, status, client_feedback) VALUES (%6$L, %7$L, %5$L, 'complete', 'FORGED') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$SELECT count(*)::text FROM (SELECT * FROM public.delivery_reviews WHERE id = %1$L) x$q$,
    $q$SELECT coalesce((SELECT client_feedback FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$SELECT coalesce((SELECT client_feedback || '/' || would_work_again || '/' || budget_variance_pct::text FROM public.delivery_review_private WHERE review_id = %1$L), 'NULL')$q$,
    $q$WITH u AS (UPDATE public.delivery_review_private SET client_feedback = 'EDITED', would_work_again = 'no' WHERE review_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (INSERT INTO public.delivery_review_private (review_id, on_time_notes) VALUES (%1$L, 'UPSERTED') ON CONFLICT (review_id) DO UPDATE SET on_time_notes = EXCLUDED.on_time_notes RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH i AS (INSERT INTO public.delivery_review_private (review_id, org_id, client_feedback) VALUES (%3$L, %2$L, 'X') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH u AS (INSERT INTO public.delivery_review_private (review_id, org_id, client_feedback) VALUES (%1$L, %5$L, 'X') ON CONFLICT (review_id) DO UPDATE SET client_feedback = EXCLUDED.client_feedback RETURNING org_id) SELECT ((SELECT org_id FROM u) = %2$L::uuid)::text$q$,
    $q$WITH u AS (UPDATE public.delivery_reviews SET client_feedback = 'AGENCY' WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.delivery_reviews SET overall_satisfaction = 9 WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.delivery_review_private WHERE review_id = %1$L$q$,
    $q$WITH u AS (UPDATE public.delivery_review_private SET client_feedback = 'X' WHERE review_id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.delivery_review_private WHERE review_id = %1$L$q$,
    $q$WITH u AS (INSERT INTO public.delivery_review_private (review_id, ai_delta_summary) VALUES (%1$L, 'SERVICE') ON CONFLICT (review_id) DO UPDATE SET ai_delta_summary = EXCLUDED.ai_delta_summary RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.delivery_review_private$q$,
    $q$SELECT coalesce((SELECT client_feedback FROM public.delivery_reviews WHERE id = %1$L), 'NULL')$q$,
    $q$WITH u AS (UPDATE public.delivery_reviews SET ai_delta_summary = 'SERVICE' WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$];

  sc_exp := ARRAY[
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
    $q$OK:likely$q$,
    $q$OK:NULL$q$,
    $q$OK:12.34$q$,
    $q$OK:NULL$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:SENTINEL$q$,
    $q$OK:NULL$q$,
    $q$OK:SENTINEL/likely/12.34$q$,
    $q$OK:SENTINEL/likely/12.34$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$OK:true$q$,
    $q$OK:true$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:0$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$,
    $q$REFUSED:*$q$,
    $q$OK:NULL$q$,
    $q$OK:NULL$q$,
    $q$OK:1$q$,
    $q$REFUSED:*$q$];


  v_n_a := array_length(sc_id, 1);
  IF v_n_a <> 31 OR array_length(sc_label, 1) <> v_n_a OR array_length(sc_actor, 1) <> v_n_a
     OR array_length(sc_sql, 1) <> v_n_a OR array_length(sc_exp, 1) <> v_n_a * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (id %, label %, actor %, sql %, exp %)',
      array_length(sc_id, 1), array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_sql, 1), array_length(sc_exp, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n_a * c_phases]);

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews';

  SELECT relacl::text INTO v_acl_before FROM pg_class WHERE oid = 'public.delivery_reviews'::regclass;

  -- THE DRIFT CASES, BEFORE 112 IS APPLIED (its guard would refuse their setup writes afterwards).
  EXECUTE $u$SELECT count(*) FROM public.delivery_reviews d
  LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
  WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
         OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
    AND NOT (n.review_id IS NOT NULL
             AND ((n.on_time_notes       IS NOT DISTINCT FROM d.on_time_notes
                   AND n.on_budget_notes     IS NOT DISTINCT FROM d.on_budget_notes
                   AND n.client_feedback     IS NOT DISTINCT FROM d.client_feedback
                   AND n.ai_delta_summary    IS NOT DISTINCT FROM d.ai_delta_summary
                   AND n.would_work_again    IS NOT DISTINCT FROM d.would_work_again
                   AND n.budget_variance_pct IS NOT DISTINCT FROM d.budget_variance_pct)
                  OR n.updated_at > n.created_at))$u$ INTO v_live_unacc;

  -- D1  refuses legacy notes with NO table row
  v_ok := NULL; v_detail := '';
  IF v_live_unacc IS NULL OR v_live_unacc <> 0 THEN
    v_detail := format('TEST FAULT: live data already holds %s unaccounted row(s) (run 112''s P1b), so this case cannot be isolated', coalesce(v_live_unacc::text, 'an unmeasured number of'));
  ELSE
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE format($d$INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, status, composite_score, on_time, on_budget, overall_satisfaction) VALUES (%1$L, %3$L, %4$L, %2$L, 'complete', 80, 'yes', 'yes', 8)$d$, v_sub, v_lead, v_proj, v_x7);
    EXECUTE format($d$UPDATE public.delivery_reviews SET client_feedback = 'DRIFT' WHERE id = %L$d$, v_sub);
    EXECUTE $m112_drift$

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION '112 refuses to apply: public.delivery_review_private does not exist. Apply 111 first.'
      USING ERRCODE = 'LG112';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.delivery_reviews d
  LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
  WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
         OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
    AND NOT (n.review_id IS NOT NULL
             AND ((n.on_time_notes       IS NOT DISTINCT FROM d.on_time_notes
                   AND n.on_budget_notes     IS NOT DISTINCT FROM d.on_budget_notes
                   AND n.client_feedback     IS NOT DISTINCT FROM d.client_feedback
                   AND n.ai_delta_summary    IS NOT DISTINCT FROM d.ai_delta_summary
                   AND n.would_work_again    IS NOT DISTINCT FROM d.would_work_again
                   AND n.budget_variance_pct IS NOT DISTINCT FROM d.budget_variance_pct)
                  OR n.updated_at > n.created_at));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '112 refuses to apply: % delivery review(s) hold legacy private values that delivery_review_private does not account for. Nulling would destroy them. See the DRIFT section of this file (P1b lists them).', v_unaccounted
      USING ERRCODE = 'LG112';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.delivery_reviews'::regclass
              AND tgname = 'delivery_reviews_private_columns_guard') THEN
    RAISE EXCEPTION '112 refuses to apply: the guard trigger already exists. Read the schema before going further.'
      USING ERRCODE = 'LG112';
  END IF;
END
$preflight$;

UPDATE public.delivery_reviews
   SET on_time_notes       = NULL,
       on_budget_notes     = NULL,
       client_feedback     = NULL,
       ai_delta_summary    = NULL,
       would_work_again    = NULL,
       budget_variance_pct = NULL
 WHERE on_time_notes IS NOT NULL
    OR on_budget_notes IS NOT NULL
    OR client_feedback IS NOT NULL
    OR ai_delta_summary IS NOT NULL
    OR would_work_again IS NOT NULL
    OR budget_variance_pct IS NOT NULL;

CREATE FUNCTION public.delivery_reviews_private_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.on_time_notes       IS NOT NULL THEN v_set := array_append(v_set, 'on_time_notes'); END IF;
  IF NEW.on_budget_notes     IS NOT NULL THEN v_set := array_append(v_set, 'on_budget_notes'); END IF;
  IF NEW.client_feedback     IS NOT NULL THEN v_set := array_append(v_set, 'client_feedback'); END IF;
  IF NEW.ai_delta_summary    IS NOT NULL THEN v_set := array_append(v_set, 'ai_delta_summary'); END IF;
  IF NEW.would_work_again    IS NOT NULL THEN v_set := array_append(v_set, 'would_work_again'); END IF;
  IF NEW.budget_variance_pct IS NOT NULL THEN v_set := array_append(v_set, 'budget_variance_pct'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a delivery review.'
    USING ERRCODE = 'LG112',
          DETAIL  = format(
            'delivery_reviews.%s must stay null. Since migration 112 the lead agency''s private review fields live in delivery_review_private, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', delivery_reviews.')
          );
END;
$$;

COMMENT ON FUNCTION public.delivery_reviews_private_columns_guard() IS
  'Migration 112. BEFORE INSERT OR UPDATE guard on public.delivery_reviews: on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again and budget_variance_pct must stay NULL, for EVERY caller, because their only home is delivery_review_private (111). Refuses with LG112; never silently nulls.';

CREATE TRIGGER delivery_reviews_private_columns_guard
  BEFORE INSERT OR UPDATE ON public.delivery_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.delivery_reviews_private_columns_guard();

REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM authenticated;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.delivery_reviews
   WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
      OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '112: % review(s) still hold a legacy value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG112';
  END IF;
END
$verify$;


    $m112_drift$;
    v_ok := false;
    v_detail := '112 ran to the end over a value the table does not account for: it would have destroyed it';
    RAISE EXCEPTION 'drift scenario complete' USING ERRCODE = 'LG097';
  EXCEPTION
    WHEN sqlstate 'LG097' THEN NULL;
    WHEN sqlstate 'LG112' THEN
      v_ok := true;
      v_detail := '(raised LG112, as designed)';
    WHEN OTHERS THEN
      v_ok := NULL; v_detail := 'TEST FAULT: raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$D1  refuses legacy notes with NO table row$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$D1  refuses legacy notes with NO table row$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$D1  refuses legacy notes with NO table row$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- D2  refuses legacy notes differing from an untouched row
  v_ok := NULL; v_detail := '';
  IF v_live_unacc IS NULL OR v_live_unacc <> 0 THEN
    v_detail := format('TEST FAULT: live data already holds %s unaccounted row(s) (run 112''s P1b), so this case cannot be isolated', coalesce(v_live_unacc::text, 'an unmeasured number of'));
  ELSE
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE format($d$INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, status, composite_score, on_time, on_budget, overall_satisfaction) VALUES (%1$L, %3$L, %4$L, %2$L, 'complete', 80, 'yes', 'yes', 8)$d$, v_sub, v_lead, v_proj, v_x7);
    EXECUTE format($d$INSERT INTO public.delivery_review_private (review_id, client_feedback) VALUES (%L, 'OTHER')$d$, v_sub);
    EXECUTE format($d$UPDATE public.delivery_reviews SET client_feedback = 'DRIFT' WHERE id = %L$d$, v_sub);
    EXECUTE $m112_drift$

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION '112 refuses to apply: public.delivery_review_private does not exist. Apply 111 first.'
      USING ERRCODE = 'LG112';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.delivery_reviews d
  LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
  WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
         OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
    AND NOT (n.review_id IS NOT NULL
             AND ((n.on_time_notes       IS NOT DISTINCT FROM d.on_time_notes
                   AND n.on_budget_notes     IS NOT DISTINCT FROM d.on_budget_notes
                   AND n.client_feedback     IS NOT DISTINCT FROM d.client_feedback
                   AND n.ai_delta_summary    IS NOT DISTINCT FROM d.ai_delta_summary
                   AND n.would_work_again    IS NOT DISTINCT FROM d.would_work_again
                   AND n.budget_variance_pct IS NOT DISTINCT FROM d.budget_variance_pct)
                  OR n.updated_at > n.created_at));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '112 refuses to apply: % delivery review(s) hold legacy private values that delivery_review_private does not account for. Nulling would destroy them. See the DRIFT section of this file (P1b lists them).', v_unaccounted
      USING ERRCODE = 'LG112';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.delivery_reviews'::regclass
              AND tgname = 'delivery_reviews_private_columns_guard') THEN
    RAISE EXCEPTION '112 refuses to apply: the guard trigger already exists. Read the schema before going further.'
      USING ERRCODE = 'LG112';
  END IF;
END
$preflight$;

UPDATE public.delivery_reviews
   SET on_time_notes       = NULL,
       on_budget_notes     = NULL,
       client_feedback     = NULL,
       ai_delta_summary    = NULL,
       would_work_again    = NULL,
       budget_variance_pct = NULL
 WHERE on_time_notes IS NOT NULL
    OR on_budget_notes IS NOT NULL
    OR client_feedback IS NOT NULL
    OR ai_delta_summary IS NOT NULL
    OR would_work_again IS NOT NULL
    OR budget_variance_pct IS NOT NULL;

CREATE FUNCTION public.delivery_reviews_private_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.on_time_notes       IS NOT NULL THEN v_set := array_append(v_set, 'on_time_notes'); END IF;
  IF NEW.on_budget_notes     IS NOT NULL THEN v_set := array_append(v_set, 'on_budget_notes'); END IF;
  IF NEW.client_feedback     IS NOT NULL THEN v_set := array_append(v_set, 'client_feedback'); END IF;
  IF NEW.ai_delta_summary    IS NOT NULL THEN v_set := array_append(v_set, 'ai_delta_summary'); END IF;
  IF NEW.would_work_again    IS NOT NULL THEN v_set := array_append(v_set, 'would_work_again'); END IF;
  IF NEW.budget_variance_pct IS NOT NULL THEN v_set := array_append(v_set, 'budget_variance_pct'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a delivery review.'
    USING ERRCODE = 'LG112',
          DETAIL  = format(
            'delivery_reviews.%s must stay null. Since migration 112 the lead agency''s private review fields live in delivery_review_private, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', delivery_reviews.')
          );
END;
$$;

COMMENT ON FUNCTION public.delivery_reviews_private_columns_guard() IS
  'Migration 112. BEFORE INSERT OR UPDATE guard on public.delivery_reviews: on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again and budget_variance_pct must stay NULL, for EVERY caller, because their only home is delivery_review_private (111). Refuses with LG112; never silently nulls.';

CREATE TRIGGER delivery_reviews_private_columns_guard
  BEFORE INSERT OR UPDATE ON public.delivery_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.delivery_reviews_private_columns_guard();

REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM authenticated;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.delivery_reviews
   WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
      OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '112: % review(s) still hold a legacy value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG112';
  END IF;
END
$verify$;


    $m112_drift$;
    v_ok := false;
    v_detail := '112 ran to the end over a value the table does not account for: it would have destroyed it';
    RAISE EXCEPTION 'drift scenario complete' USING ERRCODE = 'LG097';
  EXCEPTION
    WHEN sqlstate 'LG097' THEN NULL;
    WHEN sqlstate 'LG112' THEN
      v_ok := true;
      v_detail := '(raised LG112, as designed)';
    WHEN OTHERS THEN
      v_ok := NULL; v_detail := 'TEST FAULT: raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$D2  refuses legacy notes differing from an untouched row$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$D2  refuses legacy notes differing from an untouched row$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$D2  refuses legacy notes differing from an untouched row$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- D3  accepts legacy notes when the row was edited since
  v_ok := NULL; v_detail := '';
  IF v_live_unacc IS NULL OR v_live_unacc <> 0 THEN
    v_detail := format('TEST FAULT: live data already holds %s unaccounted row(s) (run 112''s P1b), so this case cannot be isolated', coalesce(v_live_unacc::text, 'an unmeasured number of'));
  ELSE
  BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',    '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE format($d$INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, status, composite_score, on_time, on_budget, overall_satisfaction) VALUES (%1$L, %3$L, %4$L, %2$L, 'complete', 80, 'yes', 'yes', 8)$d$, v_sub, v_lead, v_proj, v_x7);
    EXECUTE format($d$INSERT INTO public.delivery_review_private (review_id, client_feedback) VALUES (%L, 'OTHER')$d$, v_sub);
    EXECUTE format($d$UPDATE public.delivery_review_private SET client_feedback = 'EDITED' WHERE review_id = %L$d$, v_sub);
    EXECUTE format($d$UPDATE public.delivery_reviews SET client_feedback = 'DRIFT' WHERE id = %L$d$, v_sub);
    EXECUTE $m112_drift$

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION '112 refuses to apply: public.delivery_review_private does not exist. Apply 111 first.'
      USING ERRCODE = 'LG112';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.delivery_reviews d
  LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
  WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
         OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
    AND NOT (n.review_id IS NOT NULL
             AND ((n.on_time_notes       IS NOT DISTINCT FROM d.on_time_notes
                   AND n.on_budget_notes     IS NOT DISTINCT FROM d.on_budget_notes
                   AND n.client_feedback     IS NOT DISTINCT FROM d.client_feedback
                   AND n.ai_delta_summary    IS NOT DISTINCT FROM d.ai_delta_summary
                   AND n.would_work_again    IS NOT DISTINCT FROM d.would_work_again
                   AND n.budget_variance_pct IS NOT DISTINCT FROM d.budget_variance_pct)
                  OR n.updated_at > n.created_at));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '112 refuses to apply: % delivery review(s) hold legacy private values that delivery_review_private does not account for. Nulling would destroy them. See the DRIFT section of this file (P1b lists them).', v_unaccounted
      USING ERRCODE = 'LG112';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.delivery_reviews'::regclass
              AND tgname = 'delivery_reviews_private_columns_guard') THEN
    RAISE EXCEPTION '112 refuses to apply: the guard trigger already exists. Read the schema before going further.'
      USING ERRCODE = 'LG112';
  END IF;
END
$preflight$;

UPDATE public.delivery_reviews
   SET on_time_notes       = NULL,
       on_budget_notes     = NULL,
       client_feedback     = NULL,
       ai_delta_summary    = NULL,
       would_work_again    = NULL,
       budget_variance_pct = NULL
 WHERE on_time_notes IS NOT NULL
    OR on_budget_notes IS NOT NULL
    OR client_feedback IS NOT NULL
    OR ai_delta_summary IS NOT NULL
    OR would_work_again IS NOT NULL
    OR budget_variance_pct IS NOT NULL;

CREATE FUNCTION public.delivery_reviews_private_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.on_time_notes       IS NOT NULL THEN v_set := array_append(v_set, 'on_time_notes'); END IF;
  IF NEW.on_budget_notes     IS NOT NULL THEN v_set := array_append(v_set, 'on_budget_notes'); END IF;
  IF NEW.client_feedback     IS NOT NULL THEN v_set := array_append(v_set, 'client_feedback'); END IF;
  IF NEW.ai_delta_summary    IS NOT NULL THEN v_set := array_append(v_set, 'ai_delta_summary'); END IF;
  IF NEW.would_work_again    IS NOT NULL THEN v_set := array_append(v_set, 'would_work_again'); END IF;
  IF NEW.budget_variance_pct IS NOT NULL THEN v_set := array_append(v_set, 'budget_variance_pct'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a delivery review.'
    USING ERRCODE = 'LG112',
          DETAIL  = format(
            'delivery_reviews.%s must stay null. Since migration 112 the lead agency''s private review fields live in delivery_review_private, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', delivery_reviews.')
          );
END;
$$;

COMMENT ON FUNCTION public.delivery_reviews_private_columns_guard() IS
  'Migration 112. BEFORE INSERT OR UPDATE guard on public.delivery_reviews: on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again and budget_variance_pct must stay NULL, for EVERY caller, because their only home is delivery_review_private (111). Refuses with LG112; never silently nulls.';

CREATE TRIGGER delivery_reviews_private_columns_guard
  BEFORE INSERT OR UPDATE ON public.delivery_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.delivery_reviews_private_columns_guard();

REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM authenticated;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.delivery_reviews
   WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
      OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '112: % review(s) still hold a legacy value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG112';
  END IF;
END
$verify$;


    $m112_drift$;
    v_ok := true;
    v_detail := '(ran to the end, as designed)';
    RAISE EXCEPTION 'drift scenario complete' USING ERRCODE = 'LG097';
  EXCEPTION
    WHEN sqlstate 'LG097' THEN NULL;
    WHEN sqlstate 'LG112' THEN
      v_ok := false;
      v_detail := 'refused (LG112) a difference that is the system working: ' || left(SQLERRM, 160);
    WHEN OTHERS THEN
      v_ok := NULL; v_detail := 'TEST FAULT: raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$D3  accepts legacy notes when the row was edited since$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$D3  accepts legacy notes when the row was edited since$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$D3  accepts legacy notes when the row was edited since$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE. Between phases the migration code is executed
  -- in this same transaction.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.delivery_reviews x), ''));
    v_fpn := '';
    IF to_regclass('public.delivery_review_private') IS NOT NULL THEN
      EXECUTE 'SELECT md5(coalesce(string_agg(x::text, ''|'' ORDER BY x.review_id), '''')) FROM public.delivery_review_private x' INTO v_fpn;
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
              EXECUTE format($s$INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, status, composite_score, on_time, on_budget, overall_satisfaction, on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again, budget_variance_pct) VALUES (%1$L, %3$L, %4$L, %2$L, 'complete', 80, 'yes', 'yes', 8, 'SENTINEL', 'SENTINEL', 'SENTINEL', 'SENTINEL', 'likely', 12.34)$s$, v_sub, v_lead, v_proj, v_x7);
              EXECUTE format($s$INSERT INTO public.delivery_review_private (review_id, org_id, on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again, budget_variance_pct) VALUES (%1$L, %2$L, 'SENTINEL', 'SENTINEL', 'SENTINEL', 'SENTINEL', 'likely', 12.34)$s$, v_sub, v_lead, v_proj, v_x7);
            WHEN 2 THEN
              EXECUTE format($s$INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, status, composite_score, on_time, on_budget, overall_satisfaction) VALUES (%1$L, %3$L, %4$L, %2$L, 'complete', 80, 'yes', 'yes', 8)$s$, v_sub, v_lead, v_proj, v_x7);
              EXECUTE format($s$INSERT INTO public.delivery_review_private (review_id, org_id, on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again, budget_variance_pct) VALUES (%1$L, %2$L, 'SENTINEL', 'SENTINEL', 'SENTINEL', 'SENTINEL', 'likely', 12.34)$s$, v_sub, v_lead, v_proj, v_x7);
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
              WHEN SQLSTATE IN ('42501', 'LG111', 'LG112') THEN 'REFUSED:' || SQLSTATE
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.delivery_reviews x), ''));
      v_fpn := '';
      IF to_regclass('public.delivery_review_private') IS NOT NULL THEN
        EXECUTE 'SELECT md5(coalesce(string_agg(x::text, ''|'' ORDER BY x.review_id), '''')) FROM public.delivery_review_private x' INTO v_fpn;
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
        EXECUTE $m112$

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION '112 refuses to apply: public.delivery_review_private does not exist. Apply 111 first.'
      USING ERRCODE = 'LG112';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.delivery_reviews d
  LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
  WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
         OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
    AND NOT (n.review_id IS NOT NULL
             AND ((n.on_time_notes       IS NOT DISTINCT FROM d.on_time_notes
                   AND n.on_budget_notes     IS NOT DISTINCT FROM d.on_budget_notes
                   AND n.client_feedback     IS NOT DISTINCT FROM d.client_feedback
                   AND n.ai_delta_summary    IS NOT DISTINCT FROM d.ai_delta_summary
                   AND n.would_work_again    IS NOT DISTINCT FROM d.would_work_again
                   AND n.budget_variance_pct IS NOT DISTINCT FROM d.budget_variance_pct)
                  OR n.updated_at > n.created_at));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '112 refuses to apply: % delivery review(s) hold legacy private values that delivery_review_private does not account for. Nulling would destroy them. See the DRIFT section of this file (P1b lists them).', v_unaccounted
      USING ERRCODE = 'LG112';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.delivery_reviews'::regclass
              AND tgname = 'delivery_reviews_private_columns_guard') THEN
    RAISE EXCEPTION '112 refuses to apply: the guard trigger already exists. Read the schema before going further.'
      USING ERRCODE = 'LG112';
  END IF;
END
$preflight$;

UPDATE public.delivery_reviews
   SET on_time_notes       = NULL,
       on_budget_notes     = NULL,
       client_feedback     = NULL,
       ai_delta_summary    = NULL,
       would_work_again    = NULL,
       budget_variance_pct = NULL
 WHERE on_time_notes IS NOT NULL
    OR on_budget_notes IS NOT NULL
    OR client_feedback IS NOT NULL
    OR ai_delta_summary IS NOT NULL
    OR would_work_again IS NOT NULL
    OR budget_variance_pct IS NOT NULL;

CREATE FUNCTION public.delivery_reviews_private_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.on_time_notes       IS NOT NULL THEN v_set := array_append(v_set, 'on_time_notes'); END IF;
  IF NEW.on_budget_notes     IS NOT NULL THEN v_set := array_append(v_set, 'on_budget_notes'); END IF;
  IF NEW.client_feedback     IS NOT NULL THEN v_set := array_append(v_set, 'client_feedback'); END IF;
  IF NEW.ai_delta_summary    IS NOT NULL THEN v_set := array_append(v_set, 'ai_delta_summary'); END IF;
  IF NEW.would_work_again    IS NOT NULL THEN v_set := array_append(v_set, 'would_work_again'); END IF;
  IF NEW.budget_variance_pct IS NOT NULL THEN v_set := array_append(v_set, 'budget_variance_pct'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a delivery review.'
    USING ERRCODE = 'LG112',
          DETAIL  = format(
            'delivery_reviews.%s must stay null. Since migration 112 the lead agency''s private review fields live in delivery_review_private, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', delivery_reviews.')
          );
END;
$$;

COMMENT ON FUNCTION public.delivery_reviews_private_columns_guard() IS
  'Migration 112. BEFORE INSERT OR UPDATE guard on public.delivery_reviews: on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again and budget_variance_pct must stay NULL, for EVERY caller, because their only home is delivery_review_private (111). Refuses with LG112; never silently nulls.';

CREATE TRIGGER delivery_reviews_private_columns_guard
  BEFORE INSERT OR UPDATE ON public.delivery_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.delivery_reviews_private_columns_guard();

REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM authenticated;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.delivery_reviews
   WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
      OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '112: % review(s) still hold a legacy value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG112';
  END IF;
END
$verify$;


        $m112$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ($l$112$l$ || ' raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
    END IF;
  END LOOP;

  RESET ROLE;

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_after
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews';
  SELECT relacl::text INTO v_acl_after FROM pg_class WHERE oid = 'public.delivery_reviews'::regclass;

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
        v_detail := v_detail || format(' [phase %s: %s - %s]', v_k, CASE WHEN v_cls = 'NOSUBJECT' THEN 'NO SUBJECT' ELSE v_cls END, 'says nothing about 112');
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

  v_ok := NULL; v_detail := '';
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(fingerprint %s before, %s after)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on delivery_reviews changed$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on delivery_reviews changed$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S5  no policy on delivery_reviews changed$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on delivery_reviews changed (relacl)$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on delivery_reviews changed (relacl)$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S6  no grant on delivery_reviews changed (relacl)$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  SELECT count(*) INTO v_n_a FROM public.delivery_reviews WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
  v_ok := v_n_a = 0;
  v_detail := format('(%s row(s) still hold one of the columns)', v_n_a);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 112 no delivery_reviews row carries a legacy value$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 112 no delivery_reviews row carries a legacy value$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S7  after 112 no delivery_reviews row carries a legacy value$l$, 60) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  v_ok := NULL; v_detail := '';
  SELECT (t.tgenabled = 'O') AND ((t.tgtype & 2) = 2) AND ((t.tgtype & 4) = 4) AND ((t.tgtype & 16) = 16)
    INTO v_ok
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.delivery_reviews'::regclass AND t.tgname = 'delivery_reviews_private_columns_guard';
  v_ok := coalesce(v_ok, false)
          AND NOT has_function_privilege('anon', 'public.delivery_reviews_private_columns_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.delivery_reviews_private_columns_guard()', 'EXECUTE');
  v_detail := '(enabled, BEFORE, INSERT and UPDATE; EXECUTE revoked from anon and authenticated)';
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S8  112 guard on delivery_reviews: BEFORE INSERT OR UPDATE$l$, 60) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad($l$S8  112 guard on delivery_reviews: BEFORE INSERT OR UPDATE$l$, 60) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad($l$S8  112 guard on delivery_reviews: BEFORE INSERT OR UPDATE$l$, 60) || rpad('FAIL', 14) || v_detail;
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
    v_headline := format('DO NOT APPLY 112.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 112.';
    v_headline := format('SAFE TO APPLY 112.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 112 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 112 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 112.  %s assertion(s) FAILED.', v_fail);
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
    || format(E'isolation check : %s scenario run(s) each compared to the pre-loop fingerprint of delivery_reviews AND delivery_review_private: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT          : vendor org %s (%s), vendor user %s (vendor-only: %s), lead org %s, subject row %s, agency colleague %s, other agency member %s, other row %s\n',
              v_vorg, coalesce(v_vorg_name, '?'), v_uid, v_pure, v_lead, v_sub, coalesce(v_agency_uid::text, 'NONE'), coalesce(v_other_uid::text, 'NONE'), coalesce(v_other_sub::text, 'NONE'))
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE (same subject, same transaction)\n'
    || E'  phase 1 = BEFORE 112 (111 live: the leak window)\n  phase 2 = AFTER 112 (leak closed)\n'
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
