-- =====================================================================
-- 114 PRE-APPLY TEST. ONE PASTE. APPLIES 114, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-09 on fix/agency-gate-and-leaks. NOT RUN: THERE IS NO LOCAL POSTGRES AND NO
-- CREDENTIALS HERE. Expect to fix a typo on the first run. OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code (between $m114$ markers) is copied from 114_hardening.sql, the body
-- between its BEGIN; (line 93) and COMMIT; (line 305). If you edit the migration, re-copy it.
--
-- WHAT 114 MUST SHOW
--   D1-D4  a vendor cannot insert a delivery review or a score for an agency's partnership; the
--          agency still can.
--   M1-M2  the same for msa_agreements.   T1-T2  the same for rfp_magic_tokens.
--   G1-G3  anon and authenticated lose TRUNCATE / REFERENCES / TRIGGER on a sample of tables and
--          keep SELECT / INSERT / UPDATE / DELETE.
--   S3     the default privileges changed, or the migration reported that it could not change them.
--   H1-H3  anon cannot execute the six helpers (except any 114 reports as used by an anon/PUBLIC
--          policy); authenticated still can.
--   L1-L3  the reliability guard refuses a non-null write, from the agency and from the service role
--          (110's shape: every caller), and the service role still writes partnerships otherwise.
--
-- PHASES: 1 BEFORE 114, 2 AFTER 114. Every assertion runs in every phase. Phase-1 mismatch is
-- INCONCLUSIVE (premise wrong), phase-2 mismatch is FAIL. NO SUBJECT is INCONCLUSIVE, never PASS.
--
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT. <<<
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
-- FIRST LINE: "SAFE TO APPLY 114." / "DO NOT APPLY 114 YET." / "DO NOT APPLY 114."
--
-- SUBJECTS: the vendor is a member of the April Partner Test Agency (gmarkant@icloud.com where
-- possible); the agency is a member of the lead organization of one of that vendor's partnerships
-- (gmarkant@gmail.com / m a r k a n t where possible) and not of the vendor's organization. The
-- project is a project of that lead organization (preferring one the partnership was invited to).
-- m a r k a n t is the only lead organization with members, so no cross-agency scenario is attempted.
-- IMPERSONATION and ISOLATION exactly as 110: request.jwt.claims + SET LOCAL ROLE, read back
-- (LG098 on mismatch); each scenario ends in LG097; a fingerprint of delivery_reviews,
-- delivery_review_scores, msa_agreements, rfp_magic_tokens and partnerships is compared after each.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * msa_agreements accepts (org_id, partnership_id) with every other column defaulted, and has no
--     unique constraint the M1/M2 inserts would hit. If it does, M1/M2 report ERR (INCONCLUSIVE).
--   * jsonb_populate_record over a copied rfp_magic_tokens row with id, token, vendor_email,
--     org_id and project_id replaced inserts cleanly (110's S9/S10 used the same technique).
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 20;
  c_phases       CONSTANT integer := 2;
  v_vorg         uuid;
  v_vorg_name    text;
  v_vendor       uuid;
  v_agency       uuid;
  v_lead         uuid;
  v_pship        uuid;
  v_proj         uuid;
  v_crit         uuid;
  v_forged       uuid := gen_random_uuid();
  v_own          uuid := gen_random_uuid();
  v_tok_src      jsonb;
  v_tok_vendor   text;
  v_tok_agency   text;
  v_kept         integer;
  v_kept_org_ids boolean;
  v_vendor_claims text;
  v_agency_claims text;
  v_txt          text;
  v_actor        text;
  v_ph           integer;
  v_i            integer;
  v_k            integer;
  v_idx          integer;
  v_n            integer;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_using_before text;
  v_using_after  text;
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
  v_same         boolean;
  v_defacl_left  text;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_setup  text[];
  sc_sql    text[];
  sc_exp    text[];
  r_cls     text[];
BEGIN
  ---------------------------------------------------------------------
  -- SUBJECTS
  ---------------------------------------------------------------------
  SELECT o.id INTO v_vorg FROM public.organizations o
   WHERE lower(btrim(o.name)) = 'april partner test agency' ORDER BY o.id LIMIT 1;
  IF v_vorg IS NULL THEN
    SELECT m.org_id INTO v_vorg FROM public.org_members m JOIN public.profiles pr ON pr.id = m.user_id
     WHERE lower(btrim(pr.email)) = 'gmarkant@icloud.com'
       AND EXISTS (SELECT 1 FROM public.partnerships p WHERE p.vendor_org_id = m.org_id)
     ORDER BY m.org_id LIMIT 1;
  END IF;
  SELECT o.name INTO v_vorg_name FROM public.organizations o WHERE o.id = v_vorg;

  SELECT p.id, p.lead_org_id INTO v_pship, v_lead
  FROM public.partnerships p
  WHERE p.vendor_org_id = v_vorg AND p.lead_org_id IS NOT NULL AND p.lead_org_id <> v_vorg
    AND EXISTS (SELECT 1 FROM public.org_members a WHERE a.org_id = p.lead_org_id
                  AND NOT EXISTS (SELECT 1 FROM public.org_members b WHERE b.user_id = a.user_id AND b.org_id = v_vorg))
  ORDER BY EXISTS (SELECT 1 FROM public.org_members a JOIN public.profiles pr ON pr.id = a.user_id
                    WHERE a.org_id = p.lead_org_id AND lower(btrim(pr.email)) = 'gmarkant@gmail.com') DESC, p.id
  LIMIT 1;

  SELECT m.user_id INTO v_vendor
  FROM public.org_members m LEFT JOIN public.profiles pr ON pr.id = m.user_id
  WHERE m.org_id = v_vorg
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id = v_lead)
  ORDER BY (lower(btrim(coalesce(pr.email, ''))) = 'gmarkant@icloud.com') DESC, m.user_id LIMIT 1;

  SELECT m.user_id INTO v_agency
  FROM public.org_members m LEFT JOIN public.profiles pr ON pr.id = m.user_id
  WHERE m.org_id = v_lead
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id = v_vorg)
  ORDER BY (lower(btrim(coalesce(pr.email, ''))) = 'gmarkant@gmail.com') DESC, m.user_id LIMIT 1;

  SELECT pr.id INTO v_proj FROM public.projects pr
   WHERE pr.org_id = v_lead
   ORDER BY EXISTS (SELECT 1 FROM public.partner_rfp_inbox i WHERE i.project_id = pr.id AND i.partnership_id = v_pship) DESC,
            pr.created_at DESC NULLS LAST, pr.id
   LIMIT 1;

  SELECT c.id INTO v_crit FROM public.bid_scoring_criteria c ORDER BY c.id LIMIT 1;

  SELECT to_jsonb(t) INTO v_tok_src FROM public.rfp_magic_tokens t
   WHERE t.org_id = v_lead ORDER BY t.created_at DESC NULLS LAST, t.id LIMIT 1;
  IF v_tok_src IS NOT NULL THEN
    v_tok_vendor := (v_tok_src || jsonb_build_object(
      'id', gen_random_uuid(), 'org_id', v_vorg, 'project_id', v_proj, 'response_id', NULL,
      'token', md5(random()::text) || md5(random()::text), 'vendor_email', 'probe-114-vendor@example.invalid'))::text;
    v_tok_agency := (v_tok_src || jsonb_build_object(
      'id', gen_random_uuid(), 'org_id', v_lead, 'project_id', v_proj, 'response_id', NULL,
      'token', md5(random()::text) || md5(random()::text), 'vendor_email', 'probe-114-agency@example.invalid'))::text;
  END IF;

  IF v_vendor IS NULL OR v_agency IS NULL OR v_pship IS NULL OR v_proj IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 114 YET.  NO SUBJECT: vendor %, agency %, partnership %, project %. Nothing was tested. This is not a pass.\n=====================================================\n',
      coalesce(v_vendor::text, 'NONE'), coalesce(v_agency::text, 'NONE'), coalesce(v_pship::text, 'NONE'), coalesce(v_proj::text, 'NONE');
  END IF;

  -- The helpers 114 will KEEP for anon (named by an anon/PUBLIC policy), computed as 114 computes it.
  SELECT count(*) INTO v_kept FROM unnest(ARRAY[
    'current_user_org_ids', 'current_user_admin_org_ids', 'current_user_counterparty_org_ids',
    'current_user_visible_profile_ids', 'current_user_active_counterparty_user_ids',
    'current_user_commercial_counterparty_org_ids']) f
   WHERE to_regprocedure('public.' || f || '()') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND roles && ARRAY['public', 'anon']::name[]
                  AND position(f || '(' IN coalesce(qual, '') || ' ' || coalesce(with_check, '')) > 0);
  v_kept_org_ids := EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND roles && ARRAY['public', 'anon']::name[]
                  AND position('current_user_org_ids(' IN coalesce(qual, '') || ' ' || coalesce(with_check, '')) > 0);

  v_vendor_claims := json_build_object('sub', v_vendor::text, 'role', 'authenticated')::text;
  v_agency_claims := json_build_object('sub', v_agency::text, 'role', 'authenticated')::text;

  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  -- format() args: %1$L vendor, %2$L agency, %3$L lead org, %4$L vendor org, %5$L partnership,
  -- %6$L project, %7$L criterion, %8$L forged review id, %9$L agency review id,
  -- %10$L vendor token json, %11$L agency token json.
  sc_id := ARRAY['D1','D2','D3','D4','M1','M2','T1','T2','G1','G2','G3','H1','H2','H3','L1','L2','L3'];

  sc_label := ARRAY[
    $l$D1  vendor: inserts a delivery review on the agency's partnership$l$,
    $l$D2  agency: inserts its delivery review (still works)$l$,
    $l$D3  vendor: inserts a score on its forged review$l$,
    $l$D4  agency: inserts a score on its own review (still works)$l$,
    $l$M1  vendor: inserts an MSA row naming the agency's partnership$l$,
    $l$M2  agency: inserts an MSA row for its partnership (still works)$l$,
    $l$T1  vendor: inserts a magic token naming the agency's project$l$,
    $l$T2  agency: inserts a magic token for its project (still works)$l$,
    $l$G1  anon holds TRUNCATE/REFERENCES/TRIGGER on the sample$l$,
    $l$G2  authenticated holds TRUNCATE/REFERENCES/TRIGGER on the sample$l$,
    $l$G3  authenticated keeps SELECT/INSERT/UPDATE/DELETE on the sample$l$,
    $l$H1  anon: how many of the six helpers it may execute$l$,
    $l$H2  authenticated: how many of the six helpers it may execute$l$,
    $l$H3  anon: calls current_user_org_ids()$l$,
    $l$L1  service role: sets partnerships.reliability_summary$l$,
    $l$L2  agency: sets partnerships.reliability_summary$l$,
    $l$L3  service role: an ordinary partnerships write still works$l$];

  sc_actor := ARRAY['vendor','agency','vendor','agency','vendor','agency','vendor','agency',
                    'owner','owner','owner','owner','owner','anon','service','agency','service'];

  sc_setup := ARRAY[
    $s$DELETE FROM public.delivery_reviews WHERE project_id = %6$L AND partnership_id = %5$L$s$,
    $s$DELETE FROM public.delivery_reviews WHERE project_id = %6$L AND partnership_id = %5$L$s$,
    $s$DELETE FROM public.delivery_reviews WHERE project_id = %6$L AND partnership_id = %5$L; INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, status) VALUES (%8$L, %6$L, %5$L, %4$L, 'complete')$s$,
    $s$DELETE FROM public.delivery_reviews WHERE project_id = %6$L AND partnership_id = %5$L; INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, status) VALUES (%9$L, %6$L, %5$L, %3$L, 'draft')$s$,
    '', '', '', '',
    '', '', '', '', '', '',
    '', '', ''];

  sc_sql := ARRAY[
    $q$WITH i AS (INSERT INTO public.delivery_reviews (project_id, partnership_id, org_id, status) VALUES (%6$L, %5$L, %4$L, 'complete') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.delivery_reviews (project_id, partnership_id, org_id, status) VALUES (%6$L, %5$L, %3$L, 'draft') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.delivery_review_scores (review_id, criterion_id, score) VALUES (%8$L, %7$L, 5) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.delivery_review_scores (review_id, criterion_id, score) VALUES (%9$L, %7$L, 5) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.msa_agreements (org_id, partnership_id) VALUES (%4$L, %5$L) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.msa_agreements (org_id, partnership_id) VALUES (%3$L, %5$L) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.rfp_magic_tokens SELECT (jsonb_populate_record(NULL::public.rfp_magic_tokens, %10$L::jsonb)).* RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.rfp_magic_tokens SELECT (jsonb_populate_record(NULL::public.rfp_magic_tokens, %11$L::jsonb)).* RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$SELECT bool_or(has_table_privilege('anon', ('public.' || t)::regclass, 'TRUNCATE') OR has_table_privilege('anon', ('public.' || t)::regclass, 'REFERENCES') OR has_table_privilege('anon', ('public.' || t)::regclass, 'TRIGGER'))::text FROM unnest(ARRAY['delivery_reviews','partnerships','profiles','organizations','rfp_magic_tokens','partner_rfp_inbox']) t$q$,
    $q$SELECT bool_or(has_table_privilege('authenticated', ('public.' || t)::regclass, 'TRUNCATE') OR has_table_privilege('authenticated', ('public.' || t)::regclass, 'REFERENCES') OR has_table_privilege('authenticated', ('public.' || t)::regclass, 'TRIGGER'))::text FROM unnest(ARRAY['delivery_reviews','partnerships','profiles','organizations','rfp_magic_tokens','partner_rfp_inbox']) t$q$,
    $q$SELECT bool_and(has_table_privilege('authenticated', ('public.' || t)::regclass, 'SELECT') AND has_table_privilege('authenticated', ('public.' || t)::regclass, 'INSERT') AND has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE') AND has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'))::text FROM unnest(ARRAY['delivery_reviews','partnerships','profiles','organizations','rfp_magic_tokens','partner_rfp_inbox']) t$q$,
    $q$SELECT count(*)::text FROM unnest(ARRAY['current_user_org_ids','current_user_admin_org_ids','current_user_counterparty_org_ids','current_user_visible_profile_ids','current_user_active_counterparty_user_ids','current_user_commercial_counterparty_org_ids']) f WHERE to_regprocedure('public.' || f || '()') IS NOT NULL AND has_function_privilege('anon', to_regprocedure('public.' || f || '()'), 'EXECUTE')$q$,
    $q$SELECT count(*)::text FROM unnest(ARRAY['current_user_org_ids','current_user_admin_org_ids','current_user_counterparty_org_ids','current_user_visible_profile_ids','current_user_active_counterparty_user_ids','current_user_commercial_counterparty_org_ids']) f WHERE to_regprocedure('public.' || f || '()') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.' || f || '()'), 'EXECUTE')$q$,
    $q$SELECT count(*)::text FROM public.current_user_org_ids()$q$,
    $q$WITH u AS (UPDATE public.partnerships SET reliability_summary = 'PROBE 114' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partnerships SET reliability_summary = 'PROBE 114' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partnerships SET updated_at = updated_at WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$];

  sc_exp := ARRAY[
    'OK:1', 'REFUSED:42501',            -- D1
    'OK:1', 'OK:1',                     -- D2
    'OK:1', 'REFUSED:42501',            -- D3
    'OK:1', 'OK:1',                     -- D4
    'OK:1', 'REFUSED:42501',            -- M1
    'OK:1', 'OK:1',                     -- M2
    'OK:1', 'REFUSED:42501',            -- T1
    'OK:1', 'OK:1',                     -- T2
    'OK:true', 'OK:false',              -- G1
    'OK:true', 'OK:false',              -- G2
    'OK:true', 'OK:true',               -- G3
    'OK:6', 'OK:' || v_kept,            -- H1
    'OK:6', 'OK:6',                     -- H2
    'OK:0', CASE WHEN v_kept_org_ids THEN 'OK:0' ELSE 'REFUSED:42501' END,  -- H3
    'OK:1', 'REFUSED:LG114',            -- L1
    'OK:1', 'REFUSED:LG114',            -- L2
    'OK:1', 'OK:1'];                    -- L3

  v_n := array_length(sc_id, 1);
  IF v_n <> 17 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_setup, 1) <> v_n OR array_length(sc_sql, 1) <> v_n
     OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length';
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || coalesce(qual, ''), E'\n' ORDER BY tablename, policyname), ''))
    INTO v_using_before
  FROM pg_policies WHERE schemaname = 'public'
   AND policyname IN ('Agencies manage own delivery reviews', 'Agencies manage own delivery review scores',
                      'Agency can manage their MSAs', 'Agency can manage their own tokens');

  ---------------------------------------------------------------------
  -- THE LOOP
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.delivery_reviews x), ''))
          || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.delivery_review_scores x), ''))
          || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.msa_agreements x), ''))
          || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.rfp_magic_tokens x), ''))
          || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), ''));

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];

      IF (sc_id[v_i] IN ('D3', 'D4') AND v_crit IS NULL)
         OR (sc_id[v_i] IN ('T1', 'T2') AND v_tok_src IS NULL) THEN
        r_cls[v_idx] := 'NOSUBJECT';
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          IF sc_setup[v_i] <> '' THEN
            EXECUTE format(sc_setup[v_i], v_vendor, v_agency, v_lead, v_vorg, v_pship, v_proj, v_crit, v_forged, v_own, v_tok_vendor, v_tok_agency);
          END IF;

          IF v_actor = 'vendor' THEN
            PERFORM set_config('request.jwt.claims',    v_vendor_claims, true);
            PERFORM set_config('request.jwt.claim.sub', v_vendor::text,  true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_vendor THEN
              RAISE EXCEPTION 'impersonation mismatch (vendor): auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'agency' THEN
            PERFORM set_config('request.jwt.claims',    v_agency_claims, true);
            PERFORM set_config('request.jwt.claim.sub', v_agency::text,  true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_agency THEN
              RAISE EXCEPTION 'impersonation mismatch (agency): auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'service' THEN
            SET LOCAL ROLE service_role;
            IF current_user <> 'service_role' OR auth.uid() IS NOT NULL THEN
              RAISE EXCEPTION 'impersonation mismatch (service): current_user is %', current_user USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'anon' THEN
            SET LOCAL ROLE anon;
            IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
              RAISE EXCEPTION 'impersonation mismatch (anon): current_user is %', current_user USING ERRCODE = 'LG098';
            END IF;
          END IF;

          EXECUTE format(sc_sql[v_i], v_vendor, v_agency, v_lead, v_vorg, v_pship, v_proj, v_crit, v_forged, v_own, v_tok_vendor, v_tok_agency) INTO v_txt;
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);

          r_cls[v_idx] := 'OK:' || coalesce(v_txt, 'NULL');
          RAISE EXCEPTION 'scenario % complete: undoing its writes', sc_id[v_i] USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN NULL;
          WHEN OTHERS THEN
            r_cls[v_idx] := CASE
              WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
              WHEN SQLSTATE IN ('42501', 'LG114') THEN 'REFUSED:' || SQLSTATE
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.delivery_reviews x), ''))
           || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.delivery_review_scores x), ''))
           || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.msa_agreements x), ''))
           || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.rfp_magic_tokens x), ''))
           || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), ''));
      v_iso_runs := v_iso_runs + 1;
      IF v_fp IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc_id[v_i] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;

    IF v_ph = 1 THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      BEGIN
        EXECUTE $m114$

