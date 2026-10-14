-- =====================================================================
-- 118 PRE-APPLY TEST. ONE PASTE. APPLIES 118, WRITES, READS, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-14 on feat/rfp-record-a (unattended run). NOT RUN: THERE IS NO LOCAL POSTGRES AND
-- NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain error, not in
-- "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code below (inside the $m118$ string) is 118_rfp_records.sql from the line
-- "-- >>> 118 BODY START" to the line "-- <<< 118 BODY END" inclusive: the whole body between BEGIN;
-- and COMMIT;. Both files carry those two marker lines, so the copies can be compared mechanically.
-- Checked 2026-10-14 (feat/rfp-record-a2) with git diff --no-index: no hunk falls between the markers.
-- If you edit the migration, re-copy the marked block here and re-check.
--
-- 116 AND 117 ARE LIVE (applied 2026-10-14). This test applies only 118, inside its own transaction,
-- between phase 1 and phase 2.
--
-- LESSONS OF 2026-10-14 APPLIED: (1) subjects are selected through partnerships.vendor_org_id (the
-- old partner_id was renamed in 079); (2) every "char" catalog column (tgenabled, provolatile,
-- confdeltype) is cast to text before || or comparison output; (3) NO TEMP TABLE AND NO pg_temp
-- FUNCTION: everything lives inside the one DO block; (4) the SQL Editor shows only the last
-- statement's result, so the final RAISE carries the whole result.
--
-- WHAT 118 MUST SHOW: an agency member of a paid lead agency inserts and reads its own record and
-- lines; is refused with another organization's project or as another organization; the D5 snapshot
-- (each frozen column refused after broadcast_at, each allowed column accepted, broadcast_at cannot
-- be cleared or changed, lines refused after broadcast_at and accepted before it, updated_at
-- maintained); the line guard (lead_org_id forced from the parent, rfp_id change refused); the
-- link-column guard (the vendor cannot set rfp_line_id or client_name_released on its own inbox
-- row, cannot get round it by repointing lead_org_id, and keeps its existing updates; the agency and
-- the service role link; a link to another organization's line or inbox row is refused); the vendor
-- allow-list on partner_rfp_inbox (rulings O1 and O2: F1's columns refused for a vendor after 118
-- and accepted before it, every app vendor write accepted, the claim accepted only for an unclaimed
-- row to the vendor's own org with claimed_at, a re-claim and claimed_at alone refused, the agency
-- unaffected); a vendor reads nothing of either table and writes nothing; anon nothing; no DELETE; D7 (deleting the
-- project of a sent record keeps the record with project_id NULL); the helper's answers and ACLs; no
-- TRUNCATE/REFERENCES/TRIGGER for authenticated; no policy, grant or trigger changed outside the
-- new tables and the five columns; existing inbox and token rows unchanged.
--
-- PHASES: phase 1 BEFORE 118 (the tables, columns and helper do not exist: those scenarios answer
-- MISSING), phase 2 AFTER 118. EVERY SCENARIO RUNS IN EVERY PHASE. A phase-1 mismatch is
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
--     "SAFE TO APPLY 118."       -> and only this. It may name INCONCLUSIVE-BY-DESIGN rows (below).
--     "DO NOT APPLY 118 YET."    -> INCONCLUSIVE or NO SUBJECT beyond the by-design rows.
--     "DO NOT APPLY 118."        -> an assertion FAILED, or the test is broken.
-- Rows read PASS, FAIL, INCONCLUSIVE, NOT DISCRIMINATING (same expectation in both phases, reported
-- as PASS with that note) or NO SUBJECT (reported as INCONCLUSIVE, never PASS).
--
-- EXPECTED COUNT: 87 scenarios + 9 self-checks + M = 97 assertions.
--
-- INCONCLUSIVE BY DESIGN: U1, U2 (a member of an UNPAID lead agency) and X1, X2 (a member of a
-- SECOND paid lead agency). m a r k a n t is the only lead organization with members today, so these
-- four report NO SUBJECT. C3 (a user outside o1 who belongs to TWO organizations, for the re-claim)
-- reports NO SUBJECT when no such user exists. They are not FAIL, and they are the only INCONCLUSIVE
-- rows the headline may carry and still read "SAFE TO APPLY 118.". If a subject exists for them,
-- they run and are judged like every other row.
--
-- NOT DISCRIMINATING BY DESIGN (same expectation before and after 118, reported as PASS with that
-- note): K3, K4, P1-P3 and C1 (the app's vendor writes, accepted both times), C2 (099 clause B
-- refuses before 118, rule (4) after), Y1 (the agency, accepted both times).
--
-- INFO LINE (not an assertion): inbox rows whose project belongs to another organization, and
-- unclaimed invitation rows that already carry a vendor_org_id. Both are expected to be 0; read
-- docs/rfp-record-a-report.md section 8g if either is not.
--
-- =====================================================================
-- THE SUBJECTS
-- =====================================================================
-- vendor : a member of a partnership's VENDOR ORGANIZATION (partnerships.vendor_org_id) who is not a
--          member of the lead organization, preferring one that holds an inbox row from it.
-- o1, p1 : that partnership's lead organization (a PAID LEAD AGENCY) and a project of it.
-- m1     : a member of o1, preferring a sole membership (so o1 is its acting organization), then
--          role owner. The agency actor.
-- inbox  : that vendor's partner_rfp_inbox row from o1 (vendor_org_id = the vendor's org).
-- tok    : an rfp_magic_tokens row of o1.
-- svc    : SET LOCAL ROLE service_role, no sub claim (auth.uid() NULL). The trusted path.
-- anon   : SET LOCAL ROLE anon.
-- unpaid : a sole member of a lead agency with is_paid not true. NO SUBJECT by design today.
-- other  : a sole member of a second paid lead agency. NO SUBJECT by design today.
-- oo     : "another organization" for foreign rows: the vendor's organization (or any other).
-- inbc   : a throwaway UNCLAIMED inbox row of o1 (vendor_org_id NULL) addressed to the vendor's
--          profile email (C1, C2, C5). No profile email: NO SUBJECT.
-- multi  : a user outside o1 who belongs to two organizations (oma, omb), the vendor first; inbm is
--          a throwaway inbox row of o1 claimed for oma (C3). NO SUBJECT by design if none exists.
-- px     : a project of another organization; if none exists a random id is used (reported).
-- Each scenario's SETUP runs as the table owner (no end-user session; the trusted path), with fixed
-- throwaway ids. IT IMPERSONATES AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE, then
-- auth.uid() and current_user are read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097. A fingerprint
-- of every partner_rfp_inbox, rfp_magic_tokens and projects row (and, once they exist, every
-- rfp_records and rfp_record_lines row) is compared after each.
--
-- RESULT CODES: OK:<value> (the scenario's one text value), MISSING (42P01 / 42703 / 42883: the
-- table, column or function does not exist, in the scenario or its setup), E:<sqlstate> (refused with
-- that code). LG118 is 118's own refusal code (D5, the line guard).
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * The SQL Editor role may SET ROLE service_role (Supabase grants it to postgres). If not, the svc
--     scenarios report TEST FAULT (INCONCLUSIVE), never PASS.
--   * D7 copies p1 into a throwaway project (jsonb_populate_record over projects) and deletes it as
--     the service role. If the copy fails the setup reports TEST FAULT. If the DELETE is refused with
--     E:23503, another table holds a NO ACTION key to projects that the copy filled in: a
--     test-environment fault, not 118's, but it is reported as FAIL until read.
--   * A BEFORE ROW trigger fires before the RLS WITH CHECK, so a D5 refusal reads LG118, not 42501.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 96;
  c_phases       CONSTANT integer := 2;
  c_by_design    CONSTANT text[]  := ARRAY['U1', 'U2', 'X1', 'X2', 'C3'];
  v_uv_email     text;
  v_um           uuid;
  v_oma          uuid;
  v_omb          uuid;
  v_inbc         uuid := gen_random_uuid();
  v_inbm         uuid := gen_random_uuid();
  v_info_xproj   text := 'unreadable';
  v_info_unclm   text := 'unreadable';
  v_o1           uuid;
  v_p1           uuid;
  v_u1           uuid;
  v_uv           uuid;
  v_ov           uuid;
  v_ps1          uuid;
  v_inbox        uuid;
  v_tok          text;
  v_px           uuid;
  v_px_real      boolean := true;
  v_oo           uuid;
  v_uu           uuid;
  v_ou           uuid;
  v_ux           uuid;
  v_ox           uuid;
  v_fallback     boolean := false;
  v_m1_entitled  text := 'not checked';
  v_rec          uuid := gen_random_uuid();
  v_rec2         uuid := gen_random_uuid();
  v_recx         uuid := gen_random_uuid();
  v_recu         uuid := gen_random_uuid();
  v_line         uuid := gen_random_uuid();
  v_linex        uuid := gen_random_uuid();
  v_ptmp         uuid := gen_random_uuid();
  v_inbx         uuid := gen_random_uuid();
  v_txt          text;
  v_actor        text;
  v_uid          uuid;
  v_ph           integer;
  v_i            integer;
  v_k            integer;
  v_idx          integer;
  v_parts        text[];
  v_need         text;
  v_nosubj       boolean;
  v_fp0          text;
  v_fp           text;
  v_fp_more      text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_pol_before   text;
  v_pol_after    text;
  v_acl_before   text;
  v_acl_after    text;
  v_rows_before  text;
  v_rows_after   text;
  v_trg_before   text;
  v_trg_after    text;
  v_link_rows    bigint;
  v_ok           boolean;
  v_detail       text;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_inconc_dsg   integer := 0;
  v_dsg_ids      text := '';
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
  v_all_nosubj   boolean;

  -- Isolation fingerprints. The first runs in both phases; the second only once 118's tables exist.
  v_fp_sql       CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id::text) FROM public.rfp_magic_tokens x), ''))
           || md5(coalesce((SELECT string_agg(x.id::text, ',' ORDER BY x.id) FROM public.projects x), ''))$f$;
  v_fp_new_sql   CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.rfp_records x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.rfp_record_lines x), ''))$f$;
  -- Every policy in public OUTSIDE the two new tables.
  v_pol_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                      E'\n' ORDER BY tablename, policyname), ''))
       FROM pg_policies WHERE schemaname = 'public' AND tablename NOT IN ('rfp_records', 'rfp_record_lines')$f$;
  -- Every table, column and function ACL in public OUTSIDE the new tables and the new functions.
  v_acl_sql      CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), E'\n' ORDER BY c.relname)
                             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
                               AND c.relname NOT IN ('rfp_records', 'rfp_record_lines')), ''))
           || md5(coalesce((SELECT string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, E'\n' ORDER BY c.relname, a.attname)
                             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped
                               AND c.relname NOT IN ('rfp_records', 'rfp_record_lines')), ''))
           || md5(coalesce((SELECT string_agg(p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, ''), E'\n' ORDER BY p.oid::regprocedure::text)
                             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public'
                               AND p.proname NOT IN ('current_user_entitled_lead_org_ids', 'rfp_records_guard', 'rfp_record_lines_guard',
                                                     'partner_rfp_inbox_link_columns_guard', 'rfp_magic_tokens_link_columns_guard')), ''))$f$;
  -- Every pre-118 column of every inbox and token row, so "existing rows unchanged" is exact.
  v_rows_sql     CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg((to_jsonb(x) - 'rfp_line_id' - 'client_name_released')::text, E'\n' ORDER BY x.id)
                             FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg((to_jsonb(x) - 'rfp_line_id' - 'attached_inbox_id' - 'client_name_released')::text, E'\n' ORDER BY x.id::text)
                             FROM public.rfp_magic_tokens x), ''))$f$;
  -- Every trigger already on the two linked tables (118's two excluded), with its function body.
  v_trg_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(c.relname || ':' || t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':'
                                      || p.oid::regprocedure::text || ':' || md5(p.prosrc), E'\n' ORDER BY c.relname, t.tgname), ''))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid IN ('public.partner_rfp_inbox'::regclass, 'public.rfp_magic_tokens'::regclass) AND NOT t.tgisinternal
         AND t.tgname NOT IN ('partner_rfp_inbox_link_columns_guard', 'rfp_magic_tokens_link_columns_guard')$f$;

  -- Setup fragments, run as the owner. format() arguments everywhere:
  --   %1$L p1  %2$L o1  %3$L rec  %4$L line  %5$L inbox  %6$L tok  %7$L px  %8$L ptmp
  --   %9$L inbx  %10$L oo  %11$L rec2  %12$L recx  %13$L linex  %14$L m1  %15$L ou  %16$L recu
  --   %17$L ov (the vendor's org)  %18$L inbc  %19$L vendor email  %20$L inbm  %21$L oma  %22$L omb
  s_rec   CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp, created_by, updated_at) VALUES (%3$L, %2$L, %1$L, 'wizard', '{"projectName": "LG118 test"}'::jsonb, %14$L, '2000-01-01T00:00:00Z');$s$;
  s_line  CONSTANT text := $s$INSERT INTO public.rfp_record_lines (id, rfp_id, scope_item_key, scope_item_name, estimated_budget) VALUES (%4$L, %3$L, 'LG118-1', 'LG118 line', '1000');$s$;
  s_sent  CONSTANT text := $s$UPDATE public.rfp_records SET broadcast_at = now() WHERE id = %3$L;$s$;
  s_link  CONSTANT text := $s$UPDATE public.partner_rfp_inbox SET rfp_line_id = %4$L WHERE id = %5$L;$s$;
  s_rec2  CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp) VALUES (%11$L, %2$L, %1$L, 'wizard', '{}'::jsonb);$s$;
  s_recx  CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp) VALUES (%12$L, %10$L, NULL, 'wizard', '{}'::jsonb); INSERT INTO public.rfp_record_lines (id, rfp_id, scope_item_key, scope_item_name) VALUES (%13$L, %12$L, 'LG118-X', 'LG118 other org line');$s$;
  s_inbx  CONSTANT text := $s$INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name) VALUES (%9$L, %10$L, 'lg118-test@example.invalid', 'LG118-X', 'LG118 other org row');$s$;
  s_recu  CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp) VALUES (%16$L, %15$L, NULL, 'wizard', '{}'::jsonb);$s$;
  s_inbc  CONSTANT text := $s$INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name) VALUES (%18$L, %2$L, %19$L, 'LG118-C', 'LG118 unclaimed row');$s$;
  s_inbm  CONSTANT text := $s$INSERT INTO public.partner_rfp_inbox (id, lead_org_id, vendor_org_id, scope_item_id, scope_item_name, claimed_at) VALUES (%20$L, %2$L, %21$L, 'LG118-M', 'LG118 claimed row', now());$s$;
  s_new   CONSTANT text := $s$UPDATE public.partner_rfp_inbox SET status = 'new' WHERE id = %5$L;$s$;
  s_ptmp  CONSTANT text := $s$INSERT INTO public.projects SELECT (jsonb_populate_record(NULL::public.projects, to_jsonb(p) || jsonb_build_object('id', %8$L::uuid, 'name', 'LG118 throwaway project'))).* FROM public.projects p WHERE p.id = %1$L; INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp) VALUES (%3$L, %2$L, %8$L, 'wizard', '{}'::jsonb); UPDATE public.rfp_records SET broadcast_at = now() WHERE id = %3$L;$s$;

  -- Scenario SQL shapes. Each returns ONE text value. '|NEXT|' separates statements run first.
  -- q_rec_upd takes the SET clause through %s; %%3$L survives the first format() as %3$L.
  q_rec_upd CONSTANT text := $q$WITH u AS (UPDATE public.rfp_records SET %s WHERE id = %%3$L RETURNING 1) SELECT count(*)::text FROM u$q$;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_needs  text[];
  sc_setup  text[];
  sc_sql    text[];
  sc_exp    text[];   -- flattened: (scenario - 1) * c_phases + phase; ' OR ' separates accepted values
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
  SELECT vm.user_id, vm.org_id, ps.id, ps.lead_org_id
    INTO v_uv, v_ov, v_ps1, v_o1
  FROM public.partnerships ps
  JOIN public.org_members vm ON vm.org_id = ps.vendor_org_id
  JOIN public.organizations lo ON lo.id = ps.lead_org_id
  WHERE ps.vendor_org_id IS NOT NULL
    AND lo.is_lead_agency IS TRUE AND lo.is_paid IS TRUE
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = ps.lead_org_id)
    AND EXISTS (SELECT 1 FROM public.projects pr WHERE pr.org_id = ps.lead_org_id)
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = vm.user_id AND x.org_id = ps.lead_org_id)
  ORDER BY (EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                    WHERE i.lead_org_id = ps.lead_org_id AND i.vendor_org_id = ps.vendor_org_id)) DESC,
           (EXISTS (SELECT 1 FROM public.rfp_magic_tokens t WHERE t.org_id = ps.lead_org_id)) DESC,
           ps.id, vm.user_id
  LIMIT 1;

  IF v_o1 IS NULL THEN
    v_fallback := true;
    SELECT pr.org_id INTO v_o1 FROM public.projects pr
    JOIN public.organizations o ON o.id = pr.org_id
    WHERE o.is_lead_agency IS TRUE AND o.is_paid IS TRUE
      AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = pr.org_id)
    ORDER BY pr.org_id LIMIT 1;
  END IF;

  IF v_o1 IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 118 YET.  NO SUBJECT: no paid lead agency has both a member and a project. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  IF v_ov IS NOT NULL THEN
    SELECT i.id INTO v_inbox FROM public.partner_rfp_inbox i
    WHERE i.lead_org_id = v_o1 AND i.vendor_org_id = v_ov
    ORDER BY i.created_at, i.id LIMIT 1;
  END IF;

  SELECT pr.id INTO v_p1 FROM public.projects pr WHERE pr.org_id = v_o1
  ORDER BY (pr.id IN (SELECT i.project_id FROM public.partner_rfp_inbox i WHERE i.id = v_inbox)) DESC, pr.id
  LIMIT 1;

  SELECT m.user_id INTO v_u1 FROM public.org_members m WHERE m.org_id = v_o1
  ORDER BY ((SELECT count(*) FROM public.org_members x WHERE x.user_id = m.user_id) = 1) DESC,
           (m.role = 'owner') DESC, m.user_id
  LIMIT 1;

  SELECT t.id::text INTO v_tok FROM public.rfp_magic_tokens t WHERE t.org_id = v_o1 ORDER BY t.id::text LIMIT 1;

  SELECT pr.id INTO v_px FROM public.projects pr WHERE pr.org_id IS DISTINCT FROM v_o1 ORDER BY pr.id LIMIT 1;
  IF v_px IS NULL THEN
    v_px := gen_random_uuid();
    v_px_real := false;
  END IF;

  v_oo := v_ov;
  IF v_oo IS NULL THEN
    SELECT o.id INTO v_oo FROM public.organizations o WHERE o.id <> v_o1 ORDER BY o.id LIMIT 1;
  END IF;

  SELECT m.user_id, m.org_id INTO v_uu, v_ou
  FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
  WHERE o.is_lead_agency IS TRUE AND o.is_paid IS NOT TRUE
    AND (SELECT count(*) FROM public.org_members x WHERE x.user_id = m.user_id) = 1
  ORDER BY m.org_id, m.user_id LIMIT 1;

  SELECT m.user_id, m.org_id INTO v_ux, v_ox
  FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
  WHERE o.is_lead_agency IS TRUE AND o.is_paid IS TRUE AND o.id <> v_o1
    AND (SELECT count(*) FROM public.org_members x WHERE x.user_id = m.user_id) = 1
  ORDER BY m.org_id, m.user_id LIMIT 1;

  -- The claim scenarios (C1, C2, C5) address a throwaway unclaimed row to the vendor's own profile
  -- email, so 099's recipient_email arm admits the vendor exactly as it admits a real invitee.
  SELECT nullif(btrim(p.email), '') INTO v_uv_email FROM public.profiles p WHERE p.id = v_uv;

  -- C3: a user outside o1 who belongs to two organizations (the vendor itself first). NO SUBJECT
  -- by design when nobody does.
  SELECT a.user_id, a.org_id, b.org_id INTO v_um, v_oma, v_omb
  FROM public.org_members a
  JOIN public.org_members b ON b.user_id = a.user_id AND b.org_id <> a.org_id
  WHERE NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = a.user_id AND x.org_id = v_o1)
  ORDER BY (a.user_id IS NOT DISTINCT FROM v_uv) DESC, (a.org_id IS NOT DISTINCT FROM v_ov) DESC,
           a.user_id, a.org_id, b.org_id
  LIMIT 1;

  -- INFO, NOT ASSERTIONS. (a) Inbox rows whose project belongs to another organization than the
  -- row's lead organization: deleting that project as its own members would SET NULL project_id
  -- under a session that rule (4) treats as a vendor, so the delete would be refused. (b) Unclaimed
  -- invitation rows that already carry a vendor_org_id: O2 admits no claim on them.
  BEGIN
    EXECUTE $c$SELECT count(*)::text FROM public.partner_rfp_inbox i JOIN public.projects p ON p.id = i.project_id
               WHERE p.org_id IS DISTINCT FROM i.lead_org_id$c$ INTO v_info_xproj;
  EXCEPTION WHEN OTHERS THEN v_info_xproj := 'unreadable (' || SQLSTATE || ')';
  END;
  BEGIN
    EXECUTE $c$SELECT count(*)::text FROM public.partner_rfp_inbox
               WHERE invite_token IS NOT NULL AND claimed_at IS NULL AND vendor_org_id IS NOT NULL$c$ INTO v_info_unclm;
  EXCEPTION WHEN OTHERS THEN v_info_unclm := 'unreadable (' || SQLSTATE || ')';
  END;

  ---------------------------------------------------------------------
  -- THE SCENARIOS. Parallel arrays; position i describes scenario i. sc_setup runs as the owner
  -- (may be several statements), sc_sql as the actor. sc_needs names the subjects a scenario needs
  -- beyond its actor (comma-separated: inbox, tok, oo); a missing one is NO SUBJECT.
  ---------------------------------------------------------------------
  sc_id := ARRAY['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9',
                 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14', 'F15',
                 'W1', 'W2', 'W3', 'W4', 'W5', 'B1', 'B2', 'L1', 'L2', 'G1', 'G2', 'G3',
                 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7',
                 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'K11', 'K12', 'K13', 'K14', 'K15', 'K16',
                 'N1', 'N2', 'N3', 'N4', 'H1', 'H2', 'D1', 'D2', 'D7', 'U1', 'U2', 'X1', 'X2',
                 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'P1', 'P2', 'P3', 'C1', 'C2', 'C3', 'C4', 'C5', 'Y1'];

  sc_label := ARRAY[
    $l$R1  agency: INSERT own record on own project$l$,
    $l$R2  agency: reads own record$l$,
    $l$R3  agency: INSERT line before broadcast, lead_org_id from parent$l$,
    $l$R4  agency: reads own line$l$,
    $l$R5  agency: INSERT refused with another org's project$l$,
    $l$R6  agency: INSERT refused as another organization$l$,
    $l$R7  agency: UPDATE onto another org's project refused$l$,
    $l$R8  agency: UPDATE line before broadcast accepted$l$,
    $l$R9  agency: sets broadcast_at (the last write)$l$,
    $l$F1  D5: source frozen after broadcast$l$,
    $l$F2  D5: project_id frozen (project still exists)$l$,
    $l$F3  D5: master_rfp frozen$l$,
    $l$F4  D5: evaluation_criteria frozen$l$,
    $l$F5  D5: budget_categories frozen$l$,
    $l$F6  D5: business_criteria_required frozen$l$,
    $l$F7  D5: output_template_config frozen$l$,
    $l$F8  D5: total_budget frozen$l$,
    $l$F9  D5: client_name_snapshot frozen$l$,
    $l$F10 D5: require_terms_disclosure frozen$l$,
    $l$F11 D5: nda_link frozen$l$,
    $l$F12 D5: created_by frozen (user still exists)$l$,
    $l$F13 D5: created_at frozen$l$,
    $l$F14 D5: backfill_note frozen$l$,
    $l$F15 lead_org_id immutable$l$,
    $l$W1  D5: show_client_to_vendors accepted after broadcast$l$,
    $l$W2  D5: response_deadline accepted after broadcast$l$,
    $l$W3  D5: close_bidding_at_deadline accepted$l$,
    $l$W4  D5: archived_at accepted after broadcast$l$,
    $l$W5  updated_at maintained by the trigger$l$,
    $l$B1  D5: broadcast_at cannot be cleared$l$,
    $l$B2  D5: broadcast_at cannot be changed$l$,
    $l$L1  D5: line INSERT refused after broadcast$l$,
    $l$L2  D5: line UPDATE refused after broadcast$l$,
    $l$G1  line guard: caller's lead_org_id replaced by parent's$l$,
    $l$G2  line guard: rfp_id change refused$l$,
    $l$G3  line guard: lead_org_id UPDATE forced to parent's$l$,
    $l$V1  vendor: reads 0 records$l$,
    $l$V2  vendor: reads 0 lines$l$,
    $l$V3  vendor: cannot INSERT a record$l$,
    $l$V4  vendor: cannot INSERT a line$l$,
    $l$V5  vendor: UPDATE of a record matches 0 rows$l$,
    $l$V6  vendor: UPDATE of a line matches 0 rows$l$,
    $l$V7  vendor: cannot DELETE a record$l$,
    $l$K1  link: vendor cannot set rfp_line_id on own inbox row$l$,
    $l$K2  link: vendor cannot set client_name_released$l$,
    $l$K3  link: vendor viewed_at update still accepted$l$,
    $l$K4  link: vendor partner_intent update still accepted$l$,
    $l$K5  link: vendor update of a LINKED row still accepted$l$,
    $l$K6  link: vendor reads the two new columns (NULL)$l$,
    $l$K7  link: vendor cannot repoint lead_org_id to pass$l$,
    $l$K8  link: agency links own inbox row to own line$l$,
    $l$K9  link: agency link to another org's line refused$l$,
    $l$K10 link: agency sets client_name_released$l$,
    $l$K11 link: agency sets token rfp_line_id$l$,
    $l$K12 link: agency sets token attached_inbox_id$l$,
    $l$K13 link: token attached to another org's inbox refused$l$,
    $l$K14 link: service role links inbox row to own line$l$,
    $l$K15 link: service role link to other org's line refused$l$,
    $l$K16 link: vendor cannot update a token$l$,
    $l$N1  anon: cannot read records$l$,
    $l$N2  anon: cannot read lines$l$,
    $l$N3  anon: cannot INSERT a record$l$,
    $l$N4  anon: cannot execute the helper$l$,
    $l$H1  helper: returns o1 for the agency member$l$,
    $l$H2  helper: returns nothing for the vendor$l$,
    $l$D1  agency: cannot DELETE a record$l$,
    $l$D2  agency: cannot DELETE a line$l$,
    $l$D7  D7: project delete keeps a sent record, project NULL$l$,
    $l$U1  unpaid lead agency: reads 0 of own org's records$l$,
    $l$U2  unpaid lead agency: cannot INSERT a record$l$,
    $l$X1  second lead agency: reads 0 of o1's records$l$,
    $l$X2  second lead agency: cannot INSERT as o1$l$,
    $l$A1  allow-list: vendor cannot change lead_org_id$l$,
    $l$A2  allow-list: vendor cannot replace master_rfp_json$l$,
    $l$A3  allow-list: vendor cannot change evaluation_criteria$l$,
    $l$A4  allow-list: vendor cannot change estimated_budget$l$,
    $l$A5  allow-list: vendor cannot change project_id$l$,
    $l$A6  allow-list: vendor cannot change scope_item_id$l$,
    $l$P1  allow-list: vendor first view (viewed_at) accepted$l$,
    $l$P2  allow-list: vendor NDA notice (agency_nda_notified_at)$l$,
    $l$P3  allow-list: vendor bid submit (status, updated_at)$l$,
    $l$C1  claim: unclaimed row to own org with claimed_at$l$,
    $l$C2  claim: to an org the vendor is not in refused$l$,
    $l$C3  claim: re-claim to the caller's other org refused$l$,
    $l$C4  claim: claimed_at alone on a claimed row refused$l$,
    $l$C5  claim: vendor_org_id without claimed_at refused$l$,
    $l$Y1  agency: non-allow-listed column still accepted$l$];

  sc_actor := ARRAY['m1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1',
                    'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1',
                    'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1',
                    'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor',
                    'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'svc', 'svc', 'vendor',
                    'anon', 'anon', 'anon', 'anon', 'm1', 'vendor', 'm1', 'm1', 'svc', 'unpaid', 'unpaid', 'other', 'other',
                    'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor',
                    'vendor', 'vendor', 'multi', 'vendor', 'vendor', 'm1'];

  sc_needs := ARRAY['', '', '', '', '', 'oo', '', '', '',
                    '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'oo',
                    '', '', '', '', '', '', '', '', '', 'oo', '', 'oo',
                    '', '', '', '', '', '', '',
                    'inbox', 'inbox', 'inbox', 'inbox', 'inbox', 'inbox', 'inbox,oo', 'inbox', 'inbox,oo', 'inbox', 'tok', 'tok,inbox', 'tok,oo', 'inbox', 'inbox,oo', '',
                    '', '', '', '', '', '', '', '', '', '', '', '', '',
                    'inbox,oo', 'inbox', 'inbox', 'inbox', 'inbox', 'inbox', 'inbox', 'inbox', 'inbox',
                    'vemail', 'vemail', '', 'inbox', 'vemail', 'inbox'];

  sc_setup := ARRAY[
    '', s_rec, s_rec, s_rec || s_line, '', '', s_rec, s_rec || s_line, s_rec || s_line,                     -- R1-R9
    s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, -- F1-F4
    s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, -- F5-F8
    s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, -- F9-F12
    s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent,                          -- F13-F15
    s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, s_rec || s_line || s_sent, -- W1-W4
    s_rec || s_line || s_sent,                                                                                -- W5
    s_rec || s_line || s_sent, s_rec || s_line || s_sent,                                                     -- B1-B2
    s_rec || s_line || s_sent, s_rec || s_line || s_sent,                                                     -- L1-L2
    s_rec, s_rec || s_line || s_rec2, s_rec || s_line,                                                        -- G1-G3
    s_rec, s_rec || s_line, '', s_rec, s_rec, s_rec || s_line, s_rec,                                         -- V1-V7
    s_rec || s_line, '', '', '', s_rec || s_line || s_link, '', '',                                           -- K1-K7
    s_rec || s_line, s_recx, '', s_rec || s_line, '', s_inbx, s_rec || s_line, s_recx, '',                    -- K8-K16
    '', '', '', '', '', '',                                                                                   -- N1-N4, H1-H2
    s_rec, s_rec || s_line, s_ptmp,                                                                           -- D1, D2, D7
    s_recu, '', s_rec, '',                                                                                    -- U1, U2, X1, X2
    '', '', '', '', '', '',                                                                                   -- A1-A6
    '', '', s_new,                                                                                            -- P1-P3
    s_inbc, s_inbc, s_inbm, '', s_inbc,                                                                       -- C1-C5
    ''];                                                                                                      -- Y1

  sc_sql := ARRAY[
    -- R1-R9
    $q$WITH i AS (INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp) VALUES (%2$L, %1$L, 'wizard', '{}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$SELECT count(*)::text FROM public.rfp_records WHERE id = %3$L$q$,
    $q$WITH i AS (INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name) VALUES (%3$L, 'LG118-R3', 'R3') RETURNING lead_org_id) SELECT (lead_org_id = %2$L::uuid)::text FROM i$q$,
    $q$SELECT count(*)::text FROM public.rfp_record_lines WHERE id = %4$L$q$,
    $q$WITH i AS (INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp) VALUES (%2$L, %7$L, 'wizard', '{}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp) VALUES (%10$L, NULL, 'wizard', '{}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i$q$,
    format(q_rec_upd, 'project_id = %7$L'),
    $q$WITH u AS (UPDATE public.rfp_record_lines SET scope_item_name = 'R8' WHERE id = %4$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    format(q_rec_upd, 'broadcast_at = now()'),
    -- F1-F15
    format(q_rec_upd, $v$source = 'backfill'$v$),
    format(q_rec_upd, 'project_id = NULL'),
    format(q_rec_upd, $v$master_rfp = '{"projectName": "changed"}'::jsonb$v$),
    format(q_rec_upd, $v$evaluation_criteria = '[]'::jsonb$v$),
    format(q_rec_upd, $v$budget_categories = '[]'::jsonb$v$),
    format(q_rec_upd, $v$business_criteria_required = '{"changed": true}'::jsonb$v$),
    format(q_rec_upd, $v$output_template_config = '{}'::jsonb$v$),
    format(q_rec_upd, $v$total_budget = 'changed'$v$),
    format(q_rec_upd, $v$client_name_snapshot = 'Changed client'$v$),
    format(q_rec_upd, 'require_terms_disclosure = false'),
    format(q_rec_upd, $v$nda_link = 'https://example.invalid/nda'$v$),
    format(q_rec_upd, 'created_by = NULL'),
    format(q_rec_upd, $v$created_at = created_at - interval '1 day'$v$),
    format(q_rec_upd, $v$backfill_note = 'changed'$v$),
    format(q_rec_upd, 'lead_org_id = %10$L'),
    -- W1-W5
    format(q_rec_upd, 'show_client_to_vendors = true'),
    format(q_rec_upd, $v$response_deadline = now() + interval '7 days'$v$),
    format(q_rec_upd, 'close_bidding_at_deadline = true'),
    format(q_rec_upd, 'archived_at = now()'),
    $q$WITH b AS (SELECT updated_at AS t FROM public.rfp_records WHERE id = %3$L), u AS (UPDATE public.rfp_records SET show_client_to_vendors = true WHERE id = %3$L RETURNING updated_at) SELECT coalesce(string_agg((u.updated_at > b.t)::text, ','), 'NONE') FROM u, b$q$,
    -- B1-B2
    format(q_rec_upd, 'broadcast_at = NULL'),
    format(q_rec_upd, $v$broadcast_at = broadcast_at + interval '1 hour'$v$),
    -- L1-L2
    $q$WITH i AS (INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name) VALUES (%3$L, 'LG118-L1', 'L1') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH u AS (UPDATE public.rfp_record_lines SET scope_item_name = 'L2' WHERE id = %4$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    -- G1-G3
    $q$WITH i AS (INSERT INTO public.rfp_record_lines (rfp_id, lead_org_id, scope_item_key, scope_item_name) VALUES (%3$L, %10$L, 'LG118-G1', 'G1') RETURNING lead_org_id) SELECT (lead_org_id = %2$L::uuid)::text FROM i$q$,
    $q$WITH u AS (UPDATE public.rfp_record_lines SET rfp_id = %11$L WHERE id = %4$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.rfp_record_lines SET lead_org_id = %10$L WHERE id = %4$L RETURNING lead_org_id) SELECT coalesce(string_agg((lead_org_id = %2$L::uuid)::text, ','), 'NONE') FROM u$q$,
    -- V1-V7
    $q$SELECT count(*)::text FROM public.rfp_records WHERE id = %3$L$q$,
    $q$SELECT count(*)::text FROM public.rfp_record_lines WHERE id = %4$L$q$,
    $q$WITH i AS (INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp) VALUES (%2$L, NULL, 'wizard', '{}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name) VALUES (%3$L, 'LG118-V4', 'V4') RETURNING 1) SELECT count(*)::text FROM i$q$,
    format(q_rec_upd, 'show_client_to_vendors = true'),
    $q$WITH u AS (UPDATE public.rfp_record_lines SET scope_item_name = 'V6' WHERE id = %4$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH d AS (DELETE FROM public.rfp_records WHERE id = %3$L RETURNING 1) SELECT count(*)::text FROM d$q$,
    -- K1-K7 (vendor)
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET rfp_line_id = %4$L WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET client_name_released = 'Client' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET viewed_at = coalesce(viewed_at, now()) WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET partner_intent = 'will_respond', intent_set_at = now() WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET viewed_at = now() WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT coalesce(rfp_line_id::text, 'NULL') || '|' || coalesce(client_name_released, 'NULL') FROM public.partner_rfp_inbox WHERE id = %5$L$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET lead_org_id = %10$L, client_name_released = 'Client' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    -- K8-K16
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET rfp_line_id = %4$L WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET rfp_line_id = %13$L WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET client_name_released = 'Client' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.rfp_magic_tokens SET rfp_line_id = %4$L WHERE id::text = %6$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.rfp_magic_tokens SET attached_inbox_id = %5$L WHERE id::text = %6$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.rfp_magic_tokens SET attached_inbox_id = %9$L WHERE id::text = %6$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET rfp_line_id = %4$L WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET rfp_line_id = %13$L WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.rfp_magic_tokens SET client_name_released = 'Client' WHERE org_id = %2$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    -- N1-N4
    $q$SELECT count(*)::text FROM public.rfp_records$q$,
    $q$SELECT count(*)::text FROM public.rfp_record_lines$q$,
    $q$WITH i AS (INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp) VALUES (%2$L, NULL, 'wizard', '{}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$SELECT count(*)::text FROM public.current_user_entitled_lead_org_ids()$q$,
    -- H1-H2
    $q$SELECT count(*)::text FROM public.current_user_entitled_lead_org_ids() AS s(id) WHERE s.id = %2$L::uuid$q$,
    $q$SELECT count(*)::text FROM public.current_user_entitled_lead_org_ids()$q$,
    -- D1, D2, D7
    $q$WITH d AS (DELETE FROM public.rfp_records WHERE id = %3$L RETURNING 1) SELECT count(*)::text FROM d$q$,
    $q$WITH d AS (DELETE FROM public.rfp_record_lines WHERE id = %4$L RETURNING 1) SELECT count(*)::text FROM d$q$,
    $q$DELETE FROM public.projects WHERE id = %8$L|NEXT|SELECT coalesce((SELECT coalesce(project_id::text, 'NULL') FROM public.rfp_records WHERE id = %3$L), 'GONE')$q$,
    -- U1, U2, X1, X2
    $q$SELECT count(*)::text FROM public.rfp_records WHERE id = %16$L$q$,
    $q$WITH i AS (INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp) VALUES (%15$L, NULL, 'wizard', '{}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$SELECT count(*)::text FROM public.rfp_records WHERE id = %3$L$q$,
    $q$WITH i AS (INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp) VALUES (%2$L, NULL, 'wizard', '{}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i$q$,
    -- A1-A6 (vendor, own claimed row: F1's columns)
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET lead_org_id = %10$L WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET master_rfp_json = '{"lg118": "replaced by a vendor"}'::jsonb WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET master_rfp_json = coalesce(master_rfp_json, '{}'::jsonb) || '{"evaluation_criteria": [{"name": "LG118 vendor rubric", "weight": 100}]}'::jsonb WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET estimated_budget = 'LG118 vendor budget' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET project_id = CASE WHEN project_id IS NULL THEN %1$L::uuid ELSE NULL END WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET scope_item_id = 'LG118-vendor-scope' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    -- P1-P3 (vendor, the O1 writes exactly as the routes make them; K4 is the intent route's)
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET viewed_at = now() WHERE id = %5$L AND vendor_org_id = %17$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET agency_nda_notified_at = now(), updated_at = now() WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET status = 'bid_submitted', updated_at = now() WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    -- C1-C5 (the claim, O2; C1 is claim/route.ts:76-84 exactly)
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET vendor_org_id = %17$L, claimed_at = now(), updated_at = now() WHERE id = %18$L AND claimed_at IS NULL RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET vendor_org_id = %2$L, claimed_at = now(), updated_at = now() WHERE id = %18$L AND claimed_at IS NULL RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET vendor_org_id = %22$L, claimed_at = now(), updated_at = now() WHERE id = %20$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET claimed_at = coalesce(claimed_at, now()) - interval '1 day' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET vendor_org_id = %17$L, updated_at = now() WHERE id = %18$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    -- Y1 (agency member, a column outside the vendor allow-list)
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET estimated_budget = 'LG118 agency budget' WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$];

  sc_exp := ARRAY[
    'MISSING', 'OK:1',                     -- R1
    'MISSING', 'OK:1',                     -- R2
    'MISSING', 'OK:true',                  -- R3
    'MISSING', 'OK:1',                     -- R4
    'MISSING', 'E:42501',                  -- R5
    'MISSING', 'E:42501',                  -- R6
    'MISSING', 'E:42501',                  -- R7
    'MISSING', 'OK:1',                     -- R8
    'MISSING', 'OK:1',                     -- R9
    'MISSING', 'E:LG118',                  -- F1
    'MISSING', 'E:LG118',                  -- F2
    'MISSING', 'E:LG118',                  -- F3
    'MISSING', 'E:LG118',                  -- F4
    'MISSING', 'E:LG118',                  -- F5
    'MISSING', 'E:LG118',                  -- F6
    'MISSING', 'E:LG118',                  -- F7
    'MISSING', 'E:LG118',                  -- F8
    'MISSING', 'E:LG118',                  -- F9
    'MISSING', 'E:LG118',                  -- F10
    'MISSING', 'E:LG118',                  -- F11
    'MISSING', 'E:LG118',                  -- F12
    'MISSING', 'E:LG118',                  -- F13
    'MISSING', 'E:LG118',                  -- F14
    'MISSING', 'E:LG118',                  -- F15
    'MISSING', 'OK:1',                     -- W1
    'MISSING', 'OK:1',                     -- W2
    'MISSING', 'OK:1',                     -- W3
    'MISSING', 'OK:1',                     -- W4
    'MISSING', 'OK:true',                  -- W5
    'MISSING', 'E:LG118',                  -- B1
    'MISSING', 'E:LG118',                  -- B2
    'MISSING', 'E:LG118',                  -- L1
    'MISSING', 'E:LG118',                  -- L2
    'MISSING', 'OK:true',                  -- G1
    'MISSING', 'E:LG118',                  -- G2
    'MISSING', 'OK:true',                  -- G3
    'MISSING', 'OK:0',                     -- V1
    'MISSING', 'OK:0',                     -- V2
    'MISSING', 'E:42501',                  -- V3
    'MISSING', 'E:LG118 OR E:42501',       -- V4 (the line guard cannot see the parent, or RLS)
    'MISSING', 'OK:0',                     -- V5
    'MISSING', 'OK:0',                     -- V6
    'MISSING', 'E:42501',                  -- V7
    'MISSING', 'E:42501',                  -- K1
    'MISSING', 'E:42501',                  -- K2
    'OK:1', 'OK:1',                        -- K3
    'OK:1', 'OK:1',                        -- K4
    'MISSING', 'OK:1',                     -- K5
    'MISSING', 'OK:NULL|NULL',             -- K6
    'MISSING', 'E:42501',                  -- K7
    'MISSING', 'OK:1',                     -- K8
    'MISSING', 'E:23514',                  -- K9
    'MISSING', 'OK:1',                     -- K10
    'MISSING', 'OK:1',                     -- K11
    'MISSING', 'OK:1',                     -- K12
    'MISSING', 'E:23514',                  -- K13
    'MISSING', 'OK:1',                     -- K14
    'MISSING', 'E:23514',                  -- K15
    'MISSING OR E:42501', 'OK:0 OR E:42501', -- K16
    'MISSING OR E:42501', 'E:42501',       -- N1
    'MISSING OR E:42501', 'E:42501',       -- N2
    'MISSING OR E:42501', 'E:42501',       -- N3
    'MISSING OR E:42501', 'E:42501',       -- N4
    'MISSING', 'OK:1',                     -- H1
    'MISSING', 'OK:0',                     -- H2
    'MISSING', 'E:42501',                  -- D1
    'MISSING', 'E:42501',                  -- D2
    'MISSING', 'OK:NULL',                  -- D7
    'MISSING', 'OK:0',                     -- U1
    'MISSING', 'E:42501',                  -- U2
    'MISSING', 'OK:0',                     -- X1
    'MISSING', 'E:42501',                  -- X2
    'OK:1', 'E:42501',                     -- A1 (F1 open before 118, closed after)
    'OK:1', 'E:42501',                     -- A2
    'OK:1', 'E:42501',                     -- A3
    'OK:1', 'E:42501',                     -- A4
    'OK:1', 'E:42501',                     -- A5
    'OK:1', 'E:42501',                     -- A6
    'OK:1', 'OK:1',                        -- P1
    'OK:1', 'OK:1',                        -- P2
    'OK:1', 'OK:1',                        -- P3
    'OK:1', 'OK:1',                        -- C1
    'E:42501', 'E:42501',                  -- C2 (099 clause B before, rule (4) after)
    'OK:1', 'E:42501',                     -- C3 (the 099:783-790 gap)
    'OK:1', 'E:42501',                     -- C4
    'OK:1', 'E:42501',                     -- C5
    'OK:1', 'OK:1'];                       -- Y1

  v_n := array_length(sc_id, 1);
  IF v_n <> 87 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_needs, 1) <> v_n OR array_length(sc_setup, 1) <> v_n
     OR array_length(sc_sql, 1) <> v_n OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (ids %, labels %, actors %, needs %, setups %, sqls %, expectations %)',
      v_n, array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_needs, 1),
      array_length(sc_setup, 1), array_length(sc_sql, 1), array_length(sc_exp, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  EXECUTE v_pol_sql  INTO v_pol_before;
  EXECUTE v_acl_sql  INTO v_acl_before;
  EXECUTE v_rows_sql INTO v_rows_before;
  EXECUTE v_trg_sql  INTO v_trg_before;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 118 is executed between phases.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    EXECUTE v_fp_sql INTO v_fp0;
    IF to_regclass('public.rfp_records') IS NOT NULL THEN
      EXECUTE v_fp_new_sql INTO v_fp_more;
      v_fp0 := v_fp0 || v_fp_more;
    END IF;

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];
      v_uid := CASE v_actor WHEN 'm1' THEN v_u1 WHEN 'vendor' THEN v_uv WHEN 'unpaid' THEN v_uu WHEN 'other' THEN v_ux
                            WHEN 'multi' THEN v_um ELSE NULL END;

      v_nosubj := v_p1 IS NULL
               OR (v_actor IN ('m1', 'vendor', 'unpaid', 'other', 'multi') AND v_uid IS NULL);
      FOREACH v_need IN ARRAY string_to_array(sc_needs[v_i], ',') LOOP
        IF (v_need = 'inbox' AND v_inbox IS NULL) OR (v_need = 'tok' AND v_tok IS NULL) OR (v_need = 'oo' AND v_oo IS NULL)
           OR (v_need = 'vemail' AND v_uv_email IS NULL) THEN
          v_nosubj := true;
        END IF;
      END LOOP;
      IF sc_actor[v_i] = 'unpaid' AND v_ou IS NULL THEN v_nosubj := true; END IF;
      IF sc_actor[v_i] = 'other' AND v_ox IS NULL THEN v_nosubj := true; END IF;

      IF v_nosubj THEN
        r_cls[v_idx] := 'NOSUBJECT';
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          -- SETUP, as the owner. A missing object is MISSING; anything else is a TEST FAULT.
          IF sc_setup[v_i] <> '' THEN
            BEGIN
              EXECUTE format(sc_setup[v_i], v_p1, v_o1, v_rec, v_line, v_inbox, v_tok, v_px, v_ptmp,
                             v_inbx, v_oo, v_rec2, v_recx, v_linex, v_u1, v_ou, v_recu,
                             v_ov, v_inbc, v_uv_email, v_inbm, v_oma, v_omb);
            EXCEPTION WHEN OTHERS THEN
              IF SQLSTATE IN ('42P01', '42703', '42883') THEN
                RAISE EXCEPTION 'setup: object missing' USING ERRCODE = 'LG096';
              ELSE
                RAISE EXCEPTION 'setup failed (%): %', SQLSTATE, left(SQLERRM, 140) USING ERRCODE = 'LG098';
              END IF;
            END;
          END IF;

          -- IMPERSONATION, proved.
          BEGIN
            IF v_actor = 'anon' THEN
              SET LOCAL ROLE anon;
              IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
                RAISE EXCEPTION 'impersonation mismatch (anon): current_user is %, uid %', current_user, auth.uid();
              END IF;
            ELSIF v_actor = 'svc' THEN
              PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
              SET LOCAL ROLE service_role;
              IF current_user <> 'service_role' OR auth.uid() IS NOT NULL THEN
                RAISE EXCEPTION 'impersonation mismatch (svc): current_user is %, uid %', current_user, auth.uid();
              END IF;
            ELSE
              PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
              PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
              SET LOCAL ROLE authenticated;
              IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_uid THEN
                RAISE EXCEPTION 'impersonation mismatch (%): auth.uid() is %, expected %', v_actor, auth.uid(), v_uid;
              END IF;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'impersonation failed (%): %', SQLSTATE, left(SQLERRM, 140) USING ERRCODE = 'LG098';
          END;

          v_parts := string_to_array(
            format(sc_sql[v_i], v_p1, v_o1, v_rec, v_line, v_inbox, v_tok, v_px, v_ptmp,
                   v_inbx, v_oo, v_rec2, v_recx, v_linex, v_u1, v_ou, v_recu,
                   v_ov, v_inbc, v_uv_email, v_inbm, v_oma, v_omb),
            '|NEXT|');
          FOR v_k IN 1 .. array_length(v_parts, 1) - 1 LOOP
            EXECUTE v_parts[v_k];
          END LOOP;
          EXECUTE v_parts[array_length(v_parts, 1)] INTO v_txt;
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
              WHEN SQLSTATE IN ('LG096', '42P01', '42703', '42883') THEN 'MISSING'
              ELSE 'E:' || SQLSTATE
            END;
        END;
      END IF;

      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      EXECUTE v_fp_sql INTO v_fp;
      IF to_regclass('public.rfp_records') IS NOT NULL THEN
        EXECUTE v_fp_new_sql INTO v_fp_more;
        v_fp := v_fp || v_fp_more;
      END IF;
      v_iso_runs := v_iso_runs + 1;
      IF v_fp IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc_id[v_i] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;

    -- The migration code, executed between phases, in this transaction, as the owner.
    IF v_ph = 1 THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      BEGIN
        EXECUTE $m118$
-- >>> 118 BODY START
-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.partner_rfp_inbox') IS NULL OR to_regclass('public.rfp_magic_tokens') IS NULL
     OR to_regclass('public.organizations') IS NULL OR to_regclass('public.org_members') IS NULL
     OR to_regclass('public.projects') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION '118 refuses to apply: one of partner_rfp_inbox, rfp_magic_tokens, organizations, org_members, projects, profiles does not exist.'
      USING ERRCODE = 'LG118';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '118 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG118';
  END IF;

  -- The columns the helper and the guards read. 079 (lead_org_id, org_id, is_lead_agency),
  -- 090 (active_org_id), 092 (is_paid).
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'organizations'     AND column_name IN ('is_lead_agency', 'is_paid'))
           OR (table_name = 'profiles'          AND column_name = 'active_org_id')
           OR (table_name = 'org_members'       AND column_name IN ('org_id', 'user_id'))
           OR (table_name = 'partner_rfp_inbox' AND column_name = 'lead_org_id')
           OR (table_name = 'rfp_magic_tokens'  AND column_name = 'org_id')
           OR (table_name = 'projects'          AND column_name = 'org_id'))) <> 8 THEN
    RAISE EXCEPTION '118 refuses to apply: a column it reads is missing (organizations.is_lead_agency/is_paid, profiles.active_org_id, org_members.org_id/user_id, partner_rfp_inbox.lead_org_id, rfp_magic_tokens.org_id, projects.org_id).'
      USING ERRCODE = 'LG118';
  END IF;

  IF to_regclass('public.rfp_records') IS NOT NULL OR to_regclass('public.rfp_record_lines') IS NOT NULL
     OR to_regprocedure('public.current_user_entitled_lead_org_ids()') IS NOT NULL THEN
    RAISE EXCEPTION '118 refuses to apply: rfp_records, rfp_record_lines or current_user_entitled_lead_org_ids() already exists. Read the schema before going further.'
      USING ERRCODE = 'LG118';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid IN ('public.partner_rfp_inbox'::regclass, 'public.rfp_magic_tokens'::regclass)
               AND a.attname IN ('rfp_line_id', 'client_name_released', 'attached_inbox_id')
               AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '118 refuses to apply: a link column already exists on partner_rfp_inbox or rfp_magic_tokens. A drifted column must not be skipped silently.'
      USING ERRCODE = 'LG118';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE HELPER. D1: the G1 rule, at the database.
--
-- MIRRORS lib/entitlements.ts resolveAgencyGate() (:556-629) EXACTLY, step by step:
--   a. The ACTING organization, as lib/acting-org.ts resolveActingOrgId() (:226-272) resolves it:
--      the caller's memberships from org_members (loadMemberOrgIds, :161-178); exactly one
--      membership -> that one (:243-245); more than one -> profiles.active_org_id, used ONLY if it
--      names one of those memberships (:247-271); no preference, or a preference outside the set ->
--      nothing (fails closed). No membership -> nothing.
--   b. That organization must have is_lead_agency = true (:613) AND is_paid = true (:619). A NULL
--      flag is not a grant (`IS TRUE`, the SQL form of `=== true`).
--   NOT MIRRORED, BY NECESSITY: isDemoDeployment() (NEXT_PUBLIC_IS_DEMO, :557) is an environment
--   variable the database cannot see. On a demo deployment the routes admit everyone and these
--   policies admit only entitled lead agencies, so a demo caller who is not one gets an empty
--   record set and the step A writes fail closed. The demo deployment is not production.
--
-- Returns zero or one row. SECURITY DEFINER because policies call it and org_members / profiles /
-- organizations carry their own RLS (the 079 PHASE 3 reason). STABLE, no parameters, reads
-- auth.uid() only, so no caller can ask about anybody but themselves.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.current_user_entitled_lead_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH memberships AS (
    SELECT m.org_id
    FROM public.org_members m
    WHERE m.user_id = auth.uid()
  ),
  acting AS (
    SELECT ms.org_id
    FROM memberships ms
    WHERE (SELECT count(*) FROM memberships) = 1
    UNION
    SELECT ms.org_id
    FROM memberships ms
    JOIN public.profiles p ON p.id = auth.uid() AND p.active_org_id = ms.org_id
    WHERE (SELECT count(*) FROM memberships) > 1
  )
  SELECT o.id
  FROM public.organizations o
  JOIN acting a ON a.org_id = o.id
  WHERE o.is_lead_agency IS TRUE
    AND o.is_paid IS TRUE;
$$;

COMMENT ON FUNCTION public.current_user_entitled_lead_org_ids() IS
  'Migration 118 (ruling D1). The caller''s ACTIVE organization when it is a paid lead agency: the G1 '
  'rule of lib/entitlements.ts resolveAgencyGate() at the database. Acting organization = the sole '
  'membership, or profiles.active_org_id when it names one of several; then is_lead_agency AND is_paid. '
  'Zero or one row. The demo-deployment bypass is not mirrored (an environment variable). Change this '
  'and resolveAgencyGate() together or not at all.';

REVOKE EXECUTE ON FUNCTION public.current_user_entitled_lead_org_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_entitled_lead_org_ids() FROM anon;
GRANT  EXECUTE ON FUNCTION public.current_user_entitled_lead_org_ids() TO authenticated;


-- ---------------------------------------------------------------------
-- 2. THE TABLES. Design section 1, with the two ON DELETE adjustments named in the header.
-- ---------------------------------------------------------------------
CREATE TABLE public.rfp_records (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_org_id                uuid        NOT NULL REFERENCES public.organizations (id),
  project_id                 uuid        REFERENCES public.projects (id) ON DELETE SET NULL,
  source                     text        NOT NULL CHECK (source IN ('wizard', 'magic_link', 'backfill')),
  master_rfp                 jsonb       NOT NULL,
  evaluation_criteria        jsonb,
  budget_categories          jsonb,
  business_criteria_required jsonb       NOT NULL DEFAULT '{}'::jsonb,
  output_template_config     jsonb,
  total_budget               text,
  show_client_to_vendors     boolean     NOT NULL DEFAULT false,
  client_name_snapshot       text,
  response_deadline          timestamptz,
  close_bidding_at_deadline  boolean     NOT NULL DEFAULT false,
  require_terms_disclosure   boolean     NOT NULL DEFAULT true,
  nda_link                   text,
  broadcast_at               timestamptz,
  archived_at                timestamptz,
  created_by                 uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  backfill_note              text
);

CREATE INDEX rfp_records_lead_org_id_idx ON public.rfp_records (lead_org_id);
CREATE INDEX rfp_records_project_id_idx  ON public.rfp_records (project_id);

COMMENT ON TABLE public.rfp_records IS
  'Migration 118. The agency''s own record of an RFP, one row per broadcast send (D4): the master as '
  'broadcast, the rubric, budget categories, requirements, output template (D9), and the per-RFP '
  'client toggle (D3, default hidden). AGENCY-ONLY: no vendor policy, no anon policy, no DELETE policy '
  '(archive, never delete). RLS admits members of a PAID LEAD AGENCY only (D1). A SNAPSHOT once '
  'broadcast_at is set (D5, rfp_records_guard). Write order: record, lines, vendor rows, broadcast_at LAST.';

COMMENT ON COLUMN public.rfp_records.show_client_to_vendors IS
  'Ruling D3: default false. Vendors cannot read this table; the decision reaches them through '
  'partner_rfp_inbox.client_name_released and rfp_magic_tokens.client_name_released (step B/C).';

COMMENT ON COLUMN public.rfp_records.broadcast_at IS
  'Set LAST, once every send succeeded. NULL = an unsent draft. Once set it cannot be cleared or '
  'changed, and only show_client_to_vendors, response_deadline, close_bidding_at_deadline and '
  'archived_at may change (D5).';

CREATE TABLE public.rfp_record_lines (
  id                     uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rfp_id                 uuid    NOT NULL REFERENCES public.rfp_records (id) ON DELETE CASCADE,
  lead_org_id            uuid    NOT NULL,
  scope_item_key         text    NOT NULL,
  scope_item_name        text    NOT NULL,
  scope_item_description text,
  estimated_budget       text,
  released_budget        text,
  sort_order             integer NOT NULL DEFAULT 0,
  UNIQUE (rfp_id, scope_item_key)
);

CREATE INDEX rfp_record_lines_lead_org_id_idx ON public.rfp_record_lines (lead_org_id);

COMMENT ON TABLE public.rfp_record_lines IS
  'Migration 118. One row per scope line of an rfp_records row. lead_org_id is copied from the parent '
  'by rfp_record_lines_guard, never taken from the caller. rfp_id cannot change. No insert or update '
  'once the parent''s broadcast_at is set (D5). AGENCY-ONLY, paid lead agency only (D1).';

COMMENT ON COLUMN public.rfp_record_lines.released_budget IS
  'Ruling D2: what this line''s vendors may see. NULL = hidden, the default for new RFPs. The 119 '
  'backfill sets it to estimated_budget for RFPs already broadcast, so bids in progress keep their number.';


-- ---------------------------------------------------------------------
-- 3. rfp_records_guard. lead_org_id immutable; D5 snapshot; updated_at maintained.
--
-- SECURITY DEFINER FOR ONE REASON: the D7 exception must know whether the referenced project (and
-- for created_by, the auth user) still EXISTS, and an invoker-rights read would answer "no" for a
-- row the caller merely cannot see. It reads existence by primary key and nothing else, writes
-- nothing but NEW, and EXECUTE is revoked from everyone. It RAISES, never silently reverts.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.rfp_records_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- The D5 allow-list. Everything else is frozen once broadcast_at is set, including any column
  -- added to this table later.
  v_skip    text[] := ARRAY['show_client_to_vendors', 'response_deadline', 'close_bidding_at_deadline',
                            'archived_at', 'updated_at'];
  v_changed text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
    RAISE EXCEPTION 'An RFP record cannot move to another organization.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_records.lead_org_id is immutable after insert (migration 118).';
  END IF;

  IF OLD.broadcast_at IS NOT NULL THEN
    IF NEW.broadcast_at IS DISTINCT FROM OLD.broadcast_at THEN
      RAISE EXCEPTION 'This RFP has been sent. Its send time cannot be cleared or changed.'
        USING ERRCODE = 'LG118',
              DETAIL  = 'rfp_records.broadcast_at is fixed once set (migration 118, ruling D5).';
    END IF;

    -- D7: the foreign key's own ON DELETE SET NULL, and nothing that merely resembles it.
    IF OLD.project_id IS NOT NULL AND NEW.project_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
      v_skip := array_append(v_skip, 'project_id');
    END IF;
    IF OLD.created_by IS NOT NULL AND NEW.created_by IS NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.created_by) THEN
      v_skip := array_append(v_skip, 'created_by');
    END IF;

    SELECT string_agg(o.key, ', ' ORDER BY o.key)
      INTO v_changed
      FROM jsonb_each(to_jsonb(OLD) - v_skip) o
      LEFT JOIN jsonb_each(to_jsonb(NEW) - v_skip) n ON n.key = o.key
     WHERE n.value IS DISTINCT FROM o.value;

    IF v_changed IS NOT NULL THEN
      RAISE EXCEPTION 'This RFP has been sent and is a snapshot. Only the client toggle, the response deadline, closing at the deadline and archiving can change.'
        USING ERRCODE = 'LG118',
              DETAIL  = format('rfp_records columns frozen after broadcast_at (migration 118, ruling D5): %s', v_changed);
    END IF;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rfp_records_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on rfp_records, every caller including the service role: '
  'lead_org_id immutable; once broadcast_at is set it cannot change and only show_client_to_vendors, '
  'response_deadline, close_bidding_at_deadline, archived_at (and updated_at, set here) may change, '
  'except project_id / created_by going NULL through their ON DELETE SET NULL keys (D7). LG118.';

CREATE TRIGGER rfp_records_guard
  BEFORE INSERT OR UPDATE ON public.rfp_records
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_records_guard();

REVOKE EXECUTE ON FUNCTION public.rfp_records_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_records_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_records_guard() FROM authenticated;


-- ---------------------------------------------------------------------
-- 4. rfp_record_lines_guard. lead_org_id from the parent; rfp_id pinned; D5 for lines.
--
-- 109's shape: plpgsql, SECURITY INVOKER, the parent read under the CALLER's row level security, so
-- a caller who cannot see the record cannot attach a line to it.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.rfp_record_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead  uuid;
  v_sent  timestamptz;
  v_found boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rfp_id IS DISTINCT FROM OLD.rfp_id THEN
    RAISE EXCEPTION 'A scope line cannot move to another RFP record.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_record_lines.rfp_id is fixed after insert (migration 118).';
  END IF;

  SELECT r.lead_org_id, r.broadcast_at, true
    INTO v_lead, v_sent, v_found
    FROM public.rfp_records r
   WHERE r.id = NEW.rfp_id;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'That RFP record does not exist or is not yours.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_record_lines.rfp_id must be an rfp_records row the caller can see (migration 118).';
  END IF;

  IF v_sent IS NOT NULL THEN
    RAISE EXCEPTION 'This RFP has been sent and is a snapshot. Its scope lines cannot change.'
      USING ERRCODE = 'LG118',
            DETAIL  = 'rfp_record_lines of a record with broadcast_at set are frozen (migration 118, ruling D5). Insert lines before setting broadcast_at.';
  END IF;

  -- The caller's value is ignored on every write. The parent decides.
  NEW.lead_org_id := v_lead;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rfp_record_lines_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on rfp_record_lines, every caller: lead_org_id is set from '
  'the parent rfp_records row (read under the caller''s RLS), rfp_id cannot change, and no line of a '
  'record whose broadcast_at is set may be inserted or updated (D5). LG118.';

CREATE TRIGGER rfp_record_lines_guard
  BEFORE INSERT OR UPDATE ON public.rfp_record_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_record_lines_guard();

REVOKE EXECUTE ON FUNCTION public.rfp_record_lines_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_record_lines_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_record_lines_guard() FROM authenticated;


-- ---------------------------------------------------------------------
-- 5. PRIVILEGES. 113/114 posture: anon nothing, by name; authenticated SELECT, INSERT, UPDATE only
--    (no DELETE, TRUNCATE, REFERENCES, TRIGGER); service_role ALL.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.rfp_records      FROM PUBLIC;
REVOKE ALL ON TABLE public.rfp_records      FROM anon;
REVOKE ALL ON TABLE public.rfp_records      FROM authenticated;
REVOKE ALL ON TABLE public.rfp_record_lines FROM PUBLIC;
REVOKE ALL ON TABLE public.rfp_record_lines FROM anon;
REVOKE ALL ON TABLE public.rfp_record_lines FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rfp_records      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rfp_record_lines TO authenticated;
GRANT ALL ON TABLE public.rfp_records      TO service_role;
GRANT ALL ON TABLE public.rfp_record_lines TO service_role;


-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY. THREE POLICIES PER TABLE, TO authenticated. NO DELETE POLICY. NO VENDOR
--    POLICY. NO anon POLICY. D1: the paid lead agency helper, never current_user_org_ids().
--    rfp_records INSERT/UPDATE also require the project, when given, to be the lead org's own
--    (114's shape for rfp_magic_tokens, 114:178-185).
-- ---------------------------------------------------------------------
ALTER TABLE public.rfp_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfp_record_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rfp_records_entitled_select"
  ON public.rfp_records AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));

CREATE POLICY "rfp_records_entitled_insert"
  ON public.rfp_records AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids())
    AND (project_id IS NULL
         OR EXISTS (SELECT 1 FROM public.projects pr
                     WHERE pr.id = rfp_records.project_id
                       AND pr.org_id = rfp_records.lead_org_id))
  );

CREATE POLICY "rfp_records_entitled_update"
  ON public.rfp_records AS PERMISSIVE FOR UPDATE TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()))
  WITH CHECK (
    lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids())
    AND (project_id IS NULL
         OR EXISTS (SELECT 1 FROM public.projects pr
                     WHERE pr.id = rfp_records.project_id
                       AND pr.org_id = rfp_records.lead_org_id))
  );

