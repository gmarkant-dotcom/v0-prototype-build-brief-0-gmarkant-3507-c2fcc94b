-- =====================================================================
-- 113 PRE-APPLY TEST. ONE PASTE. APPLIES 113, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-09 on fix/agency-gate-and-leaks. NOT RUN: THERE IS NO LOCAL POSTGRES AND NO
-- CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain error, not in
-- "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code below (between $m113$ markers) is copied from
-- 113_role_columns_guard.sql, lines 117-285 (the body between BEGIN; and COMMIT;). If you edit
-- the migration, re-copy it here.
--
-- WHAT 113 MUST SHOW: a signed-in user can no longer write profiles.role, secondary_role or
-- active_role directly; set_active_role() refuses 'agency' without a paid lead-agency membership
-- and 'partner' without a vendor membership; it DOES change active_role for an entitled caller
-- (so it passes its own guard); the service role still writes; set_active_org (090) still works.
--
-- PHASES: phase 1 BEFORE 113 (the defect: direct writes succeed, the function is missing), phase 2
-- AFTER 113. EVERY ASSERTION RUNS IN EVERY PHASE. A phase-1 mismatch is INCONCLUSIVE (the premise
-- is wrong), never PASS; a phase-2 mismatch is FAIL.
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
--     "SAFE TO APPLY 113."       -> and only this.
--     "DO NOT APPLY 113 YET."    -> INCONCLUSIVE or NO SUBJECT. Not a green light.
--     "DO NOT APPLY 113."        -> an assertion FAILED, or the test is broken.
-- Rows read PASS, FAIL, INCONCLUSIVE, NOT DISCRIMINATING (same expectation in both phases, reported as
-- PASS with that note) or NO SUBJECT (reported as INCONCLUSIVE, never PASS).
--
-- THIS FILE DEFINES NO FUNCTION IN pg_temp AND NO TEMP TABLE.
--
-- =====================================================================
-- THE SUBJECTS
-- =====================================================================
-- vendor : gmarkant@icloud.com where possible, a member of the April Partner Test Agency (by name;
--          failing that, any is_vendor organization of gmarkant@icloud.com). F1 needs it to belong to
--          NO lead+paid organization; otherwise F1 is NO SUBJECT.
-- agency : gmarkant@gmail.com where possible, a member of an organization with is_lead_agency AND
--          is_paid (m a r k a n t), and not a member of the vendor's organization.
-- service: SET LOCAL ROLE service_role.   anon: SET LOCAL ROLE anon.
-- IT IMPERSONATES AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE authenticated, then
-- auth.uid() is read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097, undoing its
-- setup and its write. A fingerprint of every profiles and organizations row is compared after each.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * EXECUTE of the multi-statement migration string inside the DO block is accepted (110 relied on it).
--   * current_setting('ligament.set_active_role', true) returns NULL when never set in the session.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 20;
  c_phases       CONSTANT integer := 2;
  v_vorg         uuid;
  v_vorg_name    text;
  v_vendor       uuid;
  v_vendor_pure  boolean;
  v_agency       uuid;
  v_agency_org   uuid;
  v_agency_vendor boolean;
  v_vendor_claims text;
  v_agency_claims text;
  v_txt          text;
  v_actor        text;
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
  sc_setup  text[];
  sc_sql    text[];
  sc_post   text[];
  v_txt2    text;
  sc_exp    text[];   -- flattened: (scenario - 1) * c_phases + phase
  r_cls     text[];