DO $preflight$
DECLARE
  v_bad bigint;
  v_pol text;
BEGIN
  FOREACH v_pol IN ARRAY ARRAY[
    'delivery_reviews|Agencies manage own delivery reviews',
    'delivery_review_scores|Agencies manage own delivery review scores',
    'msa_agreements|Agency can manage their MSAs',
    'rfp_magic_tokens|Agency can manage their own tokens'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = split_part(v_pol, '|', 1) AND policyname = split_part(v_pol, '|', 2)
                    AND cmd = 'ALL') THEN
      RAISE EXCEPTION '114 refuses to apply: policy "%" on % is missing or is not FOR ALL.', split_part(v_pol, '|', 2), split_part(v_pol, '|', 1)
        USING ERRCODE = 'LG114';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_bad FROM (
    SELECT r.id FROM public.delivery_reviews r
      LEFT JOIN public.partnerships p ON p.id = r.partnership_id
      LEFT JOIN public.projects pr ON pr.id = r.project_id
     WHERE p.lead_org_id IS DISTINCT FROM r.org_id OR pr.org_id IS DISTINCT FROM r.org_id
    UNION ALL
    SELECT m.id FROM public.msa_agreements m
      LEFT JOIN public.partnerships p ON p.id = m.partnership_id
     WHERE m.partnership_id IS NOT NULL AND p.lead_org_id IS DISTINCT FROM m.org_id
    UNION ALL
    SELECT t.id FROM public.rfp_magic_tokens t
      LEFT JOIN public.projects pr ON pr.id = t.project_id
     WHERE t.project_id IS NOT NULL AND pr.org_id IS DISTINCT FROM t.org_id) x;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '114 refuses to apply: % existing row(s) name a partnership or project of another organization (P1 lists them). Read them first; the next UPDATE of each would be refused.', v_bad
      USING ERRCODE = 'LG114';
  END IF;

  SELECT count(*) INTO v_bad FROM public.partnerships
   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '114 refuses to apply: % partnership(s) hold a legacy reliability value again (108 nulled them). Find the writer first.', v_bad
      USING ERRCODE = 'LG114';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partnerships'::regclass
              AND tgname = 'partnerships_reliability_columns_guard') THEN
    RAISE EXCEPTION '114 refuses to apply: partnerships_reliability_columns_guard already exists.'
      USING ERRCODE = 'LG114';
  END IF;