CREATE POLICY "rfp_record_lines_entitled_select"
  ON public.rfp_record_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));

CREATE POLICY "rfp_record_lines_entitled_insert"
  ON public.rfp_record_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));

CREATE POLICY "rfp_record_lines_entitled_update"
  ON public.rfp_record_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_entitled_lead_org_ids()));


-- ---------------------------------------------------------------------
-- 7. THE FIVE LINK COLUMNS. Nullable, no default, no backfill (119 backfills).
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_inbox
  ADD COLUMN rfp_line_id          uuid NULL REFERENCES public.rfp_record_lines (id),
  ADD COLUMN client_name_released text NULL;

ALTER TABLE public.rfp_magic_tokens
  ADD COLUMN rfp_line_id          uuid NULL REFERENCES public.rfp_record_lines (id),
  ADD COLUMN attached_inbox_id    uuid NULL REFERENCES public.partner_rfp_inbox (id) ON DELETE SET NULL,
  ADD COLUMN client_name_released text NULL;

CREATE INDEX partner_rfp_inbox_rfp_line_id_idx      ON public.partner_rfp_inbox (rfp_line_id);
CREATE INDEX rfp_magic_tokens_rfp_line_id_idx       ON public.rfp_magic_tokens (rfp_line_id);
CREATE INDEX rfp_magic_tokens_attached_inbox_id_idx ON public.rfp_magic_tokens (attached_inbox_id);