BEGIN
  ---------------------------------------------------------------------
  -- SUBJECTS. NO SUBJECT IS REPORTED, NEVER PASSED.
  ---------------------------------------------------------------------
  SELECT o.id INTO v_vorg FROM public.organizations o
   WHERE lower(btrim(o.name)) = 'april partner test agency' AND o.is_vendor
   ORDER BY o.id LIMIT 1;
  IF v_vorg IS NULL THEN
    SELECT m.org_id INTO v_vorg
    FROM public.org_members m
    JOIN public.profiles pr ON pr.id = m.user_id
    JOIN public.organizations o ON o.id = m.org_id
    WHERE lower(btrim(pr.email)) = 'gmarkant@icloud.com' AND o.is_vendor
    ORDER BY m.org_id LIMIT 1;
  END IF;
  SELECT o.name INTO v_vorg_name FROM public.organizations o WHERE o.id = v_vorg;

  SELECT m.user_id INTO v_vendor
  FROM public.org_members m LEFT JOIN public.profiles pr ON pr.id = m.user_id
  WHERE m.org_id = v_vorg
  ORDER BY (lower(btrim(coalesce(pr.email, ''))) = 'gmarkant@icloud.com') DESC, m.user_id
  LIMIT 1;

  v_vendor_pure := NOT EXISTS (
    SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
     WHERE m.user_id = v_vendor AND o.is_lead_agency AND o.is_paid);

  SELECT m.user_id, m.org_id INTO v_agency, v_agency_org
  FROM public.org_members m
  JOIN public.organizations o ON o.id = m.org_id
  LEFT JOIN public.profiles pr ON pr.id = m.user_id
  WHERE o.is_lead_agency AND o.is_paid
    AND (v_vorg IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = m.user_id AND x.org_id = v_vorg))
  ORDER BY (lower(btrim(coalesce(pr.email, ''))) = 'gmarkant@gmail.com') DESC, m.user_id
  LIMIT 1;

  v_agency_vendor := EXISTS (
    SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
     WHERE m.user_id = v_agency AND o.is_vendor);

  IF v_vendor IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 113 YET.  NO SUBJECT: no member of the April Partner Test Agency (or of a vendor organization of gmarkant@icloud.com) was found. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  v_vendor_claims := json_build_object('sub', v_vendor::text, 'role', 'authenticated')::text;
  v_agency_claims := json_build_object('sub', v_agency::text, 'role', 'authenticated')::text;

  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  -- format() arguments: %1$L vendor uid, %2$L agency uid, %3$L agency's paid lead org, %4$L vendor org.
  sc_id := ARRAY[
    'R1', 'R2', 'R3', 'R4',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
    'S1', 'S2', 'Z1',
    'O1', 'O2', 'O3'];

  sc_label := ARRAY[
    $l$R1  vendor: writes its own profiles.role directly$l$,
    $l$R2  vendor: writes its own secondary_role directly$l$,
    $l$R3  vendor: writes active_role = agency directly$l$,
    $l$R4  agency (paid lead): writes active_role directly$l$,
    $l$F1  vendor: set_active_role('agency') is refused$l$,
    $l$F2  agency, org made unpaid: set_active_role('agency') refused$l$,
    $l$F3  agency (paid lead): set_active_role('agency') switches$l$,
    $l$F4  vendor: set_active_role('partner') switches$l$,
    $l$F5  agency: set_active_role('partner') by vendor membership$l$,
    $l$F6  vendor: set_active_role('admin') is refused$l$,
    $l$S1  service role: writes a profile's role$l$,
    $l$S2  service role: writes a profile's active_role$l$,
    $l$Z1  anon: cannot execute set_active_role$l$,
    $l$O1  agency: set_active_org (090) still works$l$,
    $l$O2  vendor: an ordinary settings save still works$l$,
    $l$O3  vendor: whole-row save with role columns unchanged$l$];

  sc_actor := ARRAY[
    'vendor', 'vendor', 'vendor', 'agency',
    'vendor_pure', 'agency', 'agency', 'vendor', 'agency', 'vendor',
    'service', 'service', 'anon',
    'agency', 'vendor', 'vendor'];

  -- Owner-side setup per scenario, run before impersonating, undone with the scenario.
  sc_setup := ARRAY[
    '',
    '',
    $s$UPDATE public.profiles SET active_role = 'partner' WHERE id = %1$L$s$,
    $s$UPDATE public.profiles SET active_role = 'partner' WHERE id = %2$L$s$,
    $s$UPDATE public.profiles SET active_role = 'partner' WHERE id = %1$L$s$,
    $s$UPDATE public.organizations SET is_paid = false WHERE id IN (SELECT org_id FROM public.org_members WHERE user_id = %2$L)$s$,
    $s$UPDATE public.profiles SET active_role = 'partner' WHERE id = %2$L$s$,
    $s$UPDATE public.profiles SET active_role = 'agency' WHERE id = %1$L$s$,
    $s$UPDATE public.profiles SET active_role = 'agency' WHERE id = %2$L$s$,
    '',
    '',
    $s$UPDATE public.profiles SET active_role = 'partner' WHERE id = %1$L$s$,
    '',
    '',
    '',
    ''];

  sc_sql := ARRAY[
    $q$WITH u AS (UPDATE public.profiles SET role = CASE WHEN role = 'partner' THEN 'agency' ELSE 'partner' END WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.profiles SET secondary_role = CASE WHEN secondary_role = 'agency' THEN 'partner' ELSE 'agency' END WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.profiles SET active_role = 'agency' WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.profiles SET active_role = 'agency' WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT (public.set_active_role('agency'))->>'active_role'$q$,
    $q$SELECT (public.set_active_role('agency'))->>'active_role'$q$,
    $q$SELECT (public.set_active_role('agency'))->>'active_role'$q$,
    $q$SELECT (public.set_active_role('partner'))->>'active_role'$q$,
    $q$SELECT (public.set_active_role('partner'))->>'active_role'$q$,
    $q$SELECT (public.set_active_role('admin'))->>'active_role'$q$,
    $q$WITH u AS (UPDATE public.profiles SET role = CASE WHEN role = 'partner' THEN 'agency' ELSE 'partner' END WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.profiles SET active_role = 'agency' WHERE id = %1$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT (public.set_active_role('agency'))::text$q$,
    $q$SELECT (((public.set_active_org(%3$L::uuid))->>'active_org_id') = %3$L)::text$q$,
    $q$WITH u AS (UPDATE public.profiles SET full_name = full_name WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.profiles SET role = role, secondary_role = secondary_role, active_role = active_role WHERE id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u$q$];

  -- A SECOND STATEMENT, run as the same actor after sc_sql, appended as '/<result>'. It exists
  -- because a function's UPDATE is not visible to the snapshot of the statement that called it:
  -- the read-back that proves set_active_role really changed active_role must be its own statement.
  sc_post := ARRAY[
    '', '', '', '',
    '', '',
    $p$SELECT active_role FROM public.profiles WHERE id = auth.uid()$p$,
    $p$SELECT active_role FROM public.profiles WHERE id = auth.uid()$p$,
    $p$SELECT active_role FROM public.profiles WHERE id = auth.uid()$p$,
    '',
    '', '', '',
    '', '', ''];

  sc_exp := ARRAY[
    'OK:1', 'REFUSED:LG113',                         -- R1
    'OK:1', 'REFUSED:LG113',                         -- R2
    'OK:1', 'REFUSED:LG113',                         -- R3
    'OK:1', 'REFUSED:LG113',                         -- R4
    'MISSING', 'REFUSED:LG11A',                      -- F1
    'MISSING', 'REFUSED:LG11A',                      -- F2
    'MISSING', 'OK:agency/agency',                   -- F3
    'MISSING', 'OK:partner/partner',                 -- F4
    'MISSING', CASE WHEN v_agency_vendor THEN 'OK:partner/partner' ELSE 'REFUSED:LG11B' END,  -- F5
    'MISSING', 'REFUSED:LG11C',                      -- F6
    'OK:1', 'OK:1',                                  -- S1
    'OK:1', 'OK:1',                                  -- S2
    'MISSING', 'REFUSED:42501',                      -- Z1
    'OK:true', 'OK:true',                            -- O1
    'OK:1', 'OK:1',                                  -- O2
    'OK:1', 'OK:1'];                                 -- O3

  v_n := array_length(sc_id, 1);
  IF v_n <> 16 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_setup, 1) <> v_n OR array_length(sc_sql, 1) <> v_n
     OR array_length(sc_post, 1) <> v_n
     OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length';
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  SELECT relacl::text INTO v_acl_before FROM pg_class WHERE oid = 'public.profiles'::regclass;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 113 is executed between phases.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    v_fp0 := md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.profiles x), ''))
          || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.organizations x), ''));

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];

      IF (v_actor = 'agency' AND v_agency IS NULL)
         OR (v_actor = 'vendor_pure' AND NOT v_vendor_pure)
         OR (sc_id[v_i] = 'O1' AND v_agency_org IS NULL) THEN
        r_cls[v_idx] := 'NOSUBJECT';
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          IF sc_setup[v_i] <> '' THEN
            EXECUTE format(sc_setup[v_i], v_vendor, v_agency, v_agency_org, v_vorg);
          END IF;

          IF v_actor IN ('vendor', 'vendor_pure') THEN
            PERFORM set_config('request.jwt.claims',    v_vendor_claims,  true);
            PERFORM set_config('request.jwt.claim.sub', v_vendor::text,   true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_vendor THEN
              RAISE EXCEPTION 'impersonation mismatch (vendor): auth.uid() is %, expected %', auth.uid(), v_vendor USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'agency' THEN
            PERFORM set_config('request.jwt.claims',    v_agency_claims,  true);
            PERFORM set_config('request.jwt.claim.sub', v_agency::text,   true);
            SET LOCAL ROLE authenticated;
            IF auth.uid() IS DISTINCT FROM v_agency THEN
              RAISE EXCEPTION 'impersonation mismatch (agency): auth.uid() is %, expected %', auth.uid(), v_agency USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'service' THEN
            SET LOCAL ROLE service_role;
            IF current_user <> 'service_role' OR auth.uid() IS NOT NULL THEN
              RAISE EXCEPTION 'impersonation mismatch (service): current_user is %, uid %', current_user, auth.uid() USING ERRCODE = 'LG098';
            END IF;
          ELSIF v_actor = 'anon' THEN
            SET LOCAL ROLE anon;
            IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
              RAISE EXCEPTION 'impersonation mismatch (anon): current_user is %, uid %', current_user, auth.uid() USING ERRCODE = 'LG098';
            END IF;
          END IF;

          EXECUTE format(sc_sql[v_i], v_vendor, v_agency, v_agency_org, v_vorg) INTO v_txt;
          IF sc_post[v_i] <> '' THEN
            EXECUTE format(sc_post[v_i], v_vendor, v_agency, v_agency_org, v_vorg) INTO v_txt2;
            v_txt := coalesce(v_txt, 'NULL') || '/' || coalesce(v_txt2, 'NULL');
          END IF;
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
              WHEN SQLSTATE = '42883' THEN 'MISSING'
              WHEN SQLSTATE IN ('42501', 'LG113', 'LG11A', 'LG11B', 'LG11C', 'LG002', 'LG007') THEN 'REFUSED:' || SQLSTATE
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
        EXECUTE $m113$

DO $preflight$
DECLARE
  v_checks text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
              AND tgname = 'profiles_role_columns_guard') THEN
    RAISE EXCEPTION '113 refuses to apply: profiles_role_columns_guard already exists. Read the schema first.'
      USING ERRCODE = 'LG113';
  END IF;
  IF to_regprocedure('public.set_active_role(text)') IS NOT NULL THEN
    RAISE EXCEPTION '113 refuses to apply: public.set_active_role(text) already exists. Read the schema first.'
      USING ERRCODE = 'LG113';
  END IF;
  IF to_regprocedure('public.set_active_org(uuid)') IS NULL THEN
    RAISE EXCEPTION '113 refuses to apply: 090 is not applied (public.set_active_org(uuid) is missing).'
      USING ERRCODE = 'LG113';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
                  AND tgname = 'profiles_authority_columns_guard') THEN
    RAISE EXCEPTION '113 refuses to apply: 091 is not applied (profiles_authority_columns_guard is missing).'
      USING ERRCODE = 'LG113';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'organizations'
         AND column_name IN ('is_lead_agency', 'is_vendor', 'is_paid')) <> 3 THEN
    RAISE EXCEPTION '113 refuses to apply: organizations lacks is_lead_agency, is_vendor or is_paid (079/092).'
      USING ERRCODE = 'LG113';
  END IF;
  SELECT string_agg(pg_get_constraintdef(c.oid), ' | ') INTO v_checks
  FROM pg_constraint c
  WHERE c.conrelid = 'public.profiles'::regclass AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ~ '(role|active_role|secondary_role)';
  IF v_checks IS NULL OR position('agency' IN v_checks) = 0 OR position('partner' IN v_checks) = 0 THEN
    RAISE EXCEPTION '113 refuses to apply: the role CHECK constraints on profiles do not name both agency and partner (found: %).', coalesce(v_checks, 'none')
      USING ERRCODE = 'LG113';
  END IF;