END
$preflight$;

-- 1. WITH CHECK. USING untouched. The subqueries run under the caller's RLS: an agency reads its
--    own partnerships and projects; a vendor reads the partnership but fails lead_org_id = org_id.
ALTER POLICY "Agencies manage own delivery reviews" ON public.delivery_reviews
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND EXISTS (SELECT 1 FROM public.partnerships p
                 WHERE p.id = delivery_reviews.partnership_id
                   AND p.lead_org_id = delivery_reviews.org_id)
    AND EXISTS (SELECT 1 FROM public.projects pr
                 WHERE pr.id = delivery_reviews.project_id
                   AND pr.org_id = delivery_reviews.org_id)
  );

ALTER POLICY "Agencies manage own delivery review scores" ON public.delivery_review_scores
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.delivery_reviews r
     WHERE r.id = delivery_review_scores.review_id
       AND r.org_id IN (SELECT public.current_user_org_ids())
       AND EXISTS (SELECT 1 FROM public.partnerships p
                    WHERE p.id = r.partnership_id AND p.lead_org_id = r.org_id)
       AND EXISTS (SELECT 1 FROM public.projects pr
                    WHERE pr.id = r.project_id AND pr.org_id = r.org_id)));

ALTER POLICY "Agency can manage their MSAs" ON public.msa_agreements
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND (partnership_id IS NULL
         OR EXISTS (SELECT 1 FROM public.partnerships p
                     WHERE p.id = msa_agreements.partnership_id
                       AND p.lead_org_id = msa_agreements.org_id))
  );

