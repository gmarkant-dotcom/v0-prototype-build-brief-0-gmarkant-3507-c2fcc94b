-- =====================================================================
-- 120 PRE-APPLY TEST. ONE PASTE. APPLIES 120, WRITES, READS, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-15 on feat/rfp-record-c (unattended run). NOT RUN: THERE IS NO LOCAL POSTGRES AND
-- NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain error, not in
-- "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor, AFTER the step C code is deployed and
-- supabase/sql-checks/120-key-inventory.sql has been read.
-- The inlined migration code below (inside the $m120$ string) is 120_rfp_vendor_copy_scrub.sql from
-- the line "-- >>> 120 BODY START" to the line "-- <<< 120 BODY END" inclusive: the whole body
-- between BEGIN; and COMMIT;. Both files carry those two marker lines, so the copies can be compared
-- mechanically. If you edit the migration, re-copy the marked block here and re-check.
-- Checked 2026-10-15 (feat/rfp-record-c): the md5 of the marked block is the same in both files
-- (migration lines 154-539, this file's lines 545-930).
--
-- 118 AND 119 ARE LIVE (applied and verified 2026-10-14). This test applies only 120, inside its own
-- transaction, between phase 1 and phase 2, and rolls everything back at the end: THE SCRUB RUNS FOR
-- REAL INSIDE THE TEST, against the live rows, and is undone with the test.
--
-- LESSONS APPLIED: (1) subjects are selected through partnerships.vendor_org_id, never partner_id;
-- (2) every "char" catalog column (tgenabled) is cast to text before || or comparison (42725);
-- (3) NO TEMP TABLE AND NO pg_temp FUNCTION: everything lives inside the one DO block (42P01 broke
-- retag v1); (4) the SQL Editor shows only the last statement's result, so the final RAISE carries
-- the whole result, the scrub's lists included; (5) NO SUBJECT is INCONCLUSIVE, never PASS.
--
-- WHAT 120 MUST SHOW:
--   A vendor reading its own inbox rows finds no key outside the allow-list: no client, no rubric,
--   no budget in the copy (programme budget or any line's), no other line, no _magic_token. The
--   released client name and released budget columns of a linked row survive the scrub. A vendor,
--   an agency member and the owner (the trusted path) are all refused (23514) a disallowed key on
--   insert and update of an inbox copy, and an agency member a disallowed key in a token's
--   reference_materials; allowed writes still pass; anon reads nothing. No policy or grant changed;
--   triggers changed only by the two new guards; exactly four functions added; the allow-lists in
--   the migration equal the ones in lib/rfp-vendor-copy.ts; row counts unchanged and no column but
--   the two JSON columns written; every kept key's value unchanged; the refused unlinked row 04391718
--   scrubbed and listed; a second run changes nothing and says so.
--
-- A FIXTURE, created before phase 1 as the owner (118's write order: record, line, linked row,
-- broadcast_at last) and rolled back with the test: one record of the lead organization with one
-- line, and ONE INBOX ROW OF THE VENDOR linked to it, whose copy carries every key 120 removes
-- (client, totalBudget, scopeItems with budgets and another line, evaluation_criteria,
-- referenceMaterials, _magic_token naming no token) next to allowed ones, with client_name_released
-- 'LG120 Released' and estimated_budget 'LG120 released'. The record holds every removed value, so
-- the pre-flight admits it, and the real scrub scrubs it. The test token (when one exists) gets an
-- empty extra reference_materials key so the token scrub runs at least once.
--
-- PHASES: phase 1 BEFORE 120, phase 2 AFTER 120. EVERY SCENARIO RUNS IN EVERY PHASE. A phase-1
-- mismatch is INCONCLUSIVE (the premise is wrong), never PASS; a phase-2 mismatch is FAIL. The
-- self-checks S1-S11 run once, after phase 2.
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
--     "SAFE TO APPLY 120."       -> and only this.
--     "DO NOT APPLY 120 YET."    -> INCONCLUSIVE or NO SUBJECT.
--     "DO NOT APPLY 120."        -> an assertion FAILED, or the test is broken. If M fails with
--                                   LG120, the pre-flight refused on LIVE data: its message lists
--                                   the rows; that is a finding, not a test fault.
-- Then read the SCRUB lines: they are what the real apply will do.
--
-- EXPECTED COUNT: 17 scenarios + 11 self-checks + M = 29 assertions.
--
-- INCONCLUSIVE BY DESIGN: NONE. S10 is INCONCLUSIVE (NO SUBJECT) only if inbox 04391718 no longer
-- exists; the owner recorded it on 2026-10-14, so that would be news.
--
-- NOT DISCRIMINATING BY DESIGN (same expectation before and after 120, reported as PASS with that
-- note): V7 (the release columns survive), W1 (118's vendor allow-list already refuses every vendor
-- write of master_rfp_json; 120's guard stands behind it), A3 and A5 (allowed writes still pass),
-- N1 and N2 (anon).
--
-- =====================================================================
-- THE SUBJECTS
-- =====================================================================
-- vendor : a member of a partnership's VENDOR ORGANIZATION (partnerships.vendor_org_id) who is not a
--          member of the lead organization. The fixture row is addressed to that organization.
-- o1, p1 : that partnership's lead organization (a PAID LEAD AGENCY) and a project of it.
-- m1     : a member of o1, preferring a sole membership, then role owner. The agency actor.
-- tok    : an rfp_magic_tokens row of o1 whose project is NULL or o1's own (114's WITH CHECK).
-- owner  : the SQL Editor role with no JWT claims: 118's trusted path, the service role's twin.
-- IMPERSONATION IS PROVED: request.jwt.claims + SET LOCAL ROLE, then auth.uid() and current_user are
-- read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097. A fingerprint
-- of every partner_rfp_inbox, rfp_magic_tokens, rfp_records, rfp_record_lines and projects row is
-- compared after each.
--
-- RESULT CODES: OK:<value> (the scenario's one text value), MISSING (42P01 / 42703 / 42883),
-- E:<sqlstate> (refused with that code). 23514 is 120's guard; 42501 is 118's vendor allow-list
-- (or RLS); LG120 the migration's pre-flight.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 28;
  c_phases       CONSTANT integer := 2;
  c_by_design    CONSTANT text[]  := ARRAY[]::text[];
  -- THE ALLOW-LISTS AS THE CODE HOLDS THEM: copied from lib/rfp-vendor-copy.ts (the two lines marked
  -- "ALLOW-LIST (SQL form, copied by 120_preapply_test.sql)"). S6 compares them with 120's functions.
  c_allow_code   CONSTANT text[]  := ARRAY['projectName','overview','objectives','timeline','business_criteria_required','budget_categories','nda_link','response_deadline'];
  c_token_code   CONSTANT text[]  := ARRAY['materials'];
  c_fn_new       CONSTANT text    := 'partner_rfp_inbox_vendor_copy_guard(), rfp_magic_tokens_vendor_copy_guard(), rfp_token_reference_materials_keys(), rfp_vendor_copy_keys()';
  c_refused_row  CONSTANT uuid    := '04391718-bf70-4d63-a0d6-ea773003b6cc';
  v_o1           uuid;
  v_p1           uuid;
  v_u1           uuid;
  v_uv           uuid;
  v_ov           uuid;
  v_ps1          uuid;
  v_tok          text;
  v_fallback     boolean := false;
  v_rec          uuid := gen_random_uuid();
  v_line         uuid := gen_random_uuid();
  v_inbf         uuid := gen_random_uuid();
  v_newid        uuid := gen_random_uuid();
  v_txt          text;
  v_actor        text;
  v_uid          uuid;
  v_ph           integer;
  v_i            integer;
  v_k            integer;
  v_idx          integer;
  v_need         text;
  v_nosubj       boolean;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  -- Captured before phase 1 (after the fixture), compared after phase 2.
  v_pol_before   text;
  v_pol_after    text;
  v_pol_count    bigint;
  v_acl_before   text;
  v_acl_after    text;
  v_trg_before   text;
  v_trg_after    text;
  v_fn_before    text[];
  v_fn_after     text[];
  v_rows_before  text;
  v_rows_after   text;
  v_kept_before  text;
  v_kept_after   text;
  v_inbox_n0     bigint;
  v_inbox_n1     bigint;
  v_tok_n0       bigint;
  v_tok_n1       bigint;
  v_refused_had  boolean;
  v_before_info  text := '';
  -- The scrub's own result (ligament.scrub_120).
  v_res          jsonb;
  v_res2         jsonb;
  v_body         text;
  v_idem         text := 'not run';
  v_whole_fp0    text;
  v_whole_fp1    text;
  v_n1           bigint;
  v_n2           bigint;
  v_n3           bigint;
  v_ok           boolean;
  v_detail       text;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_inconc_dsg   integer := 0;
  v_ran          integer := 0;
  v_logged       integer := 0;
  v_lines        text := '';
  v_ba           text := '';
  v_scrub        text := '';
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
  v_parts        text[];

  -- Isolation fingerprint: every row of the five tables the scenarios touch.
  v_fp_sql       CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id::text) FROM public.rfp_magic_tokens x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.rfp_records x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.rfp_record_lines x), ''))
           || md5(coalesce((SELECT string_agg(x.id::text, ',' ORDER BY x.id) FROM public.projects x), ''))$f$;
  -- Every policy in public.
  v_pol_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                      E'\n' ORDER BY tablename, policyname), ''))
       FROM pg_policies WHERE schemaname = 'public'$f$;
  -- Every table, column and function ACL in public, the four new functions excluded.
  v_acl_sql      CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), E'\n' ORDER BY c.relname)
                             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')), ''))
           || md5(coalesce((SELECT string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, E'\n' ORDER BY c.relname, a.attname)
                             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped), ''))
           || md5(coalesce((SELECT string_agg(p.proname || '(' || oidvectortypes(p.proargtypes) || '):' || coalesce(p.proacl::text, ''), E'\n'
                                              ORDER BY p.proname, oidvectortypes(p.proargtypes))
                             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public'
                               AND p.proname NOT IN ('rfp_vendor_copy_keys', 'rfp_token_reference_materials_keys',
                                                     'partner_rfp_inbox_vendor_copy_guard', 'rfp_magic_tokens_vendor_copy_guard')), ''))$f$;
  -- Every non-internal trigger on a public table, with its function body, the two new guards excluded.
  v_trg_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(c.relname || ':' || t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':'
                                      || p.proname || ':' || md5(p.prosrc), E'\n' ORDER BY c.relname, t.tgname), ''))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
         AND t.tgname NOT IN ('partner_rfp_inbox_vendor_copy_guard', 'rfp_magic_tokens_vendor_copy_guard')$f$;
  -- Every inbox and token row OUTSIDE the two JSON columns 120 may write.
  v_rows_sql     CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg((to_jsonb(x) - 'master_rfp_json')::text, E'\n' ORDER BY x.id)
                             FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg((to_jsonb(x) - 'reference_materials')::text, E'\n' ORDER BY x.id::text)
                             FROM public.rfp_magic_tokens x), ''))$f$;
  -- Every row's KEPT keys (the code's allow-lists) and their values: 120 may remove keys, never change a kept one.
  v_kept_sql     text;
  -- The whole of both tables, for the second-run check.
  v_whole_sql    CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id::text) FROM public.rfp_magic_tokens x), ''))$f$;

  -- Read-backs, as the actor. %8$L is the code's allow-list as an array literal.
  q_some  CONSTANT text := $q$SELECT CASE WHEN count(*) > 0 THEN 'SOME' ELSE 'NONE' END FROM public.partner_rfp_inbox i WHERE jsonb_typeof(i.master_rfp_json) = 'object' AND $q$;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_needs  text[];
  sc_sql    text[];
  sc_exp    text[];   -- flattened: (scenario - 1) * c_phases + phase; ' OR ' separates accepted values
  r_cls     text[];
