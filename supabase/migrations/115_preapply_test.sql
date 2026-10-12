-- =====================================================================
-- 115 PRE-APPLY TEST. ONE PASTE. APPLIES 115, READS, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-12 on fix/guest-profiles-records. NOT RUN: THERE IS NO LOCAL POSTGRES AND NO
-- CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain error, not in
-- "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code below (between $m115$ markers) is 115_discoverable_profiles.sql,
-- lines 96-202 (the body between BEGIN; and COMMIT;). If you edit the migration, re-copy it here.
--
-- WHAT 115 MUST SHOW: a signed-in STRANGER (not the owner, not a colleague, not a live
-- counterparty) can no longer read a discoverable vendor's row at all, so none of its legal,
-- billing, rate, terms or authority fields; the stranger CAN call discoverable_profiles() and gets
-- exactly the public key set; the owner and a counterparty still read what they read today; anon
-- reads nothing and cannot call the function; no other policy and no grant on profiles changed.
--
-- PHASES: phase 1 BEFORE 115 (the defect: the stranger reads the whole row, the function is
-- missing), phase 2 AFTER 115. EVERY ASSERTION RUNS IN EVERY PHASE. A phase-1 mismatch is
-- INCONCLUSIVE (the premise is wrong), never PASS; a phase-2 mismatch is FAIL.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch.
--   3. READ THE ERROR MESSAGE. That is where the result is.
--
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT. <<<
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- READ THE FIRST LINE:
--     "SAFE TO APPLY 115."       -> and only this.
--     "DO NOT APPLY 115 YET."    -> INCONCLUSIVE or NO SUBJECT. Not a green light.
--     "DO NOT APPLY 115."        -> an assertion FAILED, or the test is broken.
-- Rows read PASS, FAIL, INCONCLUSIVE, NOT DISCRIMINATING (same expectation in both phases, reported as
-- PASS with that note) or NO SUBJECT (reported as INCONCLUSIVE, never PASS).
--
-- THIS FILE DEFINES NO FUNCTION IN pg_temp AND NO TEMP TABLE. IT WRITES NOTHING; the isolation
-- fingerprint still proves no scenario changed profiles or organizations.
--
-- =====================================================================
-- THE SUBJECTS
-- =====================================================================
-- disc     : a profile with is_discoverable = true, preferring a VENDOR (role 'partner' or a member
--            of an is_vendor organization). Its own session is the OWNER actor.
-- stranger : an authenticated user who is not disc and for whom disc is NOT in
--            current_user_visible_profile_ids() (checked by impersonation, not inferred),
--            preferring gmarkant@icloud.com, then gmarkant@gmail.com.
-- vendor   : gmarkant@icloud.com (April Partner Test Agency). agency: gmarkant@gmail.com
--            (m a r k a n t). C1/C2 need each to see the other through the partnership policy
--            (checked by impersonation); otherwise NO SUBJECT.
-- hidden   : a profile with is_discoverable = false that the stranger cannot see (X7).
-- anon     : SET LOCAL ROLE anon.
-- IT IMPERSONATES AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE authenticated, then
-- auth.uid() is read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097. A fingerprint
-- of every profiles and organizations row is compared after each.
--
-- THE SENSITIVE COLUMNS X2/O1/C1/C2 READ are taken from the live catalog: whichever of legal_ein,
-- legal_address, legal_entity_name, legal_entity_type, legal_state_of_incorporation, rate_info,
-- payment_terms, payment_terms_custom, default_terms, default_nda_url, is_paid, is_admin,
-- demo_access, linked_agency_id exist (the SUBJECT line lists them).
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * EXECUTE of the multi-statement migration string inside the DO block is accepted (110, 113).
--   * PL/pgSQL variables keep values assigned inside a block that is rolled back (they are not
--     transactional), which the stranger search relies on.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 15;
  c_phases       CONSTANT integer := 2;
  c_public_keys  CONSTANT text := 'agency_type,avatar_url,bio,business_criteria,capabilities,company_linkedin_url,company_logo_url,company_name,company_website,display_name,full_name,id,is_discoverable,location,reel_url,website,work_examples';
  v_disc         uuid;
  v_disc_role    text;
  v_disc_vendor  boolean;
  v_stranger     uuid;
  v_vendor       uuid;
  v_agency       uuid;
  v_pair_ok      boolean := false;
  v_hidden       uuid;
  v_cand         uuid;
  v_vis          boolean;
  v_vis2         boolean;
  v_sens         text;
  v_txt          text;
  v_actor        text;
  v_uid          uuid;
  v_ph           integer;
  v_i            integer;
  v_k            integer;
  v_idx          integer;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_pol_before   text;
  v_pol_after    text;
  v_acl_before   text;
  v_acl_after    text;
  v_disc_gone    boolean;
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
  v_n            integer;
  v_same         boolean;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_sql    text[];
  sc_exp    text[];   -- flattened: (scenario - 1) * c_phases + phase
  r_cls     text[];