ALTER POLICY "Agency can manage their own tokens" ON public.rfp_magic_tokens
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND (project_id IS NULL
         OR EXISTS (SELECT 1 FROM public.projects pr
                     WHERE pr.id = rfp_magic_tokens.project_id
                       AND pr.org_id = rfp_magic_tokens.org_id))
  );

-- 2. TRUNCATE / REFERENCES / TRIGGER off every existing public table for anon and authenticated.
DO $grants$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, authenticated', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '114: revoked TRUNCATE, REFERENCES, TRIGGER from anon and authenticated on % public table(s)', n;
END
$grants$;

-- 3. FUTURE tables. Every role that owns a public table; reported, not failed, when not permitted.
DO $defaults$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner
             FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated', r.owner);
      RAISE NOTICE '114: default privileges of role % in schema public no longer grant TRUNCATE, REFERENCES, TRIGGER to anon, authenticated', r.owner;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE '114: REPORTED, NOT CHANGED: cannot alter default privileges of role % (%). Run the same statement as that role.', r.owner, SQLERRM;
    END;
  END LOOP;
END
$defaults$;

-- 4. The six helpers: EXECUTE off anon (and PUBLIC), explicitly kept for authenticated.
DO $helpers$
DECLARE
  f        text;
  v_sig    regprocedure;
  v_users  text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'current_user_org_ids', 'current_user_admin_org_ids', 'current_user_counterparty_org_ids',
    'current_user_visible_profile_ids', 'current_user_active_counterparty_user_ids',
    'current_user_commercial_counterparty_org_ids'] LOOP
    v_sig := to_regprocedure('public.' || f || '()');
    IF v_sig IS NULL THEN
      RAISE NOTICE '114: public.%() does not exist; skipped', f;
      CONTINUE;
    END IF;
    SELECT string_agg(tablename || '."' || policyname || '"', ', ') INTO v_users
      FROM pg_policies
     WHERE schemaname = 'public'
       AND roles && ARRAY['public', 'anon']::name[]
       AND position(f || '(' IN coalesce(qual, '') || ' ' || coalesce(with_check, '')) > 0;
    IF v_users IS NOT NULL THEN
      RAISE NOTICE '114: REPORTED, NOT CHANGED: anon keeps EXECUTE on %() because a policy for anon/PUBLIC calls it: %', f, v_users;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_sig);
  END LOOP;