COMMENT ON COLUMN public.partner_rfp_inbox.rfp_line_id IS
  'Migration 118. The rfp_record_lines row this inbox row was sent from. The vendor may read it (an '
  'opaque id into a table it cannot read) and may not write it: partner_rfp_inbox_link_columns_guard.';
COMMENT ON COLUMN public.partner_rfp_inbox.client_name_released IS
  'Migration 118. The client name when the record''s show_client_to_vendors is on, NULL when off. '
  'Written by the agency or the service role only (link-column guard). Not written before step B.';
COMMENT ON COLUMN public.rfp_magic_tokens.rfp_line_id IS
  'Migration 118. The rfp_record_lines row this invitation was sent from. Link-column guard.';
COMMENT ON COLUMN public.rfp_magic_tokens.attached_inbox_id IS
  'Migration 118. The partner_rfp_inbox row this invitation is attached to; replaces the '
  'master_rfp_json._magic_token join (step B). ON DELETE SET NULL: the attach collapse deletes '
  'duplicate inbox rows. Link-column guard.';
COMMENT ON COLUMN public.rfp_magic_tokens.client_name_released IS
  'Migration 118. As partner_rfp_inbox.client_name_released, for the guest page. Link-column guard.';


-- ---------------------------------------------------------------------
-- 8. THE LINK-COLUMN GUARDS. See the header section of that name for the three rules, and THE
--    VENDOR ALLOW-LIST for the inbox guard's rule (4).
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partner_rfp_inbox_link_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed   boolean;
  v_trusted   boolean;
  v_line_org  uuid;
  -- Rule (4), ruling O1: the columns a vendor may change. Everything else is refused for a vendor,
  -- including any column added to this table later.
  v_vendor_ok text[] := ARRAY['status', 'updated_at', 'viewed_at', 'partner_intent', 'intent_set_at',
                              'agency_nda_notified_at'];
  v_offending text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.rfp_line_id IS NOT NULL OR NEW.client_name_released IS NOT NULL;
  ELSE
    v_changed := NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
              OR NEW.client_name_released IS DISTINCT FROM OLD.client_name_released;
  END IF;

  v_trusted := auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated');

  -- (1) WHO MAY WRITE A LINK COLUMN.
  IF v_changed AND NOT v_trusted THEN
    IF NOT coalesce(NEW.lead_org_id IN (SELECT public.current_user_org_ids()), false)
       OR (TG_OP = 'UPDATE' AND NOT coalesce(OLD.lead_org_id IN (SELECT public.current_user_org_ids()), false)) THEN
      RAISE EXCEPTION 'That is not a field you can change.'
        USING ERRCODE = '42501',
              DETAIL  = 'partner_rfp_inbox.rfp_line_id and client_name_released are written by the lead agency or the service role only (migration 118).';
    END IF;
  END IF;

  -- (2) THE LINE BELONGS TO THE ROW'S LEAD ORGANIZATION.
  IF NEW.rfp_line_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
          OR NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id) THEN
    SELECT l.lead_org_id INTO v_line_org FROM public.rfp_record_lines l WHERE l.id = NEW.rfp_line_id;
    IF v_line_org IS DISTINCT FROM NEW.lead_org_id THEN
      RAISE EXCEPTION 'That RFP line does not belong to this organization.'
        USING ERRCODE = '23514',
              DETAIL  = 'partner_rfp_inbox.rfp_line_id must reference an rfp_record_lines row with the same lead_org_id, visible to the caller (migration 118).';
    END IF;
  END IF;

  -- (4) THE VENDOR ALLOW-LIST (rulings O1 and O2). Anyone who is not a member of the row's lead
  -- organization before AND after the write, and is not on the trusted path, is a vendor here.
  IF TG_OP = 'UPDATE' AND NOT v_trusted
     AND NOT (coalesce(OLD.lead_org_id IN (SELECT public.current_user_org_ids()), false)
              AND coalesce(NEW.lead_org_id IN (SELECT public.current_user_org_ids()), false)) THEN
    -- O2, the claim: an unclaimed row, claimed for one of the caller's own organizations (099
    -- clause B's test), with claimed_at set in the same update. Never once vendor_org_id is set.
    IF OLD.vendor_org_id IS NULL
       AND coalesce(NEW.vendor_org_id IN (SELECT public.current_user_org_ids()), false)
       AND NEW.claimed_at IS NOT NULL
       AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
      v_vendor_ok := v_vendor_ok || ARRAY['vendor_org_id', 'claimed_at'];
    END IF;

    SELECT o.key
      INTO v_offending
      FROM jsonb_each(to_jsonb(OLD) - v_vendor_ok) o
      LEFT JOIN jsonb_each(to_jsonb(NEW) - v_vendor_ok) n ON n.key = o.key
     WHERE n.value IS DISTINCT FROM o.value
     ORDER BY o.key
     LIMIT 1;

    IF v_offending IS NOT NULL THEN
      RAISE EXCEPTION 'A vendor cannot change partner_rfp_inbox.%.', v_offending
        USING ERRCODE = '42501',
              DETAIL  = 'Vendors may change status, updated_at, viewed_at, partner_intent, intent_set_at and agency_nda_notified_at, and may claim an unclaimed row for their own organization (vendor_org_id with claimed_at). Nothing else (migration 118, rulings O1 and O2).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.partner_rfp_inbox_link_columns_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on partner_rfp_inbox: rfp_line_id and client_name_released '
  'may be set or changed only by a member of the row''s lead organization (before and after the write) '
  'or a trusted path with no session (42501); rfp_line_id must reference a line of the same lead '
  'organization (23514). VENDOR ALLOW-LIST (rulings O1, O2): on UPDATE, a caller who is neither on '
  'the trusted path nor a member of the lead organization before and after may change only status, '
  'updated_at, viewed_at, partner_intent, intent_set_at, agency_nda_notified_at, plus vendor_org_id '
  'and claimed_at when claiming an unclaimed row for one of its own organizations with claimed_at set. '
  'Any other change raises 42501 naming the column. Deny by default: new columns are refused too.';