BEGIN
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  v_kept_sql := format(
    $f$SELECT md5(coalesce((SELECT string_agg(x.id::text || ':' || coalesce((SELECT jsonb_object_agg(e.key, e.value)
                                                                               FROM jsonb_each(CASE WHEN jsonb_typeof(x.master_rfp_json) = 'object' THEN x.master_rfp_json ELSE '{}'::jsonb END) AS e(key, value)
                                                                              WHERE e.key = ANY (%L::text[]))::text, ''), E'\n' ORDER BY x.id)
                             FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg(x.id::text || ':' || coalesce(CASE WHEN jsonb_typeof(x.reference_materials) = 'object'
                                                                             THEN (SELECT jsonb_object_agg(e.key, e.value)
                                                                                     FROM jsonb_each(x.reference_materials) AS e(key, value)
                                                                                    WHERE e.key = ANY (%L::text[]))
                                                                             ELSE x.reference_materials END::text, ''), E'\n' ORDER BY x.id::text)
                             FROM public.rfp_magic_tokens x), ''))$f$,
    c_allow_code::text, c_token_code::text);

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
  ORDER BY (EXISTS (SELECT 1 FROM public.rfp_magic_tokens t WHERE t.org_id = ps.lead_org_id)) DESC,
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
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 120 YET.  NO SUBJECT: no paid lead agency has both a member and a project. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  SELECT pr.id INTO v_p1 FROM public.projects pr WHERE pr.org_id = v_o1 ORDER BY pr.id LIMIT 1;

  SELECT m.user_id INTO v_u1 FROM public.org_members m WHERE m.org_id = v_o1
  ORDER BY ((SELECT count(*) FROM public.org_members x WHERE x.user_id = m.user_id) = 1) DESC,
           (m.role = 'owner') DESC, m.user_id
  LIMIT 1;

  SELECT t.id::text INTO v_tok FROM public.rfp_magic_tokens t
  WHERE t.org_id = v_o1
    AND (t.project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = t.project_id AND pr.org_id = v_o1))
  ORDER BY t.id::text LIMIT 1;

  ---------------------------------------------------------------------
  -- THE FIXTURE, as the owner, 118's write order. Rolled back with the test.
  ---------------------------------------------------------------------
  INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp, evaluation_criteria,
                                  client_name_snapshot, total_budget)
  VALUES (v_rec, v_o1, v_p1, 'wizard',
          jsonb_build_object(
            'projectName', 'LG120 test project',
            'client', 'LG120 Client',
            'overview', 'LG120 overview',
            'totalBudget', 'LG120 total',
            'scopeItems', jsonb_build_array(
                            jsonb_build_object('id', 'LG120-1', 'name', 'LG120 line', 'estimatedBudget', 'LG120 estimate'),
                            jsonb_build_object('id', 'LG120-2', 'name', 'LG120 other line', 'estimatedBudget', 'LG120 other estimate')),
            'evaluation_criteria', jsonb_build_array(jsonb_build_object('name', 'LG120 criterion', 'weight', 100)),
            'referenceMaterials', jsonb_build_array(jsonb_build_object('type', 'link', 'label', 'LG120', 'url', 'https://example.invalid/lg120')),
            '_magic_token', 'lg120-no-such-token'),
          jsonb_build_array(jsonb_build_object('name', 'LG120 criterion', 'weight', 100)),
          'LG120 Client', 'LG120 total');
  INSERT INTO public.rfp_record_lines (id, rfp_id, scope_item_key, scope_item_name, estimated_budget, released_budget)
  VALUES (v_line, v_rec, 'LG120-1', 'LG120 line', 'LG120 estimate', 'LG120 released');
  INSERT INTO public.partner_rfp_inbox (id, lead_org_id, vendor_org_id, recipient_email, scope_item_id, scope_item_name,
                                        rfp_line_id, client_name_released, estimated_budget, master_rfp_json)
  VALUES (v_inbf, v_o1, v_ov, CASE WHEN v_ov IS NULL THEN 'lg120-fixture@example.invalid' END, 'LG120-1', 'LG120 row',
          v_line, 'LG120 Released', 'LG120 released',
          (SELECT r.master_rfp || jsonb_build_object('nda_link', NULL) FROM public.rfp_records r WHERE r.id = v_rec));
  UPDATE public.rfp_records SET broadcast_at = now() WHERE id = v_rec;
  IF v_tok IS NOT NULL THEN
    UPDATE public.rfp_magic_tokens
       SET reference_materials = CASE WHEN jsonb_typeof(reference_materials) = 'object'
                                      THEN reference_materials || jsonb_build_object('lg120_extra', '')
                                      ELSE jsonb_build_object('materials', coalesce(reference_materials, '[]'::jsonb), 'lg120_extra', '') END
     WHERE id::text = v_tok;
  END IF;

  ---------------------------------------------------------------------
  -- THE SCENARIOS. Parallel arrays; position i describes scenario i. sc_sql runs as the actor.
  -- sc_needs names subjects a scenario needs beyond its actor (comma-separated: tok, ov).
  -- format() arguments: %1$L p1  %2$L o1  %3$L rec  %4$L line  %5$L fixture row  %6$L tok
  --                     %7$L vendor org  %8$L the code's allow-list  %9$L a fresh row id
  ---------------------------------------------------------------------
  sc_id := ARRAY['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'W1',
                 'A1', 'A2', 'A3', 'A4', 'A5', 'O1', 'O2', 'N1', 'N2'];

  sc_label := ARRAY[
    $l$V1  vendor: own rows carry a key outside the allow-list$l$,
    $l$V2  vendor: own rows carry the client name in the copy$l$,
    $l$V3  vendor: own rows carry the rubric (evaluation_criteria)$l$,
    $l$V4  vendor: own rows carry a budget in the copy$l$,
    $l$V5  vendor: own rows carry other lines (scopeItems)$l$,
    $l$V6  vendor: own rows carry _magic_token$l$,
    $l$V7  vendor: released client name and budget survive$l$,
    $l$W1  vendor: writes a disallowed key into its copy, refused$l$,
    $l$A1  agency: updates a copy with a disallowed key$l$,
    $l$A2  agency: inserts a copy with a disallowed key$l$,
    $l$A3  agency: inserts a copy of allowed keys only$l$,
    $l$A4  agency: token reference_materials, disallowed key$l$,
    $l$A5  agency: token reference_materials, materials only$l$,
    $l$O1  owner (trusted path): updates a copy, disallowed key$l$,
    $l$O2  owner (trusted path): inserts a copy, disallowed key$l$,
    $l$N1  anon: cannot read inbox rows$l$,
    $l$N2  anon: cannot read tokens$l$];

  sc_actor := ARRAY['vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor',
                    'm1', 'm1', 'm1', 'm1', 'm1', 'owner', 'owner', 'anon', 'anon'];

  sc_needs := ARRAY['', '', '', '', '', '', '', '',
                    '', '', '', 'tok', 'tok', '', '', '', ''];

  sc_sql := ARRAY[
    q_some || $q$EXISTS (SELECT 1 FROM jsonb_object_keys(i.master_rfp_json) k WHERE NOT (k = ANY (%8$L::text[])))$q$,
    q_some || $q$i.master_rfp_json ? 'client'$q$,
    q_some || $q$i.master_rfp_json ? 'evaluation_criteria'$q$,
    q_some || $q$(i.master_rfp_json ? 'totalBudget' OR jsonb_path_exists(i.master_rfp_json, '$.scopeItems[*].estimatedBudget'))$q$,
    q_some || $q$i.master_rfp_json ? 'scopeItems'$q$,
    q_some || $q$i.master_rfp_json ? '_magic_token'$q$,
    $q$SELECT coalesce(i.client_name_released, 'NULL') || '|' || coalesce(i.estimated_budget, 'NULL') FROM public.partner_rfp_inbox i WHERE i.id = %5$L$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET master_rfp_json = master_rfp_json || '{"client": "LG120 W1"}'::jsonb WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET master_rfp_json = master_rfp_json || '{"client": "LG120 A1"}'::jsonb WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name, master_rfp_json) VALUES (%9$L, %2$L, 'lg120-a2@example.invalid', 'LG120-A2', 'LG120 A2', '{"projectName": "LG120", "evaluation_criteria": []}'::jsonb) RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name, master_rfp_json) VALUES (%9$L, %2$L, 'lg120-a3@example.invalid', 'LG120-A3', 'LG120 A3', '{"projectName": "LG120", "overview": "LG120", "budget_categories": [], "nda_link": null}'::jsonb) RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.rfp_magic_tokens SET reference_materials = '{"materials": [], "output_template_config": {"lg120": true}}'::jsonb WHERE id::text = %6$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.rfp_magic_tokens SET reference_materials = '{"materials": []}'::jsonb WHERE id::text = %6$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (UPDATE public.partner_rfp_inbox SET master_rfp_json = master_rfp_json || '{"_magic_token": "lg120-o1"}'::jsonb WHERE id = %5$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH u AS (INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name, master_rfp_json) VALUES (%9$L, %2$L, 'lg120-o2@example.invalid', 'LG120-O2', 'LG120 O2', '{"projectName": "LG120", "client": "LG120 O2"}'::jsonb) RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.partner_rfp_inbox$q$,
    $q$SELECT count(*)::text FROM public.rfp_magic_tokens$q$];

  sc_exp := ARRAY[
    'OK:SOME', 'OK:NONE',                  -- V1
    'OK:SOME', 'OK:NONE',                  -- V2
    'OK:SOME', 'OK:NONE',                  -- V3
    'OK:SOME', 'OK:NONE',                  -- V4
    'OK:SOME', 'OK:NONE',                  -- V5
    'OK:SOME', 'OK:NONE',                  -- V6
    'OK:LG120 Released|LG120 released', 'OK:LG120 Released|LG120 released',   -- V7
    'E:42501', 'E:42501',                  -- W1
    'OK:1', 'E:23514',                     -- A1
    'OK:1', 'E:23514',                     -- A2
    'OK:1', 'OK:1',                        -- A3
    'OK:1', 'E:23514',                     -- A4
    'OK:1', 'OK:1',                        -- A5
    'OK:1', 'E:23514',                     -- O1
    'OK:1', 'E:23514',                     -- O2
    'OK:0 OR E:42501', 'OK:0 OR E:42501',  -- N1
    'OK:0 OR E:42501', 'OK:0 OR E:42501']; -- N2

  v_n := array_length(sc_id, 1);
  IF v_n <> 17 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_needs, 1) <> v_n OR array_length(sc_sql, 1) <> v_n OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (ids %, labels %, actors %, needs %, sqls %, expectations %)',
      v_n, array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_needs, 1),
      array_length(sc_sql, 1), array_length(sc_exp, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  ---------------------------------------------------------------------
  -- BEFORE 120 (with the fixture in place): the state the self-checks compare against.
  ---------------------------------------------------------------------
  EXECUTE v_pol_sql  INTO v_pol_before;
  EXECUTE v_acl_sql  INTO v_acl_before;
  EXECUTE v_trg_sql  INTO v_trg_before;
  EXECUTE v_rows_sql INTO v_rows_before;
  EXECUTE v_kept_sql INTO v_kept_before;
  SELECT array_agg(p.proname || '(' || oidvectortypes(p.proargtypes) || ')' ORDER BY p.proname, oidvectortypes(p.proargtypes)) INTO v_fn_before
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
  SELECT count(*) INTO v_inbox_n0 FROM public.partner_rfp_inbox;
  SELECT count(*) INTO v_tok_n0 FROM public.rfp_magic_tokens;
  SELECT EXISTS (SELECT 1 FROM public.partner_rfp_inbox i, jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
                  WHERE i.id = c_refused_row AND NOT (k = ANY (c_allow_code)))
    INTO v_refused_had;
  SELECT format('%s inbox rows (%s unlinked, %s carrying a key outside the allow-list, fixture included), %s tokens (%s with a reference_materials key outside its allow-list)',
                count(*), count(*) FILTER (WHERE i.rfp_line_id IS NULL),
                count(*) FILTER (WHERE jsonb_typeof(i.master_rfp_json) = 'object'
                                   AND EXISTS (SELECT 1 FROM jsonb_object_keys(i.master_rfp_json) k WHERE NOT (k = ANY (c_allow_code)))),
                (SELECT count(*) FROM public.rfp_magic_tokens),
                (SELECT count(*) FROM public.rfp_magic_tokens t WHERE jsonb_typeof(t.reference_materials) = 'object'
                   AND EXISTS (SELECT 1 FROM jsonb_object_keys(t.reference_materials) k WHERE NOT (k = ANY (c_token_code)))))
    INTO v_before_info
    FROM public.partner_rfp_inbox i;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 120 is executed between phases.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    EXECUTE v_fp_sql INTO v_fp0;

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];
      v_uid := CASE v_actor WHEN 'm1' THEN v_u1 WHEN 'vendor' THEN v_uv ELSE NULL END;

      v_nosubj := v_p1 IS NULL OR (v_actor IN ('m1', 'vendor') AND v_uid IS NULL);
      IF v_actor = 'vendor' AND v_ov IS NULL THEN v_nosubj := true; END IF;
      FOREACH v_need IN ARRAY string_to_array(sc_needs[v_i], ',') LOOP
        IF (v_need = 'tok' AND v_tok IS NULL) THEN
          v_nosubj := true;
        END IF;
      END LOOP;

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

          -- IMPERSONATION, proved. The owner stays the owner (118's trusted path).
          BEGIN
            IF v_actor = 'anon' THEN
              SET LOCAL ROLE anon;
              IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
                RAISE EXCEPTION 'impersonation mismatch (anon): current_user is %, uid %', current_user, auth.uid();
              END IF;
            ELSIF v_actor = 'owner' THEN
              IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
                RAISE EXCEPTION 'impersonation mismatch (owner): current_user is %, uid %', current_user, auth.uid();
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
            format(sc_sql[v_i], v_p1, v_o1, v_rec, v_line, v_inbf, v_tok, v_ov, c_allow_code::text, v_newid),
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
              WHEN SQLSTATE IN ('42P01', '42703', '42883') THEN 'MISSING'
              ELSE 'E:' || SQLSTATE
            END;
        END;
      END IF;

      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      EXECUTE v_fp_sql INTO v_fp;
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
        v_body := $m120$
-- >>> 120 BODY START
-- ---------------------------------------------------------------------
-- 0. THE ALLOW-LISTS. ONE COPY EACH, used by the pre-flight, the scrub and the guard below.
--    lib/rfp-vendor-copy.ts holds the same lists. Created first so nothing else carries a copy; a
--    pre-flight refusal below aborts the transaction and takes them with it.
--    EXECUTE: not PUBLIC, not anon; authenticated (and the service role) may, because the guard
--    triggers call them as the invoker on every agency and service-role write.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rfp_vendor_copy_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT ARRAY['projectName','overview','objectives','timeline','business_criteria_required','budget_categories','nda_link','response_deadline']::text[]
$fn$;

COMMENT ON FUNCTION public.rfp_vendor_copy_keys() IS
  'Migration 120. The top-level keys a vendor copy (partner_rfp_inbox.master_rfp_json) may carry. '
  'The same list as lib/rfp-vendor-copy.ts VENDOR_COPY_KEYS. No client, budget, other line, rubric or _magic_token.';

REVOKE EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() FROM anon;
GRANT  EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rfp_vendor_copy_keys() TO service_role;

CREATE OR REPLACE FUNCTION public.rfp_token_reference_materials_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT ARRAY['materials']::text[]
$fn$;

COMMENT ON FUNCTION public.rfp_token_reference_materials_keys() IS
  'Migration 120. The keys rfp_magic_tokens.reference_materials may carry when it is an object. The same list as '
  'lib/rfp-vendor-copy.ts TOKEN_REFERENCE_MATERIALS_KEYS. output_template_config lives on the RFP record (D9).';

REVOKE EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() FROM anon;
GRANT  EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rfp_token_reference_materials_keys() TO service_role;


-- ---------------------------------------------------------------------
-- 1. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION. Nothing but the two list functions above is
--    written before it, and a refusal aborts the transaction.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  -- The one unlinked row the owner accepted (119 refused it: its token row no longer exists).
  c_expected_unlinked CONSTANT uuid[] := ARRAY['04391718-bf70-4d63-a0d6-ea773003b6cc']::uuid[];
  c_allow       CONSTANT text[] := public.rfp_vendor_copy_keys();
  c_allow_token CONSTANT text[] := public.rfp_token_reference_materials_keys();
  v_list text;
BEGIN
  -- 118's trusted path. Never weaken a guard to make this pass.
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '120 refuses to run: it must run with no end-user session (the SQL Editor role), which is 118''s trusted path. auth.uid() is %, current_user is %.', auth.uid(), current_user
      USING ERRCODE = 'LG120';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O'
         AND (c.relname::text, t.tgname::text) IN (('rfp_records', 'rfp_records_guard'),
                                                   ('rfp_record_lines', 'rfp_record_lines_guard'),
                                                   ('partner_rfp_inbox', 'partner_rfp_inbox_link_columns_guard'),
                                                   ('rfp_magic_tokens', 'rfp_magic_tokens_link_columns_guard'))) <> 4 THEN
    RAISE EXCEPTION '120 refuses to run: one of 118''s four guards is missing or not enabled.'
      USING ERRCODE = 'LG120';
  END IF;

  -- 119 has run.
  IF to_regprocedure('public.rfp_record_set_client_visibility(uuid, boolean)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.rfp_records WHERE source = 'backfill') THEN
    RAISE EXCEPTION '120 refuses to run: 119 has not run (rfp_record_set_client_visibility is missing, or no backfilled record exists). Apply 119 first.'
      USING ERRCODE = 'LG120';
  END IF;

  -- No linked row or token points at a missing line.
  SELECT string_agg(x, ', ') INTO v_list FROM (
    SELECT 'inbox ' || i.id::text AS x FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.id = i.rfp_line_id)
    UNION ALL
    SELECT 'token row ' || t.id::text FROM public.rfp_magic_tokens t
     WHERE t.rfp_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.id = t.rfp_line_id)
    LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: linked rows point at a missing RFP record line: %', v_list USING ERRCODE = 'LG120';
  END IF;

  -- Every vendor copy is NULL or an object.
  SELECT string_agg(i.id::text || ' (' || jsonb_typeof(i.master_rfp_json) || ')', ', ') INTO v_list
    FROM (SELECT * FROM public.partner_rfp_inbox
           WHERE master_rfp_json IS NOT NULL AND jsonb_typeof(master_rfp_json) <> 'object' LIMIT 50) i;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: these inbox rows hold a master_rfp_json that is not an object: %', v_list USING ERRCODE = 'LG120';
  END IF;

  -- NO DATA LOSS ON A LINKED INBOX ROW, AND NO LOST JOIN.
  SELECT string_agg(x, '; ') INTO v_list FROM (
    SELECT 'inbox ' || i.id::text || ' key ' || e.key AS x
      FROM public.partner_rfp_inbox i
      JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
      JOIN public.rfp_records r ON r.id = l.rfp_id
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) AS e(key, value)
     WHERE NOT (e.key = ANY (c_allow))
       AND NOT (e.value IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
                OR (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = ''))
       AND NOT (
         coalesce((r.master_rfp -> e.key) NOT IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
         OR CASE e.key
              WHEN 'evaluation_criteria' THEN coalesce(r.evaluation_criteria NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
              WHEN 'client'              THEN coalesce(btrim(r.client_name_snapshot) <> '', false)
              WHEN 'totalBudget'         THEN coalesce(btrim(r.total_budget) <> '', false)
              WHEN 'scopeItems'          THEN true
              WHEN '_magic_token'        THEN NOT EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk WHERE tk.token = e.value #>> '{}')
                                              OR EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk
                                                          WHERE tk.token = e.value #>> '{}' AND tk.org_id = i.lead_org_id
                                                            AND (tk.attached_inbox_id = i.id OR tk.rfp_line_id = i.rfp_line_id))
              ELSE false
            END)
     ORDER BY i.id, e.key
     LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: the scrub would remove a value from a linked inbox row that its RFP record does not hold (or the only join to a live token): %', v_list
      USING ERRCODE = 'LG120';
  END IF;

  -- UNLINKED INBOX ROWS: only the accepted row may lose a non-empty key; no unlinked row may lose
  -- the only join to a token that still exists.
  SELECT string_agg(x, '; ') INTO v_list FROM (
    SELECT 'inbox ' || i.id::text || ' key ' || e.key AS x
      FROM public.partner_rfp_inbox i
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) AS e(key, value)
     WHERE i.rfp_line_id IS NULL
       AND NOT (e.key = ANY (c_allow))
       AND NOT (e.value IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
                OR (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = ''))
       AND (NOT (i.id = ANY (c_expected_unlinked))
            OR (e.key = '_magic_token' AND EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk WHERE tk.token = e.value #>> '{}')))
     ORDER BY i.id, e.key
     LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: an unlinked inbox row other than 04391718 would lose a value no RFP record holds (or the only join to a live token): %', v_list
      USING ERRCODE = 'LG120';
  END IF;

  -- TOKENS: a removed reference_materials key with a non-empty value must be held by the record.
  SELECT string_agg(x, '; ') INTO v_list FROM (
    SELECT 'token row ' || t.id::text || ' key ' || e.key AS x
      FROM public.rfp_magic_tokens t
      LEFT JOIN public.rfp_record_lines l ON l.id = t.rfp_line_id
      LEFT JOIN public.rfp_records r ON r.id = l.rfp_id
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) AS e(key, value)
     WHERE NOT (e.key = ANY (c_allow_token))
       AND NOT (e.value IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
                OR (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = ''))
       AND NOT (r.id IS NOT NULL
                AND (coalesce((r.master_rfp -> e.key) NOT IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
                     OR (e.key = 'output_template_config'
                         AND coalesce(r.output_template_config NOT IN ('null'::jsonb, '{}'::jsonb), false))))
     ORDER BY t.id::text, e.key
     LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '120 refuses to run: the scrub would remove a token reference_materials value its RFP record does not hold: %', v_list
      USING ERRCODE = 'LG120';
  END IF;

  -- Captured for the post-check and the result.
  -- A previous run is recognised by its guard trigger (created last, section 3).
  PERFORM set_config('ligament.m120_present',
                     CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                                        WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
                                          AND c.relname = 'partner_rfp_inbox' AND t.tgname = 'partner_rfp_inbox_vendor_copy_guard')
                          THEN '1' ELSE '0' END, true);
  PERFORM set_config('ligament.m120_counts',
                     (SELECT count(*) FROM public.partner_rfp_inbox)::text || ',' || (SELECT count(*) FROM public.rfp_magic_tokens)::text, true);
END
$preflight$;


-- ---------------------------------------------------------------------
-- 2. THE SCRUB. The JSON columns only; rows carrying no removed key are not written.
-- ---------------------------------------------------------------------
DO $scrub$
DECLARE
  v_inbox_scrubbed  bigint;
  v_inbox_linked    bigint;
  v_inbox_unlinked  bigint;
  v_tokens_scrubbed bigint;
  v_keys            jsonb;
  v_unlinked        jsonb;
  v_present         boolean := current_setting('ligament.m120_present', true) = '1';
BEGIN
  -- What is about to go, by key, for the record (inbox and tokens).
  SELECT coalesce(jsonb_object_agg(x.key, x.n), '{}'::jsonb) INTO v_keys FROM (
    SELECT 'inbox.' || k AS key, count(*) AS n
      FROM public.partner_rfp_inbox i,
           jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
     WHERE NOT (k = ANY (public.rfp_vendor_copy_keys()))
     GROUP BY k
    UNION ALL
    SELECT 'token.reference_materials.' || k, count(*)
      FROM public.rfp_magic_tokens t,
           jsonb_object_keys(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) k
     WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys()))
     GROUP BY k) x;

  SELECT coalesce(jsonb_agg(i.id::text ORDER BY i.id), '[]'::jsonb) INTO v_unlinked
    FROM public.partner_rfp_inbox i
   WHERE i.rfp_line_id IS NULL
     AND jsonb_typeof(i.master_rfp_json) = 'object'
     AND EXISTS (SELECT 1 FROM jsonb_object_keys(i.master_rfp_json) k WHERE NOT (k = ANY (public.rfp_vendor_copy_keys())));

  WITH s AS (
    UPDATE public.partner_rfp_inbox i
       SET master_rfp_json = (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                FROM jsonb_each(i.master_rfp_json) AS e(key, value)
                               WHERE e.key = ANY (public.rfp_vendor_copy_keys()))
     WHERE jsonb_typeof(i.master_rfp_json) = 'object'
       AND EXISTS (SELECT 1 FROM jsonb_object_keys(i.master_rfp_json) k WHERE NOT (k = ANY (public.rfp_vendor_copy_keys())))
    RETURNING i.rfp_line_id
  )
  SELECT count(*), count(*) FILTER (WHERE rfp_line_id IS NOT NULL), count(*) FILTER (WHERE rfp_line_id IS NULL)
    INTO v_inbox_scrubbed, v_inbox_linked, v_inbox_unlinked
    FROM s;

  WITH s AS (
    UPDATE public.rfp_magic_tokens t
       SET reference_materials = (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                    FROM jsonb_each(t.reference_materials) AS e(key, value)
                                   WHERE e.key = ANY (public.rfp_token_reference_materials_keys()))
     WHERE jsonb_typeof(t.reference_materials) = 'object'
       AND EXISTS (SELECT 1 FROM jsonb_object_keys(t.reference_materials) k WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys())))
    RETURNING 1
  )
  SELECT count(*) INTO v_tokens_scrubbed FROM s;

  PERFORM set_config('ligament.scrub_120', jsonb_build_object(
    'already_applied',        v_present AND v_inbox_scrubbed = 0 AND v_tokens_scrubbed = 0,
    'inbox_scrubbed',         v_inbox_scrubbed,
    'inbox_scrubbed_linked',  v_inbox_linked,
    'inbox_scrubbed_unlinked', v_inbox_unlinked,
    'unlinked_scrubbed_ids',  v_unlinked,
    'tokens_scrubbed',        v_tokens_scrubbed,
    'removed_keys',           v_keys)::text, true);