BEGIN
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  ---------------------------------------------------------------------
  -- SUBJECTS. NO SUBJECT IS REPORTED, NEVER PASSED.
  ---------------------------------------------------------------------
  SELECT p.id, p.role,
         (p.role = 'partner' OR EXISTS (SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
                                         WHERE m.user_id = p.id AND o.is_vendor))
    INTO v_disc, v_disc_role, v_disc_vendor
  FROM public.profiles p
  WHERE p.is_discoverable = true
  ORDER BY (p.role = 'partner' OR EXISTS (SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
                                           WHERE m.user_id = p.id AND o.is_vendor)) DESC,
           p.id
  LIMIT 1;

  SELECT string_agg(quote_ident(c), ', ' ORDER BY ord) INTO v_sens
  FROM unnest(ARRAY['legal_ein', 'legal_address', 'legal_entity_name', 'legal_entity_type',
                    'legal_state_of_incorporation', 'rate_info', 'payment_terms', 'payment_terms_custom',
                    'default_terms', 'default_nda_url', 'is_paid', 'is_admin', 'demo_access',
                    'linked_agency_id']) WITH ORDINALITY AS t(c, ord)
  WHERE EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = t.c);
  IF v_sens IS NULL THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: none of the sensitive columns exists on profiles';
  END IF;

  SELECT pr.id INTO v_vendor FROM public.profiles pr WHERE lower(btrim(pr.email)) = 'gmarkant@icloud.com' LIMIT 1;
  SELECT pr.id INTO v_agency FROM public.profiles pr WHERE lower(btrim(pr.email)) = 'gmarkant@gmail.com' LIMIT 1;

  -- The stranger: the first candidate for whom disc is NOT visible, proven by impersonation.
  IF v_disc IS NOT NULL THEN
    FOR v_cand IN
      SELECT s.id FROM public.profiles s
       WHERE s.id <> v_disc
       ORDER BY (lower(btrim(coalesce(s.email, ''))) = 'gmarkant@icloud.com') DESC,
                (lower(btrim(coalesce(s.email, ''))) = 'gmarkant@gmail.com') DESC,
                s.id
       LIMIT 40
    LOOP
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cand::text, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.jwt.claim.sub', v_cand::text, true);
        SET LOCAL ROLE authenticated;
        IF auth.uid() IS DISTINCT FROM v_cand THEN
          RAISE EXCEPTION 'impersonation mismatch (stranger search)' USING ERRCODE = 'LG098';
        END IF;
        v_vis := EXISTS (SELECT 1 FROM public.current_user_visible_profile_ids() AS v(id) WHERE v.id = v_disc);
        RESET ROLE;
        IF NOT v_vis THEN v_stranger := v_cand; END IF;
        RAISE EXCEPTION 'probe done' USING ERRCODE = 'LG097';
      EXCEPTION WHEN sqlstate 'LG097' THEN NULL;
      END;
      EXIT WHEN v_stranger IS NOT NULL;
    END LOOP;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- A hidden profile the stranger cannot see (X7).
  IF v_stranger IS NOT NULL THEN
    FOR v_cand IN
      SELECT h.id FROM public.profiles h
       WHERE h.is_discoverable IS DISTINCT FROM true AND h.id <> v_stranger
       ORDER BY h.id LIMIT 40
    LOOP
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
        SET LOCAL ROLE authenticated;
        v_vis := EXISTS (SELECT 1 FROM public.current_user_visible_profile_ids() AS v(id) WHERE v.id = v_cand);
        RESET ROLE;
        IF NOT v_vis THEN v_hidden := v_cand; END IF;
        RAISE EXCEPTION 'probe done' USING ERRCODE = 'LG097';
      EXCEPTION WHEN sqlstate 'LG097' THEN NULL;
      END;
      EXIT WHEN v_hidden IS NOT NULL;
    END LOOP;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- The counterparty pair: each must see the other through the partnership policy.
  IF v_vendor IS NOT NULL AND v_agency IS NOT NULL THEN
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_agency::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_agency::text, true);
      SET LOCAL ROLE authenticated;
      v_vis := EXISTS (SELECT 1 FROM public.current_user_visible_profile_ids() AS v(id) WHERE v.id = v_vendor);
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vendor::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_vendor::text, true);
      SET LOCAL ROLE authenticated;
      v_vis2 := EXISTS (SELECT 1 FROM public.current_user_visible_profile_ids() AS v(id) WHERE v.id = v_agency);
      RESET ROLE;
      v_pair_ok := v_vis AND v_vis2;
      RAISE EXCEPTION 'probe done' USING ERRCODE = 'LG097';
    EXCEPTION WHEN sqlstate 'LG097' THEN NULL;
    END;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF v_disc IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 115 YET.  NO SUBJECT: no profile has is_discoverable = true, so there is nothing for a stranger to read. Nothing was tested. This is not a pass (and 115 closes nothing live today).\n=====================================================\n';
  END IF;

  -- format() arguments: %1$L disc, %2$L stranger, %3$L vendor, %4$L agency, %5$L hidden,
  --                     %6$L disc's role, %7$s the sensitive column list (pre-quoted).
  sc_id := ARRAY['X1', 'X2', 'X4', 'X5', 'X6', 'X7', 'X8', 'O1', 'C1', 'C2', 'Z1', 'Z2'];

  sc_label := ARRAY[
    $l$X1  stranger: reads the discoverable profile's row$l$,
    $l$X2  stranger: reads its legal/billing/rate/terms/flag columns$l$,
    $l$X4  stranger: discovery path returns it, no private key$l$,
    $l$X5  stranger: discovery path key set is exactly public$l$,
    $l$X6  stranger: discovery path never carries the COI URL$l$,
    $l$X7  stranger: discovery path omits a non-discoverable profile$l$,
    $l$X8  stranger: discovery path role filter finds it$l$,
    $l$O1  owner: reads its own sensitive columns$l$,
    $l$C1  agency: reads its counterparty vendor's sensitive columns$l$,
    $l$C2  vendor: reads its counterparty agency's sensitive columns$l$,
    $l$Z1  anon: reads the discoverable profile$l$,
    $l$Z2  anon: cannot execute discoverable_profiles$l$];

  sc_actor := ARRAY['stranger', 'stranger', 'stranger', 'stranger', 'stranger', 'stranger_h', 'stranger',
                    'owner', 'agency', 'vendor', 'anon', 'anon'];

  sc_sql := ARRAY[
    $q$SELECT count(*)::text FROM public.profiles WHERE id = %1$L$q$,
    $q$SELECT count(*)::text FROM (SELECT %7$s FROM public.profiles WHERE id = %1$L) s$q$,
    $q$SELECT count(*)::text FROM public.discoverable_profiles(NULL, ARRAY[%1$L::uuid]) j WHERE j->>'id' = %1$L AND NOT (j ?| ARRAY['email','phone','role','active_role','secondary_role','active_org_id','legal_ein','legal_address','legal_entity_name','legal_entity_type','legal_state_of_incorporation','rate_info','payment_terms','payment_terms_custom','default_terms','default_nda_url','is_paid','is_admin','demo_access','linked_agency_id','notification_preferences','meeting_url'])$q$,
    $q$SELECT coalesce(string_agg(k, ',' ORDER BY k COLLATE "C"), '') FROM (SELECT DISTINCT jsonb_object_keys(j) AS k FROM public.discoverable_profiles(NULL, ARRAY[%1$L::uuid]) j) s$q$,
    $q$SELECT count(*)::text FROM public.discoverable_profiles(NULL, NULL) j WHERE (j->'business_criteria'->'insurance') ? 'coi_document_url'$q$,
    $q$SELECT count(*)::text FROM public.discoverable_profiles(NULL, ARRAY[%5$L::uuid]) j$q$,
    $q$SELECT count(*)::text FROM public.discoverable_profiles(%6$L, ARRAY[%1$L::uuid]) j$q$,
    $q$SELECT count(*)::text FROM (SELECT %7$s FROM public.profiles WHERE id = auth.uid()) s$q$,
    $q$SELECT count(*)::text FROM (SELECT %7$s FROM public.profiles WHERE id = %3$L) s$q$,
    $q$SELECT count(*)::text FROM (SELECT %7$s FROM public.profiles WHERE id = %4$L) s$q$,
    $q$SELECT count(*)::text FROM public.profiles WHERE id = %1$L$q$,
    $q$SELECT count(*)::text FROM public.discoverable_profiles(NULL, NULL) j$q$];

  sc_exp := ARRAY[
    'OK:1',    'OK:0',                     -- X1
    'OK:1',    'OK:0',                     -- X2
    'MISSING', 'OK:1',                     -- X4
    'MISSING', 'OK:' || c_public_keys,     -- X5
    'MISSING', 'OK:0',                     -- X6
    'MISSING', 'OK:0',                     -- X7
    'MISSING', 'OK:1',                     -- X8
    'OK:1',    'OK:1',                     -- O1
    'OK:1',    'OK:1',                     -- C1
    'OK:1',    'OK:1',                     -- C2
    'NONE',    'NONE',                     -- Z1 (0 rows or 42501)
    'MISSING', 'REFUSED:42501'];           -- Z2

  v_n := array_length(sc_id, 1);
  IF v_n <> 12 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_sql, 1) <> v_n OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length';
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  -- Every profiles policy EXCEPT the one 115 drops, before; every profiles policy, after.
  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
    AND policyname <> 'Authenticated users can read discoverable profiles';
  SELECT relacl::text INTO v_acl_before FROM pg_class WHERE oid = 'public.profiles'::regclass;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 115 is executed between phases.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.profiles x), ''))
          || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.organizations x), ''));

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];
      v_uid := CASE v_actor WHEN 'stranger' THEN v_stranger WHEN 'stranger_h' THEN v_stranger
                            WHEN 'owner' THEN v_disc WHEN 'agency' THEN v_agency WHEN 'vendor' THEN v_vendor
                            ELSE NULL END;

      IF (v_actor IN ('stranger', 'stranger_h') AND v_stranger IS NULL)
         OR (v_actor = 'stranger_h' AND v_hidden IS NULL)
         OR (v_actor IN ('agency', 'vendor') AND NOT v_pair_ok)
         OR (sc_id[v_i] = 'X8' AND v_disc_role IS NULL) THEN
        r_cls[v_idx] := 'NOSUBJECT';
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          IF v_actor = 'anon' THEN
            SET LOCAL ROLE anon;
            IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
              RAISE EXCEPTION 'impersonation mismatch (anon): current_user is %, uid %', current_user, auth.uid() USING ERRCODE = 'LG098';
            END IF;
          ELSE
            PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
            PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (%): auth.uid() is %, expected %', v_actor, auth.uid(), v_uid USING ERRCODE = 'LG098';
            END IF;
          END IF;

          EXECUTE format(sc_sql[v_i], v_disc, v_stranger, v_vendor, v_agency, v_hidden, v_disc_role, v_sens) INTO v_txt;
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);

          r_cls[v_idx] := 'OK:' || coalesce(v_txt, 'NULL');
          RAISE EXCEPTION 'scenario % complete: undoing it', sc_id[v_i] USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN
            NULL;
          WHEN OTHERS THEN
            r_cls[v_idx] := CASE
              WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
              WHEN SQLSTATE = '42883' THEN 'MISSING'
              WHEN SQLSTATE IN ('42501', 'LG115') THEN 'REFUSED:' || SQLSTATE
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.profiles x), ''))
           || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.organizations x), ''));
      v_iso_runs := v_iso_runs + 1;
      IF v_fp IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc_id[v_i] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;

    -- The migration code, executed between phases, in this transaction.
    IF v_ph = 1 THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      BEGIN
        EXECUTE $m115$