CREATE TRIGGER partner_rfp_inbox_link_columns_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_inbox_link_columns_guard();

REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_link_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_link_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_link_columns_guard() FROM authenticated;

CREATE FUNCTION public.rfp_magic_tokens_link_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed   boolean;
  v_trusted   boolean;
  v_line_org  uuid;
  v_inbox_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.rfp_line_id IS NOT NULL OR NEW.attached_inbox_id IS NOT NULL
              OR NEW.client_name_released IS NOT NULL;
  ELSE
    v_changed := NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
              OR NEW.attached_inbox_id IS DISTINCT FROM OLD.attached_inbox_id
              OR NEW.client_name_released IS DISTINCT FROM OLD.client_name_released;
  END IF;

  v_trusted := auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated');

  -- (1) WHO MAY WRITE A LINK COLUMN.
  IF v_changed AND NOT v_trusted THEN
    IF NOT coalesce(NEW.org_id IN (SELECT public.current_user_org_ids()), false)
       OR (TG_OP = 'UPDATE' AND NOT coalesce(OLD.org_id IN (SELECT public.current_user_org_ids()), false)) THEN
      RAISE EXCEPTION 'That is not a field you can change.'
        USING ERRCODE = '42501',
              DETAIL  = 'rfp_magic_tokens.rfp_line_id, attached_inbox_id and client_name_released are written by the lead agency or the service role only (migration 118).';
    END IF;
  END IF;

  -- (2) THE LINE BELONGS TO THE TOKEN'S LEAD ORGANIZATION.
  IF NEW.rfp_line_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.rfp_line_id IS DISTINCT FROM OLD.rfp_line_id
          OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    SELECT l.lead_org_id INTO v_line_org FROM public.rfp_record_lines l WHERE l.id = NEW.rfp_line_id;
    IF v_line_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'That RFP line does not belong to this organization.'
        USING ERRCODE = '23514',
              DETAIL  = 'rfp_magic_tokens.rfp_line_id must reference an rfp_record_lines row with lead_org_id = org_id, visible to the caller (migration 118).';
    END IF;
  END IF;

  -- (3) THE ATTACHED INBOX ROW BELONGS TO THE TOKEN'S LEAD ORGANIZATION.
  IF NEW.attached_inbox_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.attached_inbox_id IS DISTINCT FROM OLD.attached_inbox_id
          OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    SELECT i.lead_org_id INTO v_inbox_org FROM public.partner_rfp_inbox i WHERE i.id = NEW.attached_inbox_id;
    IF v_inbox_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'That inbox row does not belong to this organization.'
        USING ERRCODE = '23514',
              DETAIL  = 'rfp_magic_tokens.attached_inbox_id must reference a partner_rfp_inbox row with lead_org_id = org_id, visible to the caller (migration 118).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rfp_magic_tokens_link_columns_guard() IS
  'Migration 118. BEFORE INSERT OR UPDATE on rfp_magic_tokens: rfp_line_id, attached_inbox_id and '
  'client_name_released may be set or changed only by a member of the token''s org_id (before and after '
  'the write) or a trusted path with no session (42501); rfp_line_id must reference a line, and '
  'attached_inbox_id an inbox row, of the same organization (23514).';