END
$preflight$;

CREATE FUNCTION public.profiles_guard_role_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_marker text;
BEGIN
  -- THE EARLY RETURN. Every settings save and every write that leaves the three alone.
  IF  NEW.role           IS NOT DISTINCT FROM OLD.role
  AND NEW.secondary_role IS NOT DISTINCT FROM OLD.secondary_role
  AND NEW.active_role    IS NOT DISTINCT FROM OLD.active_role
  THEN
    RETURN NEW;
  END IF;

  -- 091's EXEMPTION: no end-user session (service role, migrations, SQL Editor,
  -- handle_new_user). Trusted code that has made its own decision.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG113',
            DETAIL  = 'profiles.role is guarded by migration 113. Only the service role or a migration may write it.';
  END IF;

  IF NEW.secondary_role IS DISTINCT FROM OLD.secondary_role THEN
    RAISE EXCEPTION 'That is not a field you can change.'
      USING ERRCODE = 'LG113',
            DETAIL  = 'profiles.secondary_role is guarded by migration 113. Only the service role or a migration may write it.';
  END IF;

  -- active_role moved, from a session. Only set_active_role() may do that, and only for the
  -- caller's own row: the transaction-local marker it sets must name both.
  v_marker := current_setting('ligament.set_active_role', true);
  IF v_marker IS NULL OR v_marker = '' OR v_marker <> v_uid::text OR NEW.id <> v_uid THEN
    RAISE EXCEPTION 'Use the portal switch to change portal.'
      USING ERRCODE = 'LG113',
            DETAIL  = 'profiles.active_role is guarded by migration 113. A session may change it only through public.set_active_role(text).';
  END IF;

  -- 090's ROW INVARIANT, for the row owner, whoever got here.
  IF NEW.active_role = 'agency' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = NEW.id AND o.is_lead_agency AND o.is_paid) THEN
    RAISE EXCEPTION 'Agency access requires a paid lead-agency account.' USING ERRCODE = 'LG11A';
  END IF;
  IF NEW.active_role = 'partner' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = NEW.id AND o.is_vendor) THEN
    RAISE EXCEPTION 'Vendor mode is available to members of a vendor company.' USING ERRCODE = 'LG11B';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_role_columns() IS
  'Migration 113. BEFORE UPDATE guard on profiles.role, secondary_role, active_role. A session '
  '(auth.uid() NOT NULL) may not change role or secondary_role at all (LG113), and may change '
  'active_role only inside public.set_active_role(text), which sets the transaction-local marker '
  'ligament.set_active_role to the caller uid. The row invariant of 090 is re-checked for the row '
  'owner: agency needs a lead+paid membership (LG11A), partner a vendor membership (LG11B). The '
  'service role, migrations and handle_new_user (auth.uid() NULL) are exempt, as in 091.';