END
$helpers$;

-- 5. partnerships.reliability_summary / reliability_summary_generated_at stay null. 110's shape.
CREATE FUNCTION public.partnerships_reliability_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.reliability_summary              IS NOT NULL THEN v_set := array_append(v_set, 'reliability_summary'); END IF;
  IF NEW.reliability_summary_generated_at IS NOT NULL THEN v_set := array_append(v_set, 'reliability_summary_generated_at'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a partnership.'
    USING ERRCODE = 'LG114',
          DETAIL  = format(
            'partnerships.%s must stay null. Since migrations 107/108 the agency''s reliability summary lives in partnership_private_reliability, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', partnerships.')
          );
END;
$$;

COMMENT ON FUNCTION public.partnerships_reliability_columns_guard() IS
  'Migration 114. BEFORE INSERT OR UPDATE guard on public.partnerships: reliability_summary and reliability_summary_generated_at must stay NULL for EVERY caller (108 nulled them; their home is partnership_private_reliability, 107). Refuses with LG114; never silently nulls. 110''s shape.';

CREATE TRIGGER partnerships_reliability_columns_guard
  BEFORE INSERT OR UPDATE ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.partnerships_reliability_columns_guard();

REVOKE EXECUTE ON FUNCTION public.partnerships_reliability_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partnerships_reliability_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partnerships_reliability_columns_guard() FROM authenticated;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
       AND policyname IN ('Agencies manage own delivery reviews', 'Agencies manage own delivery review scores',
                          'Agency can manage their MSAs', 'Agency can manage their own tokens')
       AND (with_check ILIKE '%lead_org_id%' OR with_check ILIKE '%projects%')) <> 4 THEN
    RAISE EXCEPTION '114: a rewritten WITH CHECK did not land. Nothing was committed.' USING ERRCODE = 'LG114';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
                AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))) THEN
    RAISE NOTICE '114: some public table still grants TRUNCATE to anon or authenticated (possibly through PUBLIC or a table this role does not own). Read V2.';
  END IF;