DO $preflight$
DECLARE
  v_missing text;
  v_select  text;
  v_qual    text;
BEGIN
  IF to_regprocedure('public.discoverable_profiles(text, uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION '115 refuses to apply: public.discoverable_profiles(text, uuid[]) already exists. Read the schema first.'
      USING ERRCODE = 'LG115';
  END IF;

  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND policyname = 'Authenticated users can read discoverable profiles'
     AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[];
  IF v_qual IS NULL THEN
    RAISE EXCEPTION '115 refuses to apply: the discoverable SELECT policy is not there as scripts/016 created it (FOR SELECT TO authenticated). Read the schema first.'
      USING ERRCODE = 'LG115';
  END IF;
  IF regexp_replace(lower(v_qual), '[\s()]', '', 'g') <> 'is_discoverable=true' THEN
    RAISE EXCEPTION '115 refuses to apply: the discoverable policy reads % rather than (is_discoverable = true). Read it first.', v_qual
      USING ERRCODE = 'LG115';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'profiles'
                    AND policyname = 'Users can view profiles of partnership members' AND cmd = 'SELECT'
                    AND qual ILIKE '%current_user_visible_profile_ids%') THEN
    RAISE EXCEPTION '115 refuses to apply: "Users can view profiles of partnership members" (079/085) is missing or changed; owner and counterparty reads depend on it.'
      USING ERRCODE = 'LG115';
  END IF;

  -- Dropping one policy only closes the leak if no OTHER SELECT policy also admits strangers.
  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_select
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd IN ('SELECT', 'ALL')
    AND policyname NOT IN ('Authenticated users can read discoverable profiles',
                           'Users can view profiles of partnership members');
  IF v_select IS NOT NULL THEN
    RAISE EXCEPTION '115 refuses to apply: profiles has other SELECT policies (%); read them, dropping the discoverable one may not close the exposure.', v_select
      USING ERRCODE = 'LG115';
  END IF;

  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['is_discoverable', 'role', 'active_role', 'full_name', 'company_name', 'display_name',
                    'bio', 'location', 'website', 'company_website', 'company_linkedin_url', 'agency_type',
                    'avatar_url', 'company_logo_url', 'reel_url', 'capabilities', 'work_examples',
                    'business_criteria']) AS c
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '115 refuses to apply: profiles lacks %.', v_missing USING ERRCODE = 'LG115';
  END IF;