END
$scrub$;


-- ---------------------------------------------------------------------
-- 3. THE GUARD. For every role. A key outside the allow-list, or a vendor copy that is not an
--    object, raises 23514. Checked on insert, and on update only when the JSON column changes
--    (every existing row is compliant after the scrub above).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_rfp_inbox_vendor_copy_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bad text;
BEGIN
  IF NEW.master_rfp_json IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.master_rfp_json IS NOT DISTINCT FROM OLD.master_rfp_json THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.master_rfp_json) <> 'object' THEN
    RAISE EXCEPTION 'A vendor copy must be a JSON object.'
      USING ERRCODE = '23514',
            DETAIL  = 'partner_rfp_inbox.master_rfp_json must be NULL or an object of allow-listed keys (migration 120).';
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(NEW.master_rfp_json) k
   WHERE NOT (k = ANY (public.rfp_vendor_copy_keys()));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A vendor copy may not carry %.', v_bad
      USING ERRCODE = '23514',
            DETAIL  = 'partner_rfp_inbox.master_rfp_json may hold only public.rfp_vendor_copy_keys() (migration 120; lib/rfp-vendor-copy.ts). The client name and budget go in client_name_released and estimated_budget; the rest of the RFP is on the agency''s record.';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() IS
  'Migration 120. BEFORE INSERT OR UPDATE on partner_rfp_inbox, every role: master_rfp_json must be NULL or an '
  'object whose keys are all in rfp_vendor_copy_keys() (23514). Checked on insert and when the column changes.';

REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_inbox_vendor_copy_guard() FROM authenticated;

CREATE OR REPLACE TRIGGER partner_rfp_inbox_vendor_copy_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_inbox
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_inbox_vendor_copy_guard();

CREATE OR REPLACE FUNCTION public.rfp_magic_tokens_vendor_copy_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bad text;
BEGIN
  IF NEW.reference_materials IS NULL OR jsonb_typeof(NEW.reference_materials) <> 'object' THEN
    -- NULL, or the legacy bare array of materials: nothing agency-only can hide in it by key.
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.reference_materials IS NOT DISTINCT FROM OLD.reference_materials THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(NEW.reference_materials) k
   WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys()));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A Lightning RFP invitation''s reference materials may not carry %.', v_bad
      USING ERRCODE = '23514',
            DETAIL  = 'rfp_magic_tokens.reference_materials may hold only public.rfp_token_reference_materials_keys() (migration 120). The output template lives on the RFP record (D9).';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() IS
  'Migration 120. BEFORE INSERT OR UPDATE on rfp_magic_tokens, every role: an object reference_materials may '
  'carry only rfp_token_reference_materials_keys() (23514). Checked on insert and when the column changes.';

REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rfp_magic_tokens_vendor_copy_guard() FROM authenticated;

CREATE OR REPLACE TRIGGER rfp_magic_tokens_vendor_copy_guard
  BEFORE INSERT OR UPDATE ON public.rfp_magic_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.rfp_magic_tokens_vendor_copy_guard();