DROP TRIGGER IF EXISTS profiles_role_columns_guard ON public.profiles;

CREATE TRIGGER profiles_role_columns_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_role_columns();

CREATE FUNCTION public.set_active_role(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to switch portal.' USING ERRCODE = 'LG002';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('agency', 'partner') THEN
    RAISE EXCEPTION 'Choose agency or partner.' USING ERRCODE = 'LG11C';
  END IF;

  -- VALIDATE BEFORE WRITING (090's order). Fixed messages; nothing about any organization is
  -- echoed, so neither refusal is an oracle.
  IF p_role = 'agency' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = v_uid AND o.is_lead_agency AND o.is_paid) THEN
    RAISE EXCEPTION 'Agency access requires a paid lead-agency account.' USING ERRCODE = 'LG11A';
  END IF;

  IF p_role = 'partner' AND NOT EXISTS (
       SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.user_id = v_uid AND o.is_vendor) THEN
    RAISE EXCEPTION 'Vendor mode is available to members of a vendor company.' USING ERRCODE = 'LG11B';
  END IF;

  -- THE DELIBERATE EXEMPTION (see the header): transaction-local, scoped to this one UPDATE.
  PERFORM set_config('ligament.set_active_role', v_uid::text, true);
  UPDATE public.profiles SET active_role = p_role WHERE id = v_uid;
  PERFORM set_config('ligament.set_active_role', '', true);

  RETURN jsonb_build_object('active_role', p_role);
END;
$$;

COMMENT ON FUNCTION public.set_active_role(text) IS
  'Migration 113. The one sanctioned writer of profiles.active_role for a signed-in caller, built '
  'on 090''s set_active_org: validate, then write the caller''s own row. agency requires membership '
  'of an organization with is_lead_agency AND is_paid (LG11A); partner requires membership of an '
  'is_vendor organization (LG11B); anything else LG11C; no session LG002. Passes '
  'profiles_role_columns_guard through the transaction-local marker ligament.set_active_role.';

REVOKE EXECUTE ON FUNCTION public.set_active_role(text)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_active_role(text)            FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_active_role(text)            TO authenticated;

REVOKE EXECUTE ON FUNCTION public.profiles_guard_role_columns()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_role_columns()    FROM anon;
REVOKE EXECUTE ON FUNCTION public.profiles_guard_role_columns()    FROM authenticated;

        $m113$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('113 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
    END IF;
  END LOOP;

  RESET ROLE;

  SELECT md5(coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY policyname), ''))
    INTO v_pol_after
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  SELECT relacl::text INTO v_acl_after FROM pg_class WHERE oid = 'public.profiles'::regclass;

  ---------------------------------------------------------------------
  -- JUDGEMENT, exactly 110's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
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
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 62) || rpad(v_st, 14) || v_detail;
  END LOOP;

  -- P1. No policy on profiles changed.
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(fingerprint %s before, %s after)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('P1  no policy on profiles changed', 62) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('P1  no policy on profiles changed', 62) || rpad('FAIL', 14) || v_detail; END IF;

  -- P2. No grant on profiles changed.
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('P2  no grant on profiles changed (relacl)', 62) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('P2  no grant on profiles changed (relacl)', 62) || rpad('FAIL', 14) || v_detail; END IF;

  -- P3. The objects are shaped as authored: trigger enabled BEFORE UPDATE; both functions SECURITY
  --     DEFINER with search_path pinned; set_active_role anon=f authenticated=t; guard granted to nobody.
  SELECT (t.tgenabled = 'O') AND ((t.tgtype & 2) = 2) AND ((t.tgtype & 16) = 16) INTO v_ok
  FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'profiles_role_columns_guard';
  v_ok := coalesce(v_ok, false)
          AND to_regprocedure('public.set_active_role(text)') IS NOT NULL
          AND NOT has_function_privilege('anon', 'public.set_active_role(text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.set_active_role(text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.profiles_guard_role_columns()', 'EXECUTE')
          AND (SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%')
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname IN ('set_active_role', 'profiles_guard_role_columns'));
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('P3  trigger, grants, definer, search_path as authored', 62) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('P3  trigger, grants, definer, search_path as authored', 62) || rpad('FAIL', 14) || '(read 113''s V1-V3)'; END IF;

  -- P4. Only 113's two functions name the marker; no other public function calls set_config.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc ILIKE '%set_config%'
     AND p.proname NOT IN ('set_active_role');
  v_ok := v_n = 0;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('P4  no other public function calls set_config', 62) || rpad('PASS', 14);
  ELSE v_inconc := v_inconc + 1; v_lines := v_lines || E'\n  ' || rpad('P4  no other public function calls set_config', 62) || rpad('INCONCLUSIVE', 14) || format('(%s other function(s) call set_config: read them; one that passes caller input would let a browser forge the marker)', v_n); END IF;

  ---------------------------------------------------------------------
  -- VERDICT + REPORT. Self-checks outrank everything.
  ---------------------------------------------------------------------
  IF array_length(v_apply_err, 1) IS NOT NULL THEN
    v_fail := v_fail + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 62) || rpad('FAIL', 14) || array_to_string(v_apply_err, ' | ');
  ELSE
    v_pass := v_pass + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 62) || rpad('PASS', 14) || '(the inlined migration executed to the end)';
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;

  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected + 1 OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 113.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 113.';
    v_headline := format('SAFE TO APPLY 113.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 113 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 113 does what it claims.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 113.  %s assertion(s) FAILED.', v_fail);
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
    || format(E'SUBJECT         : vendor org %s (%s), vendor %s (in no lead+paid org: %s), agency %s, agency paid lead org %s (agency also in a vendor org: %s)\n',
              coalesce(v_vorg::text, 'NONE'), coalesce(v_vorg_name, '?'), v_vendor, v_vendor_pure,
              coalesce(v_agency::text, 'NONE'), coalesce(v_agency_org::text, 'NONE'), v_agency_vendor)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 113\n  phase 2 = AFTER 113\n'
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