END
$preflight$;

CREATE FUNCTION public.discoverable_profiles(p_role text DEFAULT NULL, p_ids uuid[] DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
           'id',                   p.id,
           'full_name',            p.full_name,
           'company_name',         p.company_name,
           'display_name',         p.display_name,
           'bio',                  CASE WHEN strpos(p.bio, E'\n\n__LIGAMENT_PARTNER_RATE_V1__\n') > 0
                                        THEN rtrim(left(p.bio, strpos(p.bio, E'\n\n__LIGAMENT_PARTNER_RATE_V1__\n') - 1), E' \t\r\n')
                                        ELSE p.bio END,
           'location',             p.location,
           'website',              p.website,
           'company_website',      p.company_website,
           'company_linkedin_url', p.company_linkedin_url,
           'agency_type',          p.agency_type,
           'avatar_url',           p.avatar_url,
           'company_logo_url',     p.company_logo_url,
           'reel_url',             p.reel_url,
           'capabilities',         p.capabilities,
           'work_examples',        p.work_examples,
           'business_criteria',    CASE WHEN jsonb_typeof(p.business_criteria::jsonb) = 'object'
                                         AND jsonb_typeof(p.business_criteria::jsonb -> 'insurance') = 'object'
                                        THEN jsonb_set(p.business_criteria::jsonb, '{insurance}',
                                                       (p.business_criteria::jsonb -> 'insurance') - 'coi_document_url')
                                        ELSE p.business_criteria::jsonb END,
           'is_discoverable',      true)
  FROM public.profiles p
  WHERE p.is_discoverable = true
    AND auth.uid() IS NOT NULL
    AND (p_role IS NULL OR p.role = p_role OR p.active_role = p_role)
    AND (p_ids IS NULL OR p.id = ANY (p_ids))
  ORDER BY p.company_name NULLS LAST, p.id;