-- ---------------------------------------------------------------------
-- 4. POST-CHECK AND RESULT. Any shortfall aborts the file: nothing is committed.
-- ---------------------------------------------------------------------
DO $post$
DECLARE
  v_res     jsonb := current_setting('ligament.scrub_120', true)::jsonb;
  v_counts  text := current_setting('ligament.m120_counts', true);
  v_left    bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.partner_rfp_inbox i,
                 jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
           WHERE NOT (k = ANY (public.rfp_vendor_copy_keys())))
       + (SELECT count(*) FROM public.rfp_magic_tokens t,
                 jsonb_object_keys(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) k
           WHERE NOT (k = ANY (public.rfp_token_reference_materials_keys())))
    INTO v_left;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '120 stopped: % key(s) outside the allow-lists remain after the scrub. Nothing was committed.', v_left
      USING ERRCODE = 'LG120';
  END IF;

  IF v_counts IS DISTINCT FROM ((SELECT count(*) FROM public.partner_rfp_inbox)::text || ',' || (SELECT count(*) FROM public.rfp_magic_tokens)::text) THEN
    RAISE EXCEPTION '120 stopped: the inbox or token row count changed during the scrub (before %). Nothing was committed.', v_counts
      USING ERRCODE = 'LG120';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O'
         AND (c.relname::text, t.tgname::text) IN (('partner_rfp_inbox', 'partner_rfp_inbox_vendor_copy_guard'),
                                                   ('rfp_magic_tokens', 'rfp_magic_tokens_vendor_copy_guard'))) <> 2 THEN
    RAISE EXCEPTION '120 stopped: a vendor-copy guard trigger is missing or not enabled. Nothing was committed.'
      USING ERRCODE = 'LG120';
  END IF;

  IF (v_res ->> 'already_applied')::boolean THEN
    RAISE NOTICE '120 already applied: nothing changed (0 inbox rows and 0 tokens scrubbed; the allow-lists and guards are unchanged).';
  ELSE
    RAISE NOTICE E'120 SCRUB DONE.\n  inbox rows scrubbed: % (linked %, unlinked %)\n  unlinked rows scrubbed (no RFP record holds their removed keys): %\n  tokens scrubbed (reference_materials): %\n  removed keys (rows carrying each): %\n  rows in partner_rfp_inbox and rfp_magic_tokens: % (unchanged)',
      v_res ->> 'inbox_scrubbed', v_res ->> 'inbox_scrubbed_linked', v_res ->> 'inbox_scrubbed_unlinked',
      v_res -> 'unlinked_scrubbed_ids', v_res ->> 'tokens_scrubbed', v_res -> 'removed_keys', v_counts;
  END IF;