CREATE TRIGGER rfp_magic_tokens_link_columns_guard
  BEFORE INSERT OR UPDATE ON public.rfp_magic_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_magic_tokens_link_columns_guard();

REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_link_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_link_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_link_columns_guard() FROM authenticated;

-- PostgREST must see the tables and columns at commit.
NOTIFY pgrst, 'reload schema';
-- <<< 118 BODY END
        $m118$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('118 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;

      -- Is m1 entitled through the new helper? Reported on the SUBJECT line; H1 asserts it.
      IF array_length(v_apply_err, 1) IS NULL AND v_u1 IS NOT NULL THEN
        BEGIN
          PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_u1::text, 'role', 'authenticated')::text, true);
          PERFORM set_config('request.jwt.claim.sub', v_u1::text, true);
          SET LOCAL ROLE authenticated;
          EXECUTE format('SELECT (%L::uuid IN (SELECT public.current_user_entitled_lead_org_ids()))::text', v_o1) INTO v_m1_entitled;
          RESET ROLE;
          RAISE EXCEPTION 'probe done' USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN NULL;
          WHEN OTHERS THEN v_m1_entitled := 'probe failed: ' || SQLSTATE;
        END;
        RESET ROLE;
        PERFORM set_config('request.jwt.claims',    '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
      END IF;
    END IF;
  END LOOP;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  EXECUTE v_pol_sql  INTO v_pol_after;
  EXECUTE v_acl_sql  INTO v_acl_after;
  EXECUTE v_rows_sql INTO v_rows_after;
  EXECUTE v_trg_sql  INTO v_trg_after;

  ---------------------------------------------------------------------
  -- JUDGEMENT, exactly 116's and 117's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
  -- An expectation may list several accepted values separated by ' OR '.
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    v_ran := v_ran + 1;
    v_logged := v_logged + 1;
    v_ba := v_ba || '  ' || sc_label[v_i] || E'\n';
    v_st := 'PASS';
    v_detail := '';
    v_same := true;
    v_all_nosubj := true;
    FOR v_k IN 1 .. c_phases LOOP
      v_idx := (v_i - 1) * c_phases + v_k;
      v_cls := r_cls[v_idx];
      v_exp := sc_exp[v_idx];
      IF v_exp IS DISTINCT FROM sc_exp[(v_i - 1) * c_phases + 1] THEN v_same := false; END IF;
      IF v_cls <> 'NOSUBJECT' THEN v_all_nosubj := false; END IF;
      v_ba := v_ba || format(E'      phase %s : %s   (expected %s)\n', v_k, v_cls, v_exp);
      IF v_cls LIKE 'FAULT%' OR v_cls = 'NOSUBJECT' OR v_cls = 'NOT RUN' THEN
        IF v_st = 'PASS' THEN v_st := 'INCONCLUSIVE'; END IF;
        v_detail := v_detail || format(' [phase %s: %s]', v_k, CASE WHEN v_cls = 'NOSUBJECT' THEN 'NO SUBJECT' ELSE v_cls END);
      ELSIF NOT (v_cls = ANY (string_to_array(v_exp, ' OR '))) THEN
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
    IF v_st = 'INCONCLUSIVE' AND v_all_nosubj AND sc_id[v_i] = ANY (c_by_design) THEN
      v_inconc_dsg := v_inconc_dsg + 1;
      v_dsg_ids := v_dsg_ids || CASE WHEN v_dsg_ids = '' THEN '' ELSE ', ' END || sc_id[v_i];
      v_detail := v_detail || CASE WHEN sc_id[v_i] = 'C3'
                                   THEN ' (BY DESIGN: no user outside o1 belongs to two organizations)'
                                   ELSE ' (BY DESIGN: no unpaid or second lead agency exists)' END;
    END IF;
    IF v_st = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_st = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1; END IF;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 66) || rpad(v_st, 14) || v_detail;
  END LOOP;

  -- S1. No policy outside the two new tables changed.
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(before %s ; after %s)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy outside the new tables changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy outside the new tables changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S2. No table, column or function grant outside the new tables and functions changed.
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no grant outside the new tables/functions changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no grant outside the new tables/functions changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S3. The new tables' grants, exactly: authenticated SELECT, INSERT, UPDATE and nothing else; anon
  --     nothing; no PUBLIC entry; service_role everything.
  v_ok := false;
  IF to_regclass('public.rfp_records') IS NOT NULL AND to_regclass('public.rfp_record_lines') IS NOT NULL THEN
    SELECT bool_and(
             has_table_privilege('authenticated', t, 'SELECT') AND has_table_privilege('authenticated', t, 'INSERT')
             AND has_table_privilege('authenticated', t, 'UPDATE') AND NOT has_table_privilege('authenticated', t, 'DELETE')
             AND NOT has_table_privilege('authenticated', t, 'TRUNCATE') AND NOT has_table_privilege('authenticated', t, 'REFERENCES')
             AND NOT has_table_privilege('authenticated', t, 'TRIGGER')
             AND NOT has_table_privilege('anon', t, 'SELECT') AND NOT has_table_privilege('anon', t, 'INSERT')
             AND NOT has_table_privilege('anon', t, 'UPDATE') AND NOT has_table_privilege('anon', t, 'DELETE')
             AND NOT has_table_privilege('anon', t, 'TRUNCATE') AND NOT has_table_privilege('anon', t, 'REFERENCES')
             AND NOT has_table_privilege('anon', t, 'TRIGGER')
             AND has_table_privilege('service_role', t, 'SELECT') AND has_table_privilege('service_role', t, 'INSERT')
             AND has_table_privilege('service_role', t, 'UPDATE') AND has_table_privilege('service_role', t, 'DELETE')
             AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = t::regclass AND a.grantee = 0))
      INTO v_ok
    FROM unnest(ARRAY['public.rfp_records', 'public.rfp_record_lines']) AS t;
  END IF;
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S3  new tables: authenticated S/I/U only, anon none, no PUBLIC', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S3  new tables: authenticated S/I/U only, anon none, no PUBLIC', 66) || rpad('FAIL', 14) || '(read 118''s V3)'; END IF;

  -- S4. RLS on, exactly three policies per new table (SELECT, INSERT, UPDATE), all TO authenticated,
  --     every one reading the paid lead agency helper. No DELETE, no ALL.
  SELECT count(*) = 6
         AND bool_and(roles = ARRAY['authenticated']::name[])
         AND bool_and(cmd IN ('SELECT', 'INSERT', 'UPDATE'))
         AND count(DISTINCT tablename || cmd) = 6
         AND bool_and(coalesce(qual, '') || coalesce(with_check, '') LIKE '%current_user_entitled_lead_org_ids%')
    INTO v_ok
  FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('rfp_records', 'rfp_record_lines');
  v_ok := coalesce(v_ok, false)
          AND coalesce((SELECT bool_and(c.relrowsecurity) AND count(*) = 2 FROM pg_class c
                         WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('rfp_records', 'rfp_record_lines')), false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S4  RLS on; 3 policies each, TO authenticated, via the helper', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S4  RLS on; 3 policies each, TO authenticated, via the helper', 66) || rpad('FAIL', 14) || '(read 118''s V1 and V2)'; END IF;

  -- S5. The helper: SECURITY DEFINER, STABLE, search_path pinned; anon cannot execute, authenticated
  --     can, no PUBLIC entry.
  SELECT p.prosecdef AND p.provolatile::text = 's'
         AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    INTO v_ok
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'current_user_entitled_lead_org_ids' AND p.pronargs = 0;
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S5  helper: definer, stable, pinned; anon no, authenticated yes', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S5  helper: definer, stable, pinned; anon no, authenticated yes', 66) || rpad('FAIL', 14) || '(read 118''s V4)'; END IF;

  -- S6. The four guards: functions pinned and executable by neither anon nor authenticated; one
  --     enabled BEFORE INSERT OR UPDATE FOR EACH ROW trigger each, on the right table.
  SELECT count(*) = 4
         AND bool_and(t.tgenabled::text = 'O' AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2
                      AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16
                      AND t.tgname = p.proname
                      AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         AND bool_and((c.relname::text, t.tgname::text) IN (('rfp_records', 'rfp_records_guard'),
                                                            ('rfp_record_lines', 'rfp_record_lines_guard'),
                                                            ('partner_rfp_inbox', 'partner_rfp_inbox_link_columns_guard'),
                                                            ('rfp_magic_tokens', 'rfp_magic_tokens_link_columns_guard')))
    INTO v_ok
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
    AND t.tgname IN ('rfp_records_guard', 'rfp_record_lines_guard',
                     'partner_rfp_inbox_link_columns_guard', 'rfp_magic_tokens_link_columns_guard');
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S6  four guards: BEFORE INS/UPD row triggers, not executable', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S6  four guards: BEFORE INS/UPD row triggers, not executable', 66) || rpad('FAIL', 14) || '(read 118''s V5)'; END IF;

  -- S7. The five link columns (nullable, right types) and the foreign-key actions.
  SELECT count(*) = 5
         AND bool_and(NOT a.attnotnull)
         AND bool_and(format_type(a.atttypid, a.atttypmod) = CASE WHEN a.attname = 'client_name_released' THEN 'text' ELSE 'uuid' END)
    INTO v_ok
  FROM pg_attribute a
  WHERE a.attrelid IN ('public.partner_rfp_inbox'::regclass, 'public.rfp_magic_tokens'::regclass)
    AND a.attname IN ('rfp_line_id', 'client_name_released', 'attached_inbox_id') AND NOT a.attisdropped;
  v_ok := coalesce(v_ok, false);
  IF v_ok AND to_regclass('public.rfp_records') IS NOT NULL THEN
    SELECT string_agg(c.relname::text || '.' || a.attname::text || '=' || k.confdeltype::text, ',' ORDER BY c.relname, a.attname)
           = 'partner_rfp_inbox.rfp_line_id=a,rfp_magic_tokens.attached_inbox_id=n,rfp_magic_tokens.rfp_line_id=a,'
             || 'rfp_record_lines.rfp_id=c,rfp_records.created_by=n,rfp_records.project_id=n'
      INTO v_ok
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f'
      AND ((c.relname = 'rfp_records' AND a.attname IN ('project_id', 'created_by'))
        OR (c.relname = 'rfp_record_lines' AND a.attname = 'rfp_id')
        OR (c.relname IN ('partner_rfp_inbox', 'rfp_magic_tokens') AND a.attname IN ('rfp_line_id', 'attached_inbox_id')))
      AND c.relnamespace = 'public'::regnamespace;
  ELSE
    v_ok := false;
  END IF;
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S7  five link columns nullable; FK actions as designed', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S7  five link columns nullable; FK actions as designed', 66) || rpad('FAIL', 14) || '(read 118''s V6 and V7)'; END IF;

  -- S8. Existing inbox and token rows unchanged in every pre-118 column, and none carries a link.
  v_link_rows := NULL;
  BEGIN
    EXECUTE $c$SELECT (SELECT count(*) FROM public.partner_rfp_inbox WHERE rfp_line_id IS NOT NULL OR client_name_released IS NOT NULL)
                    + (SELECT count(*) FROM public.rfp_magic_tokens
                        WHERE rfp_line_id IS NOT NULL OR attached_inbox_id IS NOT NULL OR client_name_released IS NOT NULL)$c$
      INTO v_link_rows;
  EXCEPTION WHEN OTHERS THEN v_link_rows := NULL;
  END;
  v_ok := coalesce((v_rows_before IS NOT DISTINCT FROM v_rows_after) AND v_link_rows = 0, false);
  v_detail := format('(rows before %s ; after %s ; rows with a link %s)', v_rows_before, v_rows_after, coalesce(v_link_rows::text, 'unreadable'));
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S8  existing inbox and token rows unchanged, none linked', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S8  existing inbox and token rows unchanged, none linked', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S9. Every trigger already on partner_rfp_inbox and rfp_magic_tokens is unchanged.
  v_ok := v_trg_before IS NOT DISTINCT FROM v_trg_after;
  v_detail := format('(before %s ; after %s)', v_trg_before, v_trg_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S9  existing inbox/token triggers unchanged', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S9  existing inbox/token triggers unchanged', 66) || rpad('FAIL', 14) || v_detail; END IF;

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
    v_headline := format('DO NOT APPLY 118.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 118.';
    v_headline := format('SAFE TO APPLY 118.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 AND v_inconc = v_inconc_dsg THEN
    v_verdict_text := 'SAFE TO APPLY 118. The only INCONCLUSIVE rows are the NO SUBJECT cases the brief rules INCONCLUSIVE BY DESIGN.';
    v_headline := format('SAFE TO APPLY 118.  %s assertions passed; %s INCONCLUSIVE BY DESIGN (NO SUBJECT: %s - no unpaid or second lead agency, or no two-organization user outside o1, exists). Nothing FAILED.',
                         v_pass, v_inconc_dsg, v_dsg_ids);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion beyond the by-design ones could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 118 YET.  %s assertion(s) INCONCLUSIVE (%s of them by design) - nothing FAILED, but the run does NOT show 118 does what it claims.', v_inconc, v_inconc_dsg);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 118.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s: 87 scenarios + 9 self-checks + M)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 4 or 5, all by design: U1, U2, X1, X2, and C3 unless a two-organization user exists; NO SUBJECT counts here)\n', v_inconc)
    || format(E'INFO (not judged): %s inbox row(s) point at a project of another organization than their lead_org_id (deleting such a project as its own members would be refused by rule (4)); %s unclaimed invitation row(s) already carry a vendor_org_id (O2 admits no vendor claim on them). Both expected 0.\n',
              v_info_xproj, v_info_unclm)
    || format(E'isolation check : %s scenario run(s) compared to the pre-phase fingerprint of partner_rfp_inbox, rfp_magic_tokens, projects (and rfp_records, rfp_record_lines once they exist): %s\n',
              v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT         : lead org %s, project %s, agency member %s (entitled through the new helper: %s); vendor %s of org %s on partnership %s (profile email %s); vendor inbox row %s; token %s; other-org project %s%s; other org %s; unpaid %s/%s; second lead agency %s/%s; two-organization user %s (%s, %s)%s\n',
              v_o1, coalesce(v_p1::text, 'NONE'), coalesce(v_u1::text, 'NONE'), v_m1_entitled,
              coalesce(v_uv::text, 'NONE'), coalesce(v_ov::text, 'NONE'), coalesce(v_ps1::text, 'NONE'),
              CASE WHEN v_uv_email IS NULL THEN 'NONE' ELSE 'present' END,
              coalesce(v_inbox::text, 'NONE'), coalesce(v_tok, 'NONE'), v_px,
              CASE WHEN v_px_real THEN '' ELSE ' (none exists: a random id)' END,
              coalesce(v_oo::text, 'NONE'), coalesce(v_uu::text, 'NONE'), coalesce(v_ou::text, 'NONE'),
              coalesce(v_ux::text, 'NONE'), coalesce(v_ox::text, 'NONE'),
              coalesce(v_um::text, 'NONE'), coalesce(v_oma::text, 'NONE'), coalesce(v_omb::text, 'NONE'),
              CASE WHEN v_fallback THEN ' [FALLBACK: no qualifying partnership, vendor scenarios are NO SUBJECT]' ELSE '' END)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 118\n  phase 2 = AFTER 118\n'
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