$$;

COMMENT ON FUNCTION public.discoverable_profiles(text, uuid[]) IS
  'Migration 115. The discovery read of profiles for any signed-in user: discoverable profiles '
  'only, PUBLIC DISCOVERY FIELDS ONLY (allow-list; bio without the legacy rate block; '
  'business_criteria without insurance.coi_document_url). p_role matches role OR active_role; '
  'p_ids restricts to those ids. No email, phone, role, legal, billing, rate, terms or authority '
  'column. Replaces the whole-row policy "Authenticated users can read discoverable profiles".';

REVOKE ALL     ON FUNCTION public.discoverable_profiles(text, uuid[]) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.discoverable_profiles(text, uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.discoverable_profiles(text, uuid[]) TO authenticated;

DROP POLICY "Authenticated users can read discoverable profiles" ON public.profiles;
        $m115$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('115 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
    END IF;
  END LOOP;

  RESET ROLE;

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_after
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  SELECT relacl::text INTO v_acl_after FROM pg_class WHERE oid = 'public.profiles'::regclass;
  v_disc_gone := NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
                              AND policyname = 'Authenticated users can read discoverable profiles');

  ---------------------------------------------------------------------
  -- JUDGEMENT, exactly 113's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
  -- 'NONE' accepts OK:0 or REFUSED:42501 (anon has no row either way).
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
      ELSIF NOT (v_cls = v_exp
                 OR (v_exp = 'REFUSED:*' AND v_cls LIKE 'REFUSED:%')
                 OR (v_exp = 'NONE' AND v_cls IN ('OK:0', 'REFUSED:42501'))) THEN
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

  -- P1. Exactly one policy on profiles went away (the discoverable one); every other is unchanged.
  v_ok := v_disc_gone AND (v_pol_before IS NOT DISTINCT FROM v_pol_after);
  v_detail := format('(others before %s, all after %s, discoverable policy gone: %s)', v_pol_before, v_pol_after, v_disc_gone);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('P1  only the discoverable policy left profiles', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('P1  only the discoverable policy left profiles', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- P2. No grant on profiles changed.
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('P2  no grant on profiles changed (relacl)', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('P2  no grant on profiles changed (relacl)', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- P3. The function is shaped as authored: SECURITY DEFINER, STABLE, search_path pinned, no
  --     PUBLIC entry in its ACL, anon cannot execute, authenticated can.
  SELECT p.prosecdef
         AND p.provolatile = 's'
         AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
         AND p.proacl IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    INTO v_ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'discoverable_profiles';
  v_ok := coalesce(v_ok, false)
          AND to_regprocedure('public.discoverable_profiles(text, uuid[])') IS NOT NULL
          AND NOT has_function_privilege('anon', 'public.discoverable_profiles(text, uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.discoverable_profiles(text, uuid[])', 'EXECUTE');
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('P3  definer, stable, search_path, grants as authored', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('P3  definer, stable, search_path, grants as authored', 66) || rpad('FAIL', 14) || '(read 115''s V2-V3)'; END IF;

  ---------------------------------------------------------------------
  -- VERDICT + REPORT. Self-checks outrank everything.
  ---------------------------------------------------------------------
  IF array_length(v_apply_err, 1) IS NOT NULL THEN
    v_fail := v_fail + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 66) || rpad('FAIL', 14) || array_to_string(v_apply_err, ' | ');
  ELSE
    v_pass := v_pass + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 66) || rpad('PASS', 14) || '(the inlined migration executed to the end)';
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;

  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected + 1 OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 115.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 115.';
    v_headline := format('SAFE TO APPLY 115.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 115 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 115 does what it claims.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 115.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0; NO SUBJECT counts here)\n', v_inconc)
    || format(E'isolation check : %s scenario run(s) compared to the pre-phase fingerprint of profiles AND organizations: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT         : discoverable %s (role %s, vendor: %s), stranger %s, hidden %s, vendor %s, agency %s (each sees the other: %s)\n',
              v_disc, coalesce(v_disc_role, '?'), v_disc_vendor, coalesce(v_stranger::text, 'NONE'), coalesce(v_hidden::text, 'NONE'),
              coalesce(v_vendor::text, 'NONE'), coalesce(v_agency::text, 'NONE'), v_pair_ok)
    || format(E'SENSITIVE COLS  : %s\n', v_sens)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 115\n  phase 2 = AFTER 115\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

-- THE BACKSTOP. Not reached on the expected path (the DO block ends in RAISE EXCEPTION).
ROLLBACK;