END
$post$;
-- <<< 120 BODY END
        $m120$;
        EXECUTE v_body;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('120 raised ' || SQLSTATE || ': ' || left(SQLERRM, 600));
      END;
      v_res := nullif(current_setting('ligament.scrub_120', true), '')::jsonb;
    END IF;
  END LOOP;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  ---------------------------------------------------------------------
  -- AFTER 120.
  ---------------------------------------------------------------------
  EXECUTE v_pol_sql  INTO v_pol_after;
  EXECUTE v_acl_sql  INTO v_acl_after;
  EXECUTE v_trg_sql  INTO v_trg_after;
  EXECUTE v_rows_sql INTO v_rows_after;
  EXECUTE v_kept_sql INTO v_kept_after;
  SELECT array_agg(p.proname || '(' || oidvectortypes(p.proargtypes) || ')' ORDER BY p.proname, oidvectortypes(p.proargtypes)) INTO v_fn_after
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
  SELECT count(*) INTO v_inbox_n1 FROM public.partner_rfp_inbox;
  SELECT count(*) INTO v_tok_n1 FROM public.rfp_magic_tokens;
  SELECT count(*) INTO v_pol_count FROM pg_policies WHERE schemaname = 'public';

  ---------------------------------------------------------------------
  -- JUDGEMENT, exactly 118's and 119's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
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
    END IF;
    IF v_st = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_st = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1; END IF;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 66) || rpad(v_st, 14) || v_detail;
  END LOOP;

  ---------------------------------------------------------------------
  -- THE SELF-CHECKS, S1-S11.
  ---------------------------------------------------------------------

  -- S1. No policy changed (120 adds none).
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(policies in public: %s, expected 161 ; fingerprint %s)', v_pol_count, CASE WHEN v_ok THEN 'unchanged' ELSE 'CHANGED' END);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S2. No table, column or function grant changed outside the four new functions.
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no grant changed outside the new functions', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no grant changed outside the new functions', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S3. Triggers changed only by the two new guards: every other trigger unchanged, and the two
  --     exist, enabled, BEFORE ROW INSERT OR UPDATE (tgtype 23), on their tables.
  SELECT count(*) INTO v_n1
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O' AND t.tgtype = 23
     AND (c.relname::text, t.tgname::text, p.proname::text) IN
         (('partner_rfp_inbox', 'partner_rfp_inbox_vendor_copy_guard', 'partner_rfp_inbox_vendor_copy_guard'),
          ('rfp_magic_tokens', 'rfp_magic_tokens_vendor_copy_guard', 'rfp_magic_tokens_vendor_copy_guard'));
  v_ok := v_trg_before IS NOT DISTINCT FROM v_trg_after AND v_n1 = 2;
  v_detail := format('(other triggers %s ; new guards present and BEFORE ROW INSERT OR UPDATE: %s of 2)',
                     CASE WHEN v_trg_before IS NOT DISTINCT FROM v_trg_after THEN 'unchanged' ELSE 'CHANGED' END, v_n1);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S3  triggers changed only by the two new guards', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S3  triggers changed only by the two new guards', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S4. Exactly the four expected functions added, none removed.
  SELECT coalesce(string_agg(x, ', ' ORDER BY x), '') INTO v_detail
    FROM (SELECT unnest(v_fn_after) EXCEPT SELECT unnest(v_fn_before)) AS a(x);
  SELECT coalesce(string_agg(x, ', ' ORDER BY x), '') INTO v_txt
    FROM (SELECT unnest(v_fn_before) EXCEPT SELECT unnest(v_fn_after)) AS b(x);
  v_ok := v_detail = c_fn_new AND v_txt = '';
  v_detail := format('(added: %s ; removed: %s)', CASE WHEN v_detail = '' THEN 'none' ELSE v_detail END, CASE WHEN v_txt = '' THEN 'none' ELSE v_txt END);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S4  exactly the four expected functions added', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S4  exactly the four expected functions added', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S5. The four functions: SECURITY INVOKER, search_path pinned, no PUBLIC entry; the guards
  --     executable by neither anon nor authenticated; the lists by authenticated, not anon.
  SELECT count(*) FILTER (WHERE NOT p.prosecdef
                            AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
                            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
                            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = (p.proname LIKE '%keys'))
    INTO v_n1
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('rfp_vendor_copy_keys', 'rfp_token_reference_materials_keys',
                      'partner_rfp_inbox_vendor_copy_guard', 'rfp_magic_tokens_vendor_copy_guard');
  v_ok := v_n1 = 4;
  v_detail := format('(%s of 4 as expected; read 120''s V3)', v_n1);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S5  functions: invoker, pinned; EXECUTE as designed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S5  functions: invoker, pinned; EXECUTE as designed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S6. The allow-lists in the migration equal the allow-lists in the code (same keys, same order).
  BEGIN
    v_ok := public.rfp_vendor_copy_keys() = c_allow_code AND public.rfp_token_reference_materials_keys() = c_token_code;
    v_detail := format('(migration %s / %s ; code %s / %s)', public.rfp_vendor_copy_keys(), public.rfp_token_reference_materials_keys(), c_allow_code, c_token_code);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := '(the allow-list functions are not readable: ' || SQLSTATE || ')';
  END;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S6  allow-lists: migration equals lib/rfp-vendor-copy.ts', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S6  allow-lists: migration equals lib/rfp-vendor-copy.ts', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S7. Counts unchanged, and no column but the two JSON columns written on any row.
  v_ok := v_rows_before IS NOT DISTINCT FROM v_rows_after AND v_inbox_n0 = v_inbox_n1 AND v_tok_n0 = v_tok_n1;
  v_detail := format('(inbox rows %s -> %s ; tokens %s -> %s ; every other column %s)', v_inbox_n0, v_inbox_n1, v_tok_n0, v_tok_n1,
                     CASE WHEN v_rows_before IS NOT DISTINCT FROM v_rows_after THEN 'unchanged' ELSE 'CHANGED' END);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S7  counts same; only the two JSON columns written', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S7  counts same; only the two JSON columns written', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S8. After 120, no row anywhere carries a key outside its allow-list.
  SELECT (SELECT count(*) FROM public.partner_rfp_inbox i,
                 jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
           WHERE NOT (k = ANY (c_allow_code))),
         (SELECT count(*) FROM public.rfp_magic_tokens t,
                 jsonb_object_keys(CASE WHEN jsonb_typeof(t.reference_materials) = 'object' THEN t.reference_materials ELSE '{}'::jsonb END) k
           WHERE NOT (k = ANY (c_token_code)))
    INTO v_n1, v_n2;
  v_ok := v_n1 = 0 AND v_n2 = 0 AND array_length(v_apply_err, 1) IS NULL;
  v_detail := format('(inbox keys outside the allow-list %s ; token keys %s)', v_n1, v_n2);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S8  no key outside the allow-lists on any row', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S8  no key outside the allow-lists on any row', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S9. Every kept key's value unchanged (120 removes keys, never edits a kept one).
  v_ok := v_kept_before IS NOT DISTINCT FROM v_kept_after;
  v_detail := format('(kept keys %s)', CASE WHEN v_ok THEN 'unchanged' ELSE 'CHANGED' END);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S9  every kept key and value unchanged', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S9  every kept key and value unchanged', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S10. The row 119 refused (inbox 04391718): still unlinked, scrubbed, and listed when it carried a removed key.
  IF NOT EXISTS (SELECT 1 FROM public.partner_rfp_inbox WHERE id = c_refused_row) THEN
    v_inconc := v_inconc + 1; v_ran := v_ran + 1; v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad('S10 refused row 04391718: unlinked, scrubbed, listed', 66) || rpad('INCONCLUSIVE', 14) || '[NO SUBJECT: the row no longer exists]';
  ELSE
    SELECT (i.rfp_line_id IS NULL),
           NOT EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) k
                        WHERE NOT (k = ANY (c_allow_code)))
      INTO v_ok, v_same
      FROM public.partner_rfp_inbox i WHERE i.id = c_refused_row;
    v_all_nosubj := v_res IS NOT NULL AND (v_res -> 'unlinked_scrubbed_ids') ? c_refused_row::text;
    v_ok := v_ok AND v_same AND (v_all_nosubj OR NOT v_refused_had);
    v_detail := format('(unlinked %s ; scrubbed %s ; carried a removed key before %s ; listed %s)',
                       (SELECT (rfp_line_id IS NULL)::text FROM public.partner_rfp_inbox WHERE id = c_refused_row), v_same, v_refused_had, v_all_nosubj);
    v_ran := v_ran + 1; v_logged := v_logged + 1;
    IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S10 refused row 04391718: unlinked, scrubbed, listed', 66) || rpad('PASS', 14) || v_detail;
    ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S10 refused row 04391718: unlinked, scrubbed, listed', 66) || rpad('FAIL', 14) || v_detail; END IF;
  END IF;

  -- S11. Idempotency: a second run of the SAME inlined body changes nothing and says so.
  IF array_length(v_apply_err, 1) IS NULL AND v_body IS NOT NULL THEN
    EXECUTE v_whole_sql INTO v_whole_fp0;
    BEGIN
      EXECUTE v_body;
      EXECUTE v_whole_sql INTO v_whole_fp1;
      v_res2 := nullif(current_setting('ligament.scrub_120', true), '')::jsonb;
      v_idem := format('ran; already_applied %s ; inbox scrubbed %s ; tokens scrubbed %s ; rows %s',
                       v_res2 ->> 'already_applied', v_res2 ->> 'inbox_scrubbed', v_res2 ->> 'tokens_scrubbed',
                       CASE WHEN v_whole_fp0 IS NOT DISTINCT FROM v_whole_fp1 THEN 'unchanged' ELSE 'CHANGED' END);
      RAISE EXCEPTION 'undo' USING ERRCODE = 'LG097';
    EXCEPTION
      WHEN sqlstate 'LG097' THEN NULL;
      WHEN OTHERS THEN v_idem := 'ERROR ' || SQLSTATE || ' ' || left(SQLERRM, 200);
    END;
  END IF;
  v_ok := v_idem LIKE 'ran; already_applied true ; inbox scrubbed 0 ; tokens scrubbed 0 ; rows unchanged';
  v_detail := format('(second run: %s)', v_idem);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S11 idempotency: a second run changes nothing, says so', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S11 idempotency: a second run changes nothing, says so', 66) || rpad('FAIL', 14) || v_detail; END IF;

  ---------------------------------------------------------------------
  -- THE SCRUB, AS THE REAL APPLY WILL DO IT (from ligament.scrub_120; the fixture is included in
  -- these counts: subtract one inbox row and, when a test token exists, one token). Plus the
  -- findings 120 deliberately does not touch.
  ---------------------------------------------------------------------
  SELECT count(*) INTO v_n1 FROM public.partner_rfp_inbox i JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
   WHERE i.id <> v_inbf AND nullif(btrim(i.estimated_budget), '') IS DISTINCT FROM nullif(btrim(l.released_budget), '');
  SELECT count(*) INTO v_n2 FROM public.partner_rfp_inbox i WHERE i.scope_item_id LIKE 'magic:%';
  IF v_res IS NULL THEN
    v_scrub := E'  (not readable: read 120''s V1 after a dry run)\n';
  ELSE
    v_scrub :=
         format(E'  inbox rows scrubbed %s (linked %s, unlinked %s) ; tokens scrubbed %s\n',
                v_res ->> 'inbox_scrubbed', v_res ->> 'inbox_scrubbed_linked', v_res ->> 'inbox_scrubbed_unlinked', v_res ->> 'tokens_scrubbed')
      || format(E'  unlinked rows scrubbed: %s\n', v_res -> 'unlinked_scrubbed_ids')
      || format(E'  removed keys (rows carrying each): %s\n', v_res -> 'removed_keys');
  END IF;
  v_scrub := v_scrub
    || format(E'  FINDING (not changed by 120): linked inbox rows whose estimated_budget is not the line''s released budget: %s\n', v_n1)
    || format(E'  FINDING (not changed by 120): inbox rows whose scope_item_id carries a token (magic:<token>): %s\n', v_n2);

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
    v_headline := format('DO NOT APPLY 120.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 120.';
    v_headline := format('SAFE TO APPLY 120.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 120 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 120 does what it claims.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 120.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s: 17 scenarios + 11 self-checks + M)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0; none by design)\n', v_inconc)
    || format(E'BEFORE 120      : %s\n', v_before_info)
    || format(E'isolation check : %s scenario run(s) compared to the pre-phase fingerprint of partner_rfp_inbox, rfp_magic_tokens, rfp_records, rfp_record_lines, projects: %s\n',
              v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT         : lead org %s, project %s, agency member %s; vendor %s of org %s on partnership %s; token row %s; fixture record %s, row %s%s\n',
              v_o1, coalesce(v_p1::text, 'NONE'), coalesce(v_u1::text, 'NONE'),
              coalesce(v_uv::text, 'NONE'), coalesce(v_ov::text, 'NONE'), coalesce(v_ps1::text, 'NONE'),
              coalesce(v_tok, 'NONE'), v_rec, v_inbf,
              CASE WHEN v_fallback THEN ' [FALLBACK: no qualifying partnership, vendor scenarios are NO SUBJECT]' ELSE '' END)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nSCRUB (what the real apply will do, plus the fixture)\n'
    || v_scrub
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 120\n  phase 2 = AFTER 120\n'
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