END
$verify$;

        $m114$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('114 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
    END IF;
  END LOOP;

  RESET ROLE;

  SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || coalesce(qual, ''), E'\n' ORDER BY tablename, policyname), ''))
    INTO v_using_after
  FROM pg_policies WHERE schemaname = 'public'
   AND policyname IN ('Agencies manage own delivery reviews', 'Agencies manage own delivery review scores',
                      'Agency can manage their MSAs', 'Agency can manage their own tokens');

  ---------------------------------------------------------------------
  -- JUDGEMENT (110's rules)
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
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
        v_detail := v_detail || format(' [phase %s: %s]', v_k, CASE WHEN v_cls = 'NOSUBJECT' THEN 'NO SUBJECT' ELSE v_cls END);
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
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 66) || rpad(v_st, 14) || v_detail;
  END LOOP;

  -- S1. USING unchanged on the four policies.
  v_ok := v_using_before IS NOT DISTINCT FROM v_using_after;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S1  USING unchanged on the four rewritten policies', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S1  USING unchanged on the four rewritten policies', 66) || rpad('FAIL', 14) || format('(%s -> %s)', v_using_before, v_using_after); END IF;

  -- S2. The reliability guard: enabled, BEFORE, INSERT and UPDATE, EXECUTE revoked.
  SELECT (t.tgenabled = 'O') AND ((t.tgtype & 2) = 2) AND ((t.tgtype & 4) = 4) AND ((t.tgtype & 16) = 16) INTO v_ok
  FROM pg_trigger t WHERE t.tgrelid = 'public.partnerships'::regclass AND t.tgname = 'partnerships_reliability_columns_guard';
  v_ok := coalesce(v_ok, false)
          AND NOT has_function_privilege('anon', 'public.partnerships_reliability_columns_guard()', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.partnerships_reliability_columns_guard()', 'EXECUTE');
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S2  reliability guard: BEFORE INSERT OR UPDATE, EXECUTE revoked', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S2  reliability guard: BEFORE INSERT OR UPDATE, EXECUTE revoked', 66) || rpad('FAIL', 14); END IF;

  -- S3. Default privileges for every table-owning role: no anon/authenticated D, x or t left.
  SELECT string_agg(DISTINCT pg_get_userbyid(d.defaclrole) || ':' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ', ')
    INTO v_defacl_left
  FROM pg_default_acl d
  JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE ns.nspname = 'public' AND d.defaclobjtype = 'r'
    AND a.grantee IN ('anon'::regrole::oid, 'authenticated'::regrole::oid)
    AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    AND d.defaclrole IN (SELECT DISTINCT c.relowner FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace
                          WHERE n2.nspname = 'public' AND c.relkind IN ('r', 'p'));
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_defacl_left IS NULL THEN
    v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S3  default privileges no longer grant D/x/t to anon/authenticated', 66) || rpad('PASS', 14);
  ELSE
    v_inconc := v_inconc + 1; v_lines := v_lines || E'\n  ' || rpad('S3  default privileges no longer grant D/x/t to anon/authenticated', 66) || rpad('INCONCLUSIVE', 14) || '(REPORTED, as the brief allows: still granted ' || v_defacl_left || '; read the NOTICE 114 raised and run its statement as that role)';
  END IF;

  IF array_length(v_apply_err, 1) IS NOT NULL THEN
    v_fail := v_fail + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 66) || rpad('FAIL', 14) || array_to_string(v_apply_err, ' | ');
  ELSE
    v_pass := v_pass + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 66) || rpad('PASS', 14);
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;

  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected + 1 OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 114.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 114.';
    v_headline := format('SAFE TO APPLY 114.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 114 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 114 does what it claims.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 114.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0; NO SUBJECT counts here)\n', v_inconc)
    || format(E'isolation check : %s scenario run(s) compared to the pre-phase fingerprint of delivery_reviews, delivery_review_scores, msa_agreements, rfp_magic_tokens, partnerships: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT         : vendor org %s (%s), vendor %s, lead org %s, agency %s, partnership %s, project %s, criterion %s, token source %s, helpers 114 keeps for anon %s\n',
              v_vorg, coalesce(v_vorg_name, '?'), v_vendor, v_lead, v_agency, v_pship, v_proj,
              coalesce(v_crit::text, 'NONE'), CASE WHEN v_tok_src IS NULL THEN 'NONE' ELSE 'found' END, v_kept)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 114\n  phase 2 = AFTER 114\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

ROLLBACK;
