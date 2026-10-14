-- =====================================================================
-- 119 PRE-APPLY TEST. ONE PASTE. APPLIES 119, WRITES, READS, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-14 on feat/rfp-record-b (unattended run). NOT RUN: THERE IS NO LOCAL POSTGRES AND
-- NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain error, not in
-- "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code below (inside the $m119$ string) is 119_rfp_records_backfill.sql from
-- the line "-- >>> 119 BODY START" to the line "-- <<< 119 BODY END" inclusive: the whole body
-- between BEGIN; and COMMIT;. Both files carry those two marker lines, so the copies can be compared
-- mechanically. If you edit the migration, re-copy the marked block here and re-check.
-- Checked 2026-10-14 (feat/rfp-record-b) with git diff --no-index: no hunk falls between the markers
-- (migration lines 203-747, this file's lines 572-1116).
--
-- 118 IS LIVE (applied and catalog-verified 2026-10-14). This test applies only 119, inside its own
-- transaction, between phase 1 and phase 2, and rolls everything back at the end: THE BACKFILL RUNS
-- FOR REAL INSIDE THE TEST, against the live rows, and is undone with the test.
--
-- LESSONS APPLIED (2026-10-14): (1) subjects are selected through partnerships.vendor_org_id, never
-- partner_id; (2) every "char" catalog column (tgenabled, provolatile, prokind) is cast to text before
-- || or comparison; (3) NO TEMP TABLE AND NO pg_temp FUNCTION: everything lives inside the one DO
-- block; (4) the SQL Editor shows only the last statement's result, so the final RAISE carries the
-- whole result, the backfill's lists included; (5) NO SUBJECT is INCONCLUSIVE, never PASS.
--
-- WHAT 119 MUST SHOW:
--   THE FUNCTION: an agency member of a paid lead agency toggles its own sent record ON and OFF and
--   every linked inbox row and token follows (the client name when on, NULL when off, NULL when the
--   record has no client name); a vendor and anon cannot execute it or change anything; another
--   organization's record, an unknown id, an unpaid lead agency and a second lead agency are refused
--   (P0002) with nothing written; NULL arguments are refused.
--   THE BACKFILL: every existing unlinked inbox row and token is linked or listed as refused; no step A
--   record, line or link changed; every backfilled record has lines and broadcast_at, hides the client
--   (D3, no client_name_released written), and has released_budget = estimated_budget (D2); the rubric,
--   categories and requirements of each backfilled wizard record equal every copy it was rebuilt from;
--   the unverified single-copy list is exact and printed; client names come from the project; tokens
--   point at their own line and an inbox row of their own organization; a second run refuses (LG119);
--   a vendor still reads 0 records; no policy, grant or trigger changed and exactly one function was
--   added; no inbox row or token changed outside the link columns and none was added or removed.
--
-- PHASES: phase 1 BEFORE 119 (the function does not exist: its scenarios answer MISSING), phase 2
-- AFTER 119. EVERY SCENARIO RUNS IN EVERY PHASE. A phase-1 mismatch is INCONCLUSIVE (the premise is
-- wrong), never PASS; a phase-2 mismatch is FAIL. The self-checks S1-S16 run once, after phase 2.
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
--     "SAFE TO APPLY 119."       -> and only this. It may name INCONCLUSIVE-BY-DESIGN rows (below).
--     "DO NOT APPLY 119 YET."    -> INCONCLUSIVE or NO SUBJECT beyond the by-design rows.
--     "DO NOT APPLY 119."        -> an assertion FAILED, or the test is broken.
-- Then read the BACKFILL lines: they are what the real apply will do (refused groups, unverified
-- single-copy groups, client-name corrections, counts).
--
-- EXPECTED COUNT: 16 scenarios + 16 self-checks + M = 33 assertions.
--
-- INCONCLUSIVE BY DESIGN: U1 (a member of an UNPAID lead agency) and X1 (a member of a SECOND paid
-- lead agency). m a r k a n t is the only lead organization with members today, so both report NO
-- SUBJECT. They run and are judged like every other row if a subject exists.
--
-- NOT DISCRIMINATING BY DESIGN (same expectation before and after 119, reported as PASS with that
-- note): V1, V2, V3 (a vendor reads and changes nothing, before and after the backfill), N1 (anon).
--
-- =====================================================================
-- THE SUBJECTS
-- =====================================================================
-- vendor : a member of a partnership's VENDOR ORGANIZATION (partnerships.vendor_org_id) who is not a
--          member of the lead organization.
-- o1, p1 : that partnership's lead organization (a PAID LEAD AGENCY) and a project of it.
-- m1     : a member of o1, preferring a sole membership (so o1 is its acting organization), then
--          role owner. The agency actor.
-- tok    : an rfp_magic_tokens row of o1 whose project is NULL or o1's own (114's WITH CHECK).
-- oo     : another organization (the vendor's, or any other).
-- unpaid : a sole member of a lead agency with is_paid not true. NO SUBJECT by design today.
-- other  : a sole member of a second paid lead agency. NO SUBJECT by design today.
-- Throwaway rows, fixed ids, written in each scenario's SETUP as the table owner (no end-user session:
-- 118's trusted path): rec (a sent record of o1 on p1, client 'LG119 Client') with one line and two
-- inbox rows of o1 linked to it (client_name_released 'LG119 stale'); recx (a sent record of oo with
-- one line and one linked inbox row of oo); recu (a record of the unpaid organization).
-- IMPERSONATION IS PROVED: request.jwt.claims + SET LOCAL ROLE, then auth.uid() and current_user are
-- read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097. A fingerprint
-- of every partner_rfp_inbox, rfp_magic_tokens, rfp_records, rfp_record_lines and projects row is
-- compared after each.
--
-- RESULT CODES: OK:<value> (the scenario's one text value), MISSING (42P01 / 42703 / 42883: the
-- table, column or function does not exist), E:<sqlstate> (refused with that code). P0002 is the
-- function's own refusal; 22004 its NULL-argument refusal; LG119 the migration's.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * A custom setting set with set_config(..., true) inside a sub-block that completes is still
--     readable after it (the backfill's result, ligament.backfill_119). If not, S7, S8, S13 and S14
--     report FAIL with "result not readable" and the BACKFILL lines are empty: read 119's V2 to V4.
--   * RAISE WARNING ... USING ERRCODE = 'LG119' is accepted for a warning.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 32;
  c_phases       CONSTANT integer := 2;
  c_by_design    CONSTANT text[]  := ARRAY['U1', 'X1'];
  c_fn_sig       CONSTANT text    := 'rfp_record_set_client_visibility(uuid, boolean)';
  v_o1           uuid;
  v_p1           uuid;
  v_u1           uuid;
  v_uv           uuid;
  v_ov           uuid;
  v_ps1          uuid;
  v_tok          text;
  v_oo           uuid;
  v_uu           uuid;
  v_ou           uuid;
  v_ux           uuid;
  v_ox           uuid;
  v_fallback     boolean := false;
  v_m1_entitled  text := 'not checked';
  v_rec          uuid := gen_random_uuid();
  v_line         uuid := gen_random_uuid();
  v_inb1         uuid := gen_random_uuid();
  v_inb2         uuid := gen_random_uuid();
  v_recx         uuid := gen_random_uuid();
  v_linex        uuid := gen_random_uuid();
  v_inbx         uuid := gen_random_uuid();
  v_recu         uuid := gen_random_uuid();
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
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  -- Captured before phase 1, compared after phase 2.
  v_pol_before   text;
  v_pol_after    text;
  v_acl_before   text;
  v_acl_after    text;
  v_trg_before   text;
  v_trg_after    text;
  v_fn_before    text[];
  v_fn_after     text[];
  v_rows_before  text;
  v_rows_after   text;
  v_inbox_n0     bigint;
  v_inbox_n1     bigint;
  v_tok_n0       bigint;
  v_tok_n1       bigint;
  v_stepa_before text;
  v_stepa_after  text;
  v_pre_inbox    uuid[];
  v_pre_tok      text[];
  v_pre_link_fp0 text;
  v_pre_link_fp1 text;
  v_unlinked0    text := 'unreadable';
  -- The backfill's own result (ligament.backfill_119).
  v_res          jsonb;
  v_body         text;
  v_idem         text := 'not run';
  v_n1           bigint;
  v_n2           bigint;
  v_n3           bigint;
  v_ok           boolean;
  v_nos          boolean;
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
  v_backfill     text := '';
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
  -- Every table, column and function ACL in public, the new function excluded.
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
                             WHERE n.nspname = 'public' AND p.proname <> 'rfp_record_set_client_visibility'), ''))$f$;
  -- Every non-internal trigger on a public table, with its function body.
  v_trg_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(c.relname || ':' || t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':'
                                      || p.proname || ':' || md5(p.prosrc), E'\n' ORDER BY c.relname, t.tgname), ''))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal$f$;
  -- Every inbox and token row OUTSIDE the link columns: 119 may write rfp_line_id (and on tokens
  -- attached_inbox_id) and nothing else.
  v_rows_sql     CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg((to_jsonb(x) - 'rfp_line_id')::text, E'\n' ORDER BY x.id)
                             FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg((to_jsonb(x) - 'rfp_line_id' - 'attached_inbox_id')::text, E'\n' ORDER BY x.id::text)
                             FROM public.rfp_magic_tokens x), ''))$f$;
  -- Every record and line that is not a backfill: before 119 that is every row.
  v_stepa_sql    CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(to_jsonb(r)::text, E'\n' ORDER BY r.id) FROM public.rfp_records r WHERE r.source <> 'backfill'), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(l)::text, E'\n' ORDER BY l.id) FROM public.rfp_record_lines l
                             JOIN public.rfp_records r ON r.id = l.rfp_id WHERE r.source <> 'backfill'), ''))$f$;

  -- Setup fragments, run as the owner. format() arguments everywhere:
  --   %1$L p1  %2$L o1  %3$L rec  %4$L line  %5$L inb1  %6$L inb2  %7$L tok  %8$L oo  %9$L recx
  --   %10$L linex  %11$L inbx  %12$L ou  %13$L recu  %14$L u1
  -- Write order (118): record, line, linked rows, broadcast_at last.
  s_rec   CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp, client_name_snapshot) VALUES (%3$L, %2$L, %1$L, 'wizard', '{"projectName": "LG119 test"}'::jsonb, 'LG119 Client'); INSERT INTO public.rfp_record_lines (id, rfp_id, scope_item_key, scope_item_name) VALUES (%4$L, %3$L, 'LG119-1', 'LG119 line'); INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name, rfp_line_id, client_name_released) VALUES (%5$L, %2$L, 'lg119-a@example.invalid', 'LG119-1', 'LG119 row a', %4$L, 'LG119 stale'), (%6$L, %2$L, 'lg119-b@example.invalid', 'LG119-1', 'LG119 row b', %4$L, 'LG119 stale'); UPDATE public.rfp_records SET broadcast_at = now() WHERE id = %3$L;$s$;
  s_recn  CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp, client_name_snapshot) VALUES (%3$L, %2$L, %1$L, 'wizard', '{"projectName": "LG119 test"}'::jsonb, NULL); INSERT INTO public.rfp_record_lines (id, rfp_id, scope_item_key, scope_item_name) VALUES (%4$L, %3$L, 'LG119-1', 'LG119 line'); INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name, rfp_line_id, client_name_released) VALUES (%5$L, %2$L, 'lg119-a@example.invalid', 'LG119-1', 'LG119 row a', %4$L, 'LG119 stale'), (%6$L, %2$L, 'lg119-b@example.invalid', 'LG119-1', 'LG119 row b', %4$L, 'LG119 stale'); UPDATE public.rfp_records SET broadcast_at = now() WHERE id = %3$L;$s$;
  s_tok   CONSTANT text := $s$UPDATE public.rfp_magic_tokens SET rfp_line_id = %4$L, client_name_released = 'LG119 stale' WHERE id::text = %7$L;$s$;
  s_recx  CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp, client_name_snapshot) VALUES (%9$L, %8$L, NULL, 'wizard', '{}'::jsonb, 'LG119 Other'); INSERT INTO public.rfp_record_lines (id, rfp_id, scope_item_key, scope_item_name) VALUES (%10$L, %9$L, 'LG119-X', 'LG119 other line'); INSERT INTO public.partner_rfp_inbox (id, lead_org_id, recipient_email, scope_item_id, scope_item_name, rfp_line_id) VALUES (%11$L, %8$L, 'lg119-x@example.invalid', 'LG119-X', 'LG119 other row', %10$L); UPDATE public.rfp_records SET broadcast_at = now() WHERE id = %9$L;$s$;
  s_recu  CONSTANT text := $s$INSERT INTO public.rfp_records (id, lead_org_id, project_id, source, master_rfp, client_name_snapshot) VALUES (%13$L, %12$L, NULL, 'wizard', '{}'::jsonb, 'LG119 Unpaid'); UPDATE public.rfp_records SET broadcast_at = now() WHERE id = %13$L;$s$;

  -- Read-backs, as the actor: the record's flag, then "rows with the expected value / linked rows".
  q_on    CONSTANT text := $q$SELECT r.show_client_to_vendors::text || '|' || (SELECT (count(*) FILTER (WHERE i.client_name_released IS NOT DISTINCT FROM 'LG119 Client'))::text || '/' || count(*)::text FROM public.partner_rfp_inbox i WHERE i.rfp_line_id = %4$L) FROM public.rfp_records r WHERE r.id = %3$L$q$;
  q_off   CONSTANT text := $q$SELECT r.show_client_to_vendors::text || '|' || (SELECT (count(*) FILTER (WHERE i.client_name_released IS NULL))::text || '/' || count(*)::text FROM public.partner_rfp_inbox i WHERE i.rfp_line_id = %4$L) FROM public.rfp_records r WHERE r.id = %3$L$q$;
  q_tok   CONSTANT text := $q$SELECT coalesce(t.client_name_released, 'NULL') FROM public.rfp_magic_tokens t WHERE t.id::text = %7$L$q$;

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
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 119 YET.  NO SUBJECT: no paid lead agency has both a member and a project. Nothing was tested. This is not a pass.\n=====================================================\n';
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

  -- Is m1 entitled through 118's helper? Reported on the SUBJECT line; T1 depends on it.
  IF v_u1 IS NOT NULL THEN
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

  ---------------------------------------------------------------------
  -- THE SCENARIOS. Parallel arrays; position i describes scenario i. sc_setup runs as the owner,
  -- sc_sql as the actor. sc_needs names the subjects a scenario needs beyond its actor
  -- (comma-separated: tok, oo, ou); a missing one is NO SUBJECT.
  ---------------------------------------------------------------------
  sc_id := ARRAY['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10',
                 'V1', 'V2', 'V3', 'N1', 'U1', 'X1'];

  sc_label := ARRAY[
    $l$T1  agency: toggle ON, record and both inbox rows follow$l$,
    $l$T2  agency: toggle OFF, record and both inbox rows NULL$l$,
    $l$T3  agency: toggle ON, the linked token follows$l$,
    $l$T4  agency: toggle OFF, the linked token goes NULL$l$,
    $l$T5  agency: toggle ON, no client name on record: rows NULL$l$,
    $l$T6  agency: another organization's record refused$l$,
    $l$T7  agency: NULL arguments refused$l$,
    $l$T8  vendor: executes on o1's record, refused, nothing written$l$,
    $l$T9  anon: cannot execute the function$l$,
    $l$T10 agency: unknown record id refused$l$,
    $l$V1  vendor: reads 0 records$l$,
    $l$V2  vendor: UPDATE of a record matches 0 rows$l$,
    $l$V3  vendor: reads 0 lines$l$,
    $l$N1  anon: cannot read records$l$,
    $l$U1  unpaid lead agency: own org's record refused$l$,
    $l$X1  second lead agency: o1's record refused$l$];

  sc_actor := ARRAY['m1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'vendor', 'anon', 'm1',
                    'vendor', 'vendor', 'vendor', 'anon', 'unpaid', 'other'];

  sc_needs := ARRAY['', '', 'tok', 'tok', '', 'oo', '', '', '', '',
                    '', '', '', '', '', ''];

  sc_setup := ARRAY[
    s_rec, s_rec, s_rec || s_tok, s_rec || s_tok, s_recn, s_recx, '', s_rec, s_rec, '',
    s_rec, s_rec, s_rec, s_rec, s_recu, s_rec];

  sc_sql := ARRAY[
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, true)::text|NEXT|$q$ || q_on,
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, false)::text|NEXT|$q$ || q_off,
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, true)::text|NEXT|$q$ || q_tok,
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, false)::text|NEXT|$q$ || q_tok,
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, true)::text|NEXT|$q$ || q_off,
    $q$SELECT public.rfp_record_set_client_visibility(%9$L, true)::text$q$,
    $q$SELECT public.rfp_record_set_client_visibility(NULL::uuid, NULL::boolean)::text$q$,
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, true)::text$q$,
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, true)::text$q$,
    $q$SELECT public.rfp_record_set_client_visibility(gen_random_uuid(), true)::text$q$,
    $q$SELECT count(*)::text FROM public.rfp_records$q$,
    $q$WITH u AS (UPDATE public.rfp_records SET show_client_to_vendors = true WHERE id = %3$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$SELECT count(*)::text FROM public.rfp_record_lines$q$,
    $q$SELECT count(*)::text FROM public.rfp_records$q$,
    $q$SELECT public.rfp_record_set_client_visibility(%13$L, true)::text$q$,
    $q$SELECT public.rfp_record_set_client_visibility(%3$L, true)::text$q$];

  sc_exp := ARRAY[
    'MISSING', 'OK:true|2/2',              -- T1
    'MISSING', 'OK:false|2/2',             -- T2
    'MISSING', 'OK:LG119 Client',          -- T3
    'MISSING', 'OK:NULL',                  -- T4
    'MISSING', 'OK:true|2/2',              -- T5
    'MISSING', 'E:P0002',                  -- T6
    'MISSING', 'E:22004',                  -- T7
    'MISSING', 'E:P0002',                  -- T8
    'MISSING OR E:42501', 'E:42501',       -- T9
    'MISSING', 'E:P0002',                  -- T10
    'OK:0', 'OK:0',                        -- V1
    'OK:0', 'OK:0',                        -- V2
    'OK:0', 'OK:0',                        -- V3
    'E:42501', 'E:42501',                  -- N1
    'MISSING', 'E:P0002',                  -- U1
    'MISSING', 'E:P0002'];                 -- X1

  v_n := array_length(sc_id, 1);
  IF v_n <> 16 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_needs, 1) <> v_n OR array_length(sc_setup, 1) <> v_n
     OR array_length(sc_sql, 1) <> v_n OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (ids %, labels %, actors %, needs %, setups %, sqls %, expectations %)',
      v_n, array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_needs, 1),
      array_length(sc_setup, 1), array_length(sc_sql, 1), array_length(sc_exp, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  ---------------------------------------------------------------------
  -- BEFORE 119: the state the self-checks compare against.
  ---------------------------------------------------------------------
  EXECUTE v_pol_sql   INTO v_pol_before;
  EXECUTE v_acl_sql   INTO v_acl_before;
  EXECUTE v_trg_sql   INTO v_trg_before;
  EXECUTE v_rows_sql  INTO v_rows_before;
  EXECUTE v_stepa_sql INTO v_stepa_before;
  SELECT array_agg(p.proname || '(' || oidvectortypes(p.proargtypes) || ')' ORDER BY p.proname, oidvectortypes(p.proargtypes)) INTO v_fn_before
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
  SELECT count(*) INTO v_inbox_n0 FROM public.partner_rfp_inbox;
  SELECT count(*) INTO v_tok_n0 FROM public.rfp_magic_tokens;
  SELECT coalesce(array_agg(i.id ORDER BY i.id), ARRAY[]::uuid[]) INTO v_pre_inbox
    FROM public.partner_rfp_inbox i WHERE i.rfp_line_id IS NOT NULL;
  SELECT coalesce(array_agg(t.id::text ORDER BY t.id::text), ARRAY[]::text[]) INTO v_pre_tok
    FROM public.rfp_magic_tokens t WHERE t.rfp_line_id IS NOT NULL;
  SELECT md5(coalesce((SELECT string_agg(i.id::text || ':' || coalesce(i.rfp_line_id::text, '') || ':' || coalesce(i.client_name_released, ''), ',' ORDER BY i.id)
                         FROM public.partner_rfp_inbox i WHERE i.id = ANY (v_pre_inbox)), ''))
      || md5(coalesce((SELECT string_agg(t.id::text || ':' || coalesce(t.rfp_line_id::text, '') || ':' || coalesce(t.attached_inbox_id::text, '') || ':' || coalesce(t.client_name_released, ''), ',' ORDER BY t.id::text)
                         FROM public.rfp_magic_tokens t WHERE t.id::text = ANY (v_pre_tok)), ''))
    INTO v_pre_link_fp0;
  SELECT format('%s inbox rows (%s unlinked, %s of them Lightning), %s tokens (%s unlinked)',
                count(*), count(*) FILTER (WHERE i.rfp_line_id IS NULL),
                count(*) FILTER (WHERE i.rfp_line_id IS NULL AND (coalesce(i.master_rfp_json ? '_magic_token', false) OR coalesce(i.scope_item_id LIKE 'magic:%', false))),
                (SELECT count(*) FROM public.rfp_magic_tokens), (SELECT count(*) FROM public.rfp_magic_tokens WHERE rfp_line_id IS NULL))
    INTO v_unlinked0
    FROM public.partner_rfp_inbox i;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 119 is executed between phases.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    EXECUTE v_fp_sql INTO v_fp0;

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];
      v_uid := CASE v_actor WHEN 'm1' THEN v_u1 WHEN 'vendor' THEN v_uv WHEN 'unpaid' THEN v_uu WHEN 'other' THEN v_ux ELSE NULL END;

      v_nosubj := v_p1 IS NULL
               OR (v_actor IN ('m1', 'vendor', 'unpaid', 'other') AND v_uid IS NULL);
      FOREACH v_need IN ARRAY string_to_array(sc_needs[v_i], ',') LOOP
        IF (v_need = 'tok' AND v_tok IS NULL) OR (v_need = 'oo' AND v_oo IS NULL) THEN
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
              EXECUTE format(sc_setup[v_i], v_p1, v_o1, v_rec, v_line, v_inb1, v_inb2, v_tok, v_oo, v_recx,
                             v_linex, v_inbx, v_ou, v_recu, v_u1);
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
            format(sc_sql[v_i], v_p1, v_o1, v_rec, v_line, v_inb1, v_inb2, v_tok, v_oo, v_recx,
                   v_linex, v_inbx, v_ou, v_recu, v_u1),
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
        v_body := $m119$
-- >>> 119 BODY START
-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.rfp_records') IS NULL OR to_regclass('public.rfp_record_lines') IS NULL THEN
    RAISE EXCEPTION '119 refuses to run: rfp_records or rfp_record_lines does not exist. Apply 118 first.'
      USING ERRCODE = 'LG119';
  END IF;

  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O'
         AND (c.relname::text, t.tgname::text) IN (('rfp_records', 'rfp_records_guard'),
                                                   ('rfp_record_lines', 'rfp_record_lines_guard'),
                                                   ('partner_rfp_inbox', 'partner_rfp_inbox_link_columns_guard'),
                                                   ('rfp_magic_tokens', 'rfp_magic_tokens_link_columns_guard'))) <> 4 THEN
    RAISE EXCEPTION '119 refuses to run: one of 118''s four guards is missing or not enabled. The backfill must run under them.'
      USING ERRCODE = 'LG119';
  END IF;

  -- The columns the backfill reads and writes.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'partner_rfp_inbox' AND column_name IN ('id', 'lead_org_id', 'project_id', 'scope_item_id',
                 'scope_item_name', 'scope_item_description', 'estimated_budget', 'master_rfp_json', 'created_at',
                 'response_deadline', 'close_bidding_at_deadline', 'require_terms_disclosure', 'rfp_line_id',
                 'client_name_released'))
           OR (table_name = 'rfp_magic_tokens' AND column_name IN ('id', 'token', 'org_id', 'project_id', 'scope_item_id',
                 'scope_item_name', 'scope_item_description', 'reference_materials', 'business_criteria_required',
                 'evaluation_criteria', 'budget_categories', 'response_deadline', 'close_bidding_at_deadline',
                 'require_terms_disclosure', 'created_at', 'rfp_line_id', 'attached_inbox_id', 'client_name_released'))
           OR (table_name = 'projects' AND column_name IN ('id', 'org_id', 'name', 'client_name', 'budget_range')))) <> 37 THEN
    RAISE EXCEPTION '119 refuses to run: a column it reads or writes is missing on partner_rfp_inbox, rfp_magic_tokens or projects.'
      USING ERRCODE = 'LG119';
  END IF;

  -- Idempotency. Checked before the function, so a second run names the real reason.
  IF EXISTS (SELECT 1 FROM public.rfp_records WHERE source = 'backfill') THEN
    RAISE EXCEPTION '119 refuses to run: rfp_records already holds backfilled records (source = backfill), so 119 has run. Nothing was changed.'
      USING ERRCODE = 'LG119';
  END IF;

  IF to_regprocedure('public.rfp_record_set_client_visibility(uuid, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '119 refuses to run: public.rfp_record_set_client_visibility(uuid, boolean) already exists. Read the schema before going further.'
      USING ERRCODE = 'LG119';
  END IF;

  -- 118's trusted path. Never weaken a guard to make this pass.
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '119 refuses to run: it must run with no end-user session (the SQL Editor role), which is 118''s trusted path. auth.uid() is %, current_user is %.', auth.uid(), current_user
      USING ERRCODE = 'LG119';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE FUNCTION. See the header section (i).
-- ---------------------------------------------------------------------
CREATE FUNCTION public.rfp_record_set_client_visibility(p_record uuid, p_show boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_found    boolean;
  v_snapshot text;
  v_released text;
  v_inbox    integer := 0;
  v_tokens   integer := 0;
BEGIN
  IF p_record IS NULL OR p_show IS NULL THEN
    RAISE EXCEPTION 'An RFP record and a true or false choice are both required.'
      USING ERRCODE = '22004';
  END IF;

  -- 1. The record, under the caller's RLS. Zero rows: refuse before anything is written.
  UPDATE public.rfp_records r
     SET show_client_to_vendors = p_show
   WHERE r.id = p_record
  RETURNING true, r.client_name_snapshot INTO v_found, v_snapshot;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'That RFP record does not exist or is not yours.'
      USING ERRCODE = 'P0002',
            DETAIL  = 'rfp_record_set_client_visibility matched no rfp_records row the caller may update (migration 119).';
  END IF;

  v_released := CASE WHEN p_show THEN nullif(btrim(v_snapshot), '') ELSE NULL END;

  -- 2. Every inbox row and token linked to this record's lines follows the record.
  UPDATE public.partner_rfp_inbox i
     SET client_name_released = v_released
   WHERE i.rfp_line_id IN (SELECT l.id FROM public.rfp_record_lines l WHERE l.rfp_id = p_record)
     AND i.client_name_released IS DISTINCT FROM v_released;
  GET DIAGNOSTICS v_inbox = ROW_COUNT;

  UPDATE public.rfp_magic_tokens t
     SET client_name_released = v_released
   WHERE t.rfp_line_id IN (SELECT l.id FROM public.rfp_record_lines l WHERE l.rfp_id = p_record)
     AND t.client_name_released IS DISTINCT FROM v_released;
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  RETURN jsonb_build_object('record', p_record, 'show_client_to_vendors', p_show,
                            'inbox_rows', v_inbox, 'tokens', v_tokens);
END;
$$;

COMMENT ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) IS
  'Migration 119. The per-RFP client toggle (ruling D3) on an existing record, in one transaction: '
  'sets rfp_records.show_client_to_vendors, then client_name_released (the record''s '
  'client_name_snapshot when on, NULL when off) on every partner_rfp_inbox row and rfp_magic_tokens row '
  'linked to the record''s lines. SECURITY INVOKER: RLS and 118''s guards apply as the caller. Raises '
  'P0002 and writes nothing when the caller cannot update the record.';

REVOKE EXECUTE ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.rfp_record_set_client_visibility(uuid, boolean) TO authenticated;


-- ---------------------------------------------------------------------
-- 2. THE BACKFILL. See the header section (ii).
-- ---------------------------------------------------------------------
DO $backfill$
DECLARE
  g                  record;
  s                  record;
  t                  record;
  r                  record;
  v_rec              uuid;
  v_line             uuid;
  v_first_inbox      uuid;
  v_tok_line         uuid;
  v_tok_found        boolean;
  v_m                jsonb;
  v_n                integer;
  v_left             bigint;
  v_reason           text;
  v_gid              text;
  v_notes            text[];
  v_snapshot         text;
  v_copy_client      text;
  v_pname            text;
  v_pclient          text;
  v_pbudget          text;
  v_records_wizard   integer := 0;
  v_records_magic    integer := 0;
  v_lines            integer := 0;
  v_inbox_linked     integer := 0;
  v_inbox_to_step_a  integer := 0;
  v_tokens_linked    integer := 0;
  v_tokens_attached  integer := 0;
  v_no_project_inbox integer := 0;
  v_no_project_token integer := 0;
  v_groups_refused   integer := 0;
  v_refused          text[] := ARRAY[]::text[];
  v_refused_inbox    text[] := ARRAY[]::text[];
  v_refused_tokens   text[] := ARRAY[]::text[];
  v_unverified       text[] := ARRAY[]::text[];
  v_client_fixes     text[] := ARRAY[]::text[];
  v_result           jsonb;
BEGIN
  -- ===================================================================
  -- A. WIZARD SENDS. One record per (lead_org_id, project_id, created_at) of unlinked,
  --    non-Lightning inbox rows.
  -- ===================================================================
  FOR g IN
    SELECT i.lead_org_id, i.project_id, i.created_at, count(*)::integer AS n,
           array_agg(i.id ORDER BY i.id) AS ids
      FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NULL
       AND NOT (coalesce(i.master_rfp_json ? '_magic_token', false) OR coalesce(i.scope_item_id LIKE 'magic:%', false))
     GROUP BY i.lead_org_id, i.project_id, i.created_at
     ORDER BY i.created_at, i.lead_org_id, i.project_id
  LOOP
    v_gid := format('wizard send %s, org %s, project %s', g.created_at, g.lead_org_id, coalesce(g.project_id::text, 'none'));
    v_reason := NULL;

    IF g.lead_org_id IS NULL THEN
      v_reason := 'the rows carry no lead organization';
    ELSIF g.created_at IS NULL THEN
      v_reason := 'the rows carry no send time';
    ELSIF g.project_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = g.project_id AND p.org_id = g.lead_org_id) THEN
      v_reason := 'the project is missing or belongs to another organization';
    ELSIF EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                   WHERE i.id = ANY (g.ids) AND jsonb_typeof(i.master_rfp_json) IS DISTINCT FROM 'object') THEN
      v_reason := 'a copy carries no master_rfp_json object';
    ELSIF (SELECT count(DISTINCT jsonb_build_array(i.master_rfp_json -> 'evaluation_criteria',
                                                   i.master_rfp_json -> 'budget_categories',
                                                   i.master_rfp_json -> 'business_criteria_required'))
             FROM public.partner_rfp_inbox i WHERE i.id = ANY (g.ids)) > 1 THEN
      v_reason := format('the rubric, budget categories or requirements differ across its %s copies', g.n);
    ELSIF EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                   WHERE i.id = ANY (g.ids)
                   GROUP BY i.scope_item_id
                  HAVING count(DISTINCT jsonb_build_array(i.scope_item_name, i.scope_item_description, i.estimated_budget)) > 1) THEN
      v_reason := 'a scope line''s name, description or estimated budget differs across its copies';
    END IF;

    IF v_reason IS NOT NULL THEN
      v_groups_refused := v_groups_refused + 1;
      v_refused := v_refused || format('%s: %s (inbox rows %s)', v_gid, v_reason, array_to_string(g.ids, ', '));
      v_refused_inbox := v_refused_inbox || (SELECT array_agg(x::text) FROM unnest(g.ids) AS x);
      RAISE WARNING 'LG119 REFUSED %: %', v_gid, v_reason USING ERRCODE = 'LG119';
      CONTINUE;
    END IF;

    -- The copy the master is taken from: the first by id (every copy of a send shares created_at).
    SELECT i.* INTO s FROM public.partner_rfp_inbox i WHERE i.id = g.ids[1];
    v_m := s.master_rfp_json;
    v_notes := ARRAY[]::text[];

    IF g.n = 1 THEN
      v_notes := v_notes || 'unverified single copy'::text;
    END IF;

    v_copy_client := nullif(btrim(v_m ->> 'client'), '');
    IF g.project_id IS NOT NULL THEN
      SELECT nullif(btrim(p.client_name::text), '') INTO v_snapshot FROM public.projects p WHERE p.id = g.project_id;
      IF v_copy_client IS DISTINCT FROM v_snapshot THEN
        v_notes := v_notes || 'client name taken from project'::text;
        v_client_fixes := v_client_fixes || v_gid;
      END IF;
    ELSE
      v_snapshot := v_copy_client;
      v_notes := v_notes || 'no project to check the client name against, taken from the copy'::text;
      v_no_project_inbox := v_no_project_inbox + g.n;
    END IF;

    IF g.n > 1 AND (SELECT count(DISTINCT i.master_rfp_json) FROM public.partner_rfp_inbox i WHERE i.id = ANY (g.ids)) > 1 THEN
      v_notes := v_notes || 'copies differ outside the rubric, categories and requirements, master taken from the first copy'::text;
    END IF;

    v_notes := v_notes || format('119 backfill of the wizard send of %s, rebuilt from %s inbox cop%s, master from inbox row %s',
                                 g.created_at, g.n, CASE WHEN g.n = 1 THEN 'y' ELSE 'ies' END, s.id);

    -- (1) The record, WITHOUT broadcast_at.
    INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp, evaluation_criteria, budget_categories,
                                    business_criteria_required, output_template_config, total_budget,
                                    show_client_to_vendors, client_name_snapshot, response_deadline,
                                    close_bidding_at_deadline, require_terms_disclosure, nda_link, created_by, backfill_note)
    VALUES (g.lead_org_id, g.project_id, 'backfill', v_m - 'nda_link',
            nullif(v_m -> 'evaluation_criteria', 'null'::jsonb),
            nullif(v_m -> 'budget_categories', 'null'::jsonb),
            CASE WHEN jsonb_typeof(v_m -> 'business_criteria_required') = 'object'
                 THEN v_m -> 'business_criteria_required' ELSE '{}'::jsonb END,
            NULL,
            CASE WHEN jsonb_typeof(v_m -> 'totalBudget') IN ('string', 'number')
                 THEN nullif(btrim(v_m ->> 'totalBudget'), '') END,
            false,
            v_snapshot,
            s.response_deadline,
            coalesce(s.close_bidding_at_deadline, false),
            coalesce(s.require_terms_disclosure, true),
            nullif(btrim(v_m ->> 'nda_link'), ''),
            NULL,
            array_to_string(v_notes, '; '))
    RETURNING id INTO v_rec;

    -- (2) Its lines, one per scope_item_id. D2: released_budget = estimated_budget.
    INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name, scope_item_description,
                                         estimated_budget, released_budget, sort_order)
    SELECT v_rec, x.scope_item_id,
           coalesce(nullif(btrim(x.scope_item_name), ''), 'Scope'),
           x.scope_item_description,
           x.estimated_budget,
           x.estimated_budget,
           coalesce((SELECT (e.ord - 1)::integer
                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_m -> 'scopeItems') = 'array'
                                                      THEN v_m -> 'scopeItems' ELSE '[]'::jsonb END)
                            WITH ORDINALITY AS e(item, ord)
                      WHERE e.item ->> 'id' = x.scope_item_id
                      LIMIT 1), 1000)
      FROM (SELECT DISTINCT ON (i.scope_item_id) i.scope_item_id, i.scope_item_name, i.scope_item_description, i.estimated_budget
              FROM public.partner_rfp_inbox i
             WHERE i.id = ANY (g.ids)
             ORDER BY i.scope_item_id, i.id) x;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_lines := v_lines + v_n;

    -- (3) Every copy carries its line.
    UPDATE public.partner_rfp_inbox i
       SET rfp_line_id = l.id
      FROM public.rfp_record_lines l
     WHERE l.rfp_id = v_rec
       AND l.scope_item_key = i.scope_item_id
       AND i.id = ANY (g.ids)
       AND i.rfp_line_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> g.n THEN
      RAISE EXCEPTION '119 stopped: % linked % of its % inbox rows. Nothing was committed.', v_gid, v_n, g.n
        USING ERRCODE = 'LG119';
    END IF;
    v_inbox_linked := v_inbox_linked + v_n;

    -- (5) broadcast_at LAST, to the original send time.
    UPDATE public.rfp_records SET broadcast_at = g.created_at WHERE id = v_rec AND broadcast_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not set broadcast_at on record % (%). Nothing was committed.', v_rec, v_gid
        USING ERRCODE = 'LG119';
    END IF;

    v_records_wizard := v_records_wizard + 1;
    IF g.n = 1 THEN
      v_unverified := v_unverified || format('record %s (%s, inbox row %s)', v_rec, v_gid, g.ids[1]);
    END IF;
  END LOOP;

  -- ===================================================================
  -- B. LIGHTNING (MAGIC-LINK) SENDS. One record per unlinked token, from the token (D6).
  -- ===================================================================
  FOR t IN
    SELECT tk.id::text AS tid, tk.token, tk.org_id, tk.project_id, tk.scope_item_id::text AS scope_item_id,
           tk.scope_item_name, tk.scope_item_description, tk.reference_materials, tk.business_criteria_required,
           tk.evaluation_criteria, tk.budget_categories, tk.response_deadline, tk.close_bidding_at_deadline,
           tk.require_terms_disclosure, tk.created_at
      FROM public.rfp_magic_tokens tk
     WHERE tk.rfp_line_id IS NULL
     ORDER BY tk.created_at, tk.id::text
  LOOP
    -- The token value is a bearer credential: never printed. Rows are named by their id.
    v_gid := format('Lightning token row %s, org %s, project %s', t.tid, t.org_id, coalesce(t.project_id::text, 'none'));
    v_reason := NULL;

    IF t.org_id IS NULL THEN
      v_reason := 'the token carries no organization';
    ELSIF t.created_at IS NULL THEN
      v_reason := 'the token carries no send time';
    ELSIF t.project_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id AND p.org_id = t.org_id) THEN
      v_reason := 'the project is missing or belongs to another organization';
    END IF;

    IF v_reason IS NOT NULL THEN
      v_groups_refused := v_groups_refused + 1;
      v_refused := v_refused || format('%s: %s', v_gid, v_reason);
      v_refused_tokens := v_refused_tokens || t.tid;
      RAISE WARNING 'LG119 REFUSED %: %', v_gid, v_reason USING ERRCODE = 'LG119';
      CONTINUE;
    END IF;

    v_pname := NULL; v_pclient := NULL; v_pbudget := NULL;
    IF t.project_id IS NOT NULL THEN
      SELECT p.name::text, p.client_name::text, p.budget_range::text INTO v_pname, v_pclient, v_pbudget
        FROM public.projects p WHERE p.id = t.project_id;
    ELSE
      v_no_project_token := v_no_project_token + 1;
    END IF;

    -- (1) The record, WITHOUT broadcast_at. Everything from the agency-only token and the project.
    INSERT INTO public.rfp_records (lead_org_id, project_id, source, master_rfp, evaluation_criteria, budget_categories,
                                    business_criteria_required, output_template_config, total_budget,
                                    show_client_to_vendors, client_name_snapshot, response_deadline,
                                    close_bidding_at_deadline, require_terms_disclosure, nda_link, created_by, backfill_note)
    VALUES (t.org_id, t.project_id, 'backfill',
            jsonb_build_object(
              'projectName', v_pname,
              'scopeItems', jsonb_build_array(jsonb_build_object('id', t.scope_item_id, 'name', t.scope_item_name,
                                                                 'description', t.scope_item_description)),
              'referenceMaterials', CASE jsonb_typeof(t.reference_materials)
                                      WHEN 'array'  THEN t.reference_materials
                                      WHEN 'object' THEN coalesce(t.reference_materials -> 'materials', '[]'::jsonb)
                                      ELSE '[]'::jsonb END),
            nullif(t.evaluation_criteria, 'null'::jsonb),
            nullif(t.budget_categories, 'null'::jsonb),
            CASE WHEN jsonb_typeof(t.business_criteria_required) = 'object' THEN t.business_criteria_required ELSE '{}'::jsonb END,
            CASE WHEN jsonb_typeof(t.reference_materials) = 'object'
                 THEN nullif(t.reference_materials -> 'output_template_config', 'null'::jsonb) END,
            v_pbudget,
            false,
            nullif(btrim(v_pclient), ''),
            t.response_deadline,
            coalesce(t.close_bidding_at_deadline, false),
            coalesce(t.require_terms_disclosure, true),
            NULL,
            NULL,
            format('119 backfill of the Lightning RFP sent %s, rebuilt from the agency-only token row %s (D6)', t.created_at, t.tid))
    RETURNING id INTO v_rec;

    -- (2) Its one line. D2: released_budget = estimated_budget (the project's budget range).
    INSERT INTO public.rfp_record_lines (rfp_id, scope_item_key, scope_item_name, scope_item_description,
                                         estimated_budget, released_budget, sort_order)
    VALUES (v_rec, coalesce(t.scope_item_id, 'magic'),
            coalesce(nullif(btrim(t.scope_item_name), ''), nullif(btrim(v_pname), ''), 'Scope item'),
            t.scope_item_description, v_pbudget, v_pbudget, 0)
    RETURNING id INTO v_line;
    v_lines := v_lines + 1;

    -- (3) The token, and every inbox row attached for it (either key), carry the line.
    UPDATE public.rfp_magic_tokens SET rfp_line_id = v_line WHERE id::text = t.tid AND rfp_line_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not link % to its line. Nothing was committed.', v_gid USING ERRCODE = 'LG119';
    END IF;
    v_tokens_linked := v_tokens_linked + 1;

    UPDATE public.partner_rfp_inbox i
       SET rfp_line_id = v_line
     WHERE i.lead_org_id = t.org_id
       AND i.rfp_line_id IS NULL
       AND (coalesce(i.master_rfp_json @> jsonb_build_object('_magic_token', t.token), false)
            OR i.scope_item_id = 'magic:' || t.token);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inbox_linked := v_inbox_linked + v_n;

    -- (4) attached_inbox_id: the invitation's canonical row, first by (created_at, id), the order
    --     lib/magic-token-attach.ts keeps when it collapses duplicates.
    v_first_inbox := NULL;
    SELECT i.id INTO v_first_inbox FROM public.partner_rfp_inbox i
     WHERE i.lead_org_id = t.org_id AND i.rfp_line_id = v_line
     ORDER BY i.created_at, i.id LIMIT 1;
    IF v_first_inbox IS NOT NULL THEN
      UPDATE public.rfp_magic_tokens SET attached_inbox_id = v_first_inbox
       WHERE id::text = t.tid AND attached_inbox_id IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_tokens_attached := v_tokens_attached + v_n;
    END IF;

    -- (5) broadcast_at LAST, to the original send time.
    UPDATE public.rfp_records SET broadcast_at = t.created_at WHERE id = v_rec AND broadcast_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not set broadcast_at on record % (%). Nothing was committed.', v_rec, v_gid
        USING ERRCODE = 'LG119';
    END IF;
    v_records_magic := v_records_magic + 1;
  END LOOP;

  -- ===================================================================
  -- C. LIGHTNING INBOX ROWS STILL UNLINKED: attached after a step A send (linked to the token's
  --    existing line; the step A record, its lines and the token are not changed), or orphaned.
  -- ===================================================================
  FOR r IN
    SELECT i.id, i.lead_org_id, i.master_rfp_json ->> '_magic_token' AS marker, i.scope_item_id
      FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NULL
       AND (coalesce(i.master_rfp_json ? '_magic_token', false) OR coalesce(i.scope_item_id LIKE 'magic:%', false))
     ORDER BY i.created_at, i.id
  LOOP
    v_tok_line := NULL;
    v_tok_found := false;
    SELECT tk.rfp_line_id, true INTO v_tok_line, v_tok_found
      FROM public.rfp_magic_tokens tk
     WHERE tk.org_id = r.lead_org_id
       AND (tk.token = r.marker OR 'magic:' || tk.token = r.scope_item_id)
     ORDER BY tk.created_at, tk.id::text
     LIMIT 1;

    IF v_tok_found IS NOT TRUE THEN
      v_reason := 'a Lightning RFP inbox row whose token is not in its organization';
    ELSIF v_tok_line IS NULL THEN
      v_reason := 'a Lightning RFP inbox row whose token was refused above';
    ELSE
      v_reason := NULL;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_groups_refused := v_groups_refused + 1;
      v_refused := v_refused || format('inbox row %s: %s', r.id, v_reason);
      v_refused_inbox := v_refused_inbox || r.id::text;
      RAISE WARNING 'LG119 REFUSED inbox row %: %', r.id, v_reason USING ERRCODE = 'LG119';
      CONTINUE;
    END IF;

    UPDATE public.partner_rfp_inbox SET rfp_line_id = v_tok_line WHERE id = r.id AND rfp_line_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '119 stopped: could not link Lightning inbox row % to its token''s line. Nothing was committed.', r.id
        USING ERRCODE = 'LG119';
    END IF;
    v_inbox_linked := v_inbox_linked + 1;
    v_inbox_to_step_a := v_inbox_to_step_a + 1;
  END LOOP;

  -- ===================================================================
  -- D. THE ACCOUNTING. Every inbox row and token is linked or listed as refused; every backfilled
  --    record has lines and a send time. Anything else stops the whole file.
  -- ===================================================================
  SELECT count(*) INTO v_left FROM public.partner_rfp_inbox WHERE rfp_line_id IS NULL;
  IF v_left <> cardinality(v_refused_inbox)
     OR EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                 WHERE i.rfp_line_id IS NULL AND NOT (i.id::text = ANY (v_refused_inbox))) THEN
    RAISE EXCEPTION '119 stopped: % inbox rows are unlinked but % were refused. Nothing was committed.', v_left, cardinality(v_refused_inbox)
      USING ERRCODE = 'LG119';
  END IF;

  SELECT count(*) INTO v_left FROM public.rfp_magic_tokens WHERE rfp_line_id IS NULL;
  IF v_left <> cardinality(v_refused_tokens) THEN
    RAISE EXCEPTION '119 stopped: % tokens are unlinked but % were refused. Nothing was committed.', v_left, cardinality(v_refused_tokens)
      USING ERRCODE = 'LG119';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rfp_records rr
              WHERE rr.source = 'backfill'
                AND (rr.broadcast_at IS NULL OR rr.show_client_to_vendors
                     OR NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.rfp_id = rr.id))) THEN
    RAISE EXCEPTION '119 stopped: a backfilled record has no line, no broadcast_at, or shows the client. Nothing was committed.'
      USING ERRCODE = 'LG119';
  END IF;

  v_result := jsonb_build_object(
    'records',                v_records_wizard + v_records_magic,
    'records_wizard',         v_records_wizard,
    'records_lightning',      v_records_magic,
    'lines',                  v_lines,
    'inbox_rows_linked',      v_inbox_linked,
    'inbox_rows_linked_to_step_a_lines', v_inbox_to_step_a,
    'tokens_linked',          v_tokens_linked,
    'tokens_attached',        v_tokens_attached,
    'groups_refused',         v_groups_refused,
    'refused',                to_jsonb(v_refused),
    'refused_inbox_ids',      to_jsonb(v_refused_inbox),
    'refused_token_ids',      to_jsonb(v_refused_tokens),
    'unverified_single_copy', to_jsonb(v_unverified),
    'client_name_corrections', to_jsonb(v_client_fixes),
    'no_project_inbox_rows',  v_no_project_inbox,
    'no_project_tokens',      v_no_project_token);

  -- Transaction-local: gone at COMMIT. The pre-apply test reads it.
  PERFORM set_config('ligament.backfill_119', v_result::text, true);

  -- One message, built with format() (in RAISE itself "%%" is a literal percent sign).
  RAISE NOTICE '%', format(
    E'119 BACKFILL DONE.\n  records: %s (wizard %s, Lightning %s)\n  lines: %s\n  inbox rows linked: %s (of which %s to an existing step A line)\n  tokens linked: %s (attached_inbox_id set on %s)\n  groups refused: %s (%s inbox rows, %s tokens)%s\n  unverified single-copy groups: %s%s\n  client-name corrections: %s%s\n  rows with no project_id: %s inbox rows, %s tokens',
    v_records_wizard + v_records_magic, v_records_wizard, v_records_magic,
    v_lines,
    v_inbox_linked, v_inbox_to_step_a,
    v_tokens_linked, v_tokens_attached,
    v_groups_refused, cardinality(v_refused_inbox), cardinality(v_refused_tokens),
    CASE WHEN cardinality(v_refused) > 0 THEN E'\n    ' || array_to_string(v_refused, E'\n    ') ELSE '' END,
    cardinality(v_unverified),
    CASE WHEN cardinality(v_unverified) > 0 THEN E'\n    ' || array_to_string(v_unverified, E'\n    ') ELSE '' END,
    cardinality(v_client_fixes),
    CASE WHEN cardinality(v_client_fixes) > 0 THEN E'\n    ' || array_to_string(v_client_fixes, E'\n    ') ELSE '' END,
    v_no_project_inbox, v_no_project_token);
END
$backfill$;

-- PostgREST must see the new function at commit.
NOTIFY pgrst, 'reload schema';
-- <<< 119 BODY END
        $m119$;
        EXECUTE v_body;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('119 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
      v_res := nullif(current_setting('ligament.backfill_119', true), '')::jsonb;
    END IF;
  END LOOP;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  ---------------------------------------------------------------------
  -- AFTER 119.
  ---------------------------------------------------------------------
  EXECUTE v_pol_sql   INTO v_pol_after;
  EXECUTE v_acl_sql   INTO v_acl_after;
  EXECUTE v_trg_sql   INTO v_trg_after;
  EXECUTE v_rows_sql  INTO v_rows_after;
  EXECUTE v_stepa_sql INTO v_stepa_after;
  SELECT array_agg(p.proname || '(' || oidvectortypes(p.proargtypes) || ')' ORDER BY p.proname, oidvectortypes(p.proargtypes)) INTO v_fn_after
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
  SELECT count(*) INTO v_inbox_n1 FROM public.partner_rfp_inbox;
  SELECT count(*) INTO v_tok_n1 FROM public.rfp_magic_tokens;
  SELECT md5(coalesce((SELECT string_agg(i.id::text || ':' || coalesce(i.rfp_line_id::text, '') || ':' || coalesce(i.client_name_released, ''), ',' ORDER BY i.id)
                         FROM public.partner_rfp_inbox i WHERE i.id = ANY (v_pre_inbox)), ''))
      || md5(coalesce((SELECT string_agg(t.id::text || ':' || coalesce(t.rfp_line_id::text, '') || ':' || coalesce(t.attached_inbox_id::text, '') || ':' || coalesce(t.client_name_released, ''), ',' ORDER BY t.id::text)
                         FROM public.rfp_magic_tokens t WHERE t.id::text = ANY (v_pre_tok)), ''))
    INTO v_pre_link_fp1;

  ---------------------------------------------------------------------
  -- JUDGEMENT, exactly 118's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
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
      v_detail := v_detail || ' (BY DESIGN: no unpaid or second lead agency exists)';
    END IF;
    IF v_st = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_st = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1; END IF;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 66) || rpad(v_st, 14) || v_detail;
  END LOOP;

  ---------------------------------------------------------------------
  -- THE SELF-CHECKS, S1-S16. Each sets v_ok (and v_nos for NO SUBJECT) and v_detail.
  ---------------------------------------------------------------------

  -- S1. No policy changed (119 adds none).
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(before %s ; after %s)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S2. No table, column or function grant changed outside the new function.
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no grant changed outside the new function', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no grant changed outside the new function', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S3. No trigger changed (on any public table).
  v_ok := v_trg_before IS NOT DISTINCT FROM v_trg_after;
  v_detail := format('(before %s ; after %s)', v_trg_before, v_trg_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S3  no trigger changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S3  no trigger changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S4. Exactly one function added, none removed.
  SELECT coalesce(string_agg(x, ', '), '') INTO v_detail
    FROM (SELECT unnest(v_fn_after) EXCEPT SELECT unnest(v_fn_before)) AS a(x);
  SELECT coalesce(string_agg(x, ', '), '') INTO v_txt
    FROM (SELECT unnest(v_fn_before) EXCEPT SELECT unnest(v_fn_after)) AS b(x);
  v_ok := v_detail = c_fn_sig AND v_txt = '';
  v_detail := format('(added: %s ; removed: %s)', CASE WHEN v_detail = '' THEN 'none' ELSE v_detail END, CASE WHEN v_txt = '' THEN 'none' ELSE v_txt END);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S4  exactly one function added, none removed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S4  exactly one function added, none removed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S5. The function: plpgsql, SECURITY INVOKER, search_path pinned; anon cannot execute,
  --     authenticated can, no PUBLIC entry.
  SELECT NOT p.prosecdef
         AND l.lanname = 'plpgsql'
         AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    INTO v_ok
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rfp_record_set_client_visibility';
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S5  function: invoker, pinned; anon no, authenticated yes', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S5  function: invoker, pinned; anon no, authenticated yes', 66) || rpad('FAIL', 14) || '(read 119''s V5)'; END IF;

  -- S6. No inbox row or token changed outside the link columns; none added or removed.
  v_ok := v_rows_before IS NOT DISTINCT FROM v_rows_after AND v_inbox_n0 = v_inbox_n1 AND v_tok_n0 = v_tok_n1;
  v_detail := format('(inbox rows %s -> %s ; tokens %s -> %s ; rows outside link columns %s)', v_inbox_n0, v_inbox_n1, v_tok_n0, v_tok_n1,
                     CASE WHEN v_rows_before IS NOT DISTINCT FROM v_rows_after THEN 'unchanged' ELSE 'CHANGED' END);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S6  inbox/token rows unchanged outside the links; counts same', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S6  inbox/token rows unchanged outside the links; counts same', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S7. Every inbox row is linked, or listed by the backfill as refused (and only those).
  v_ok := false;
  IF v_res IS NULL THEN
    v_detail := '(the backfill result is not readable)';
  ELSE
    SELECT count(*) INTO v_n1 FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NULL
       AND NOT (i.id::text IN (SELECT jsonb_array_elements_text(v_res -> 'refused_inbox_ids')));
    SELECT count(*) INTO v_n2 FROM public.partner_rfp_inbox i
     WHERE i.rfp_line_id IS NOT NULL
       AND i.id::text IN (SELECT jsonb_array_elements_text(v_res -> 'refused_inbox_ids'));
    v_ok := v_n1 = 0 AND v_n2 = 0;
    v_detail := format('(unlinked and not listed: %s ; listed but linked: %s ; refused: %s)', v_n1, v_n2, jsonb_array_length(v_res -> 'refused_inbox_ids'));
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S7  every inbox row linked or listed as refused', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S7  every inbox row linked or listed as refused', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S8. Every token is linked, or listed by the backfill as refused (and only those).
  v_ok := false;
  IF v_res IS NULL THEN
    v_detail := '(the backfill result is not readable)';
  ELSE
    SELECT count(*) INTO v_n1 FROM public.rfp_magic_tokens t
     WHERE t.rfp_line_id IS NULL
       AND NOT (t.id::text IN (SELECT jsonb_array_elements_text(v_res -> 'refused_token_ids')));
    SELECT count(*) INTO v_n2 FROM public.rfp_magic_tokens t
     WHERE t.rfp_line_id IS NOT NULL
       AND t.id::text IN (SELECT jsonb_array_elements_text(v_res -> 'refused_token_ids'));
    v_ok := v_n1 = 0 AND v_n2 = 0;
    v_detail := format('(unlinked and not listed: %s ; listed but linked: %s ; refused: %s)', v_n1, v_n2, jsonb_array_length(v_res -> 'refused_token_ids'));
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S8  every token linked or listed as refused', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S8  every token linked or listed as refused', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S9. No step A record, line or link changed (every record and line that existed before, and the
  --     link columns of every inbox row and token that was linked before).
  v_ok := v_stepa_before IS NOT DISTINCT FROM v_stepa_after AND v_pre_link_fp0 IS NOT DISTINCT FROM v_pre_link_fp1;
  v_detail := format('(records and lines %s ; %s previously linked inbox rows and %s tokens %s)',
                     CASE WHEN v_stepa_before IS NOT DISTINCT FROM v_stepa_after THEN 'unchanged' ELSE 'CHANGED' END,
                     cardinality(v_pre_inbox), cardinality(v_pre_tok),
                     CASE WHEN v_pre_link_fp0 IS NOT DISTINCT FROM v_pre_link_fp1 THEN 'unchanged' ELSE 'CHANGED' END);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S9  no step A record, line or link changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S9  no step A record, line or link changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S10. Every backfilled record: lines, broadcast_at, client hidden (D3); no released client name
  --      on any row linked to it.
  SELECT count(*),
         count(*) FILTER (WHERE r.broadcast_at IS NULL OR r.show_client_to_vendors
                           OR NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.rfp_id = r.id))
    INTO v_n1, v_n2
  FROM public.rfp_records r WHERE r.source = 'backfill';
  SELECT (SELECT count(*) FROM public.partner_rfp_inbox i JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
            JOIN public.rfp_records r ON r.id = l.rfp_id WHERE r.source = 'backfill' AND i.client_name_released IS NOT NULL)
       + (SELECT count(*) FROM public.rfp_magic_tokens t JOIN public.rfp_record_lines l ON l.id = t.rfp_line_id
            JOIN public.rfp_records r ON r.id = l.rfp_id WHERE r.source = 'backfill' AND t.client_name_released IS NOT NULL)
    INTO v_n3;
  v_nos := v_n1 = 0;
  v_ok := v_n1 > 0 AND v_n2 = 0 AND v_n3 = 0;
  v_detail := format('(backfilled records %s ; without line, send time or with client shown %s ; rows releasing a client name %s)', v_n1, v_n2, v_n3);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S10 backfilled: lines, broadcast_at, client hidden (D3)', 66) || rpad('PASS', 14) || v_detail;
  ELSIF v_nos AND v_res IS NOT NULL AND (v_res ->> 'records')::integer = 0 THEN
    v_inconc := v_inconc + 1; v_lines := v_lines || E'\n  ' || rpad('S10 backfilled: lines, broadcast_at, client hidden (D3)', 66) || rpad('INCONCLUSIVE', 14) || v_detail || ' [NO SUBJECT: nothing to backfill]';
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S10 backfilled: lines, broadcast_at, client hidden (D3)', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S11. D2: released_budget = estimated_budget on every backfilled line.
  SELECT count(*), count(*) FILTER (WHERE l.released_budget IS DISTINCT FROM l.estimated_budget)
    INTO v_n1, v_n2
  FROM public.rfp_record_lines l JOIN public.rfp_records r ON r.id = l.rfp_id WHERE r.source = 'backfill';
  v_ok := v_n1 > 0 AND v_n2 = 0;
  v_detail := format('(backfilled lines %s ; released differs from estimated %s)', v_n1, v_n2);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S11 backfilled lines: released = estimated (D2)', 66) || rpad('PASS', 14) || v_detail;
  ELSIF v_n1 = 0 THEN v_inconc := v_inconc + 1; v_lines := v_lines || E'\n  ' || rpad('S11 backfilled lines: released = estimated (D2)', 66) || rpad('INCONCLUSIVE', 14) || v_detail || ' [NO SUBJECT]';
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S11 backfilled lines: released = estimated (D2)', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S12. The provenance rule held: each backfilled wizard record's rubric, categories and
  --      requirements equal EVERY inbox copy linked to it. Reports how many records had 2+ copies.
  SELECT count(*) FILTER (WHERE r.evaluation_criteria IS DISTINCT FROM nullif(i.master_rfp_json -> 'evaluation_criteria', 'null'::jsonb)
                             OR r.budget_categories IS DISTINCT FROM nullif(i.master_rfp_json -> 'budget_categories', 'null'::jsonb)
                             OR r.business_criteria_required IS DISTINCT FROM
                                CASE WHEN jsonb_typeof(i.master_rfp_json -> 'business_criteria_required') = 'object'
                                     THEN i.master_rfp_json -> 'business_criteria_required' ELSE '{}'::jsonb END),
         count(DISTINCT r.id)
    INTO v_n1, v_n2
  FROM public.rfp_records r
  JOIN public.rfp_record_lines l ON l.rfp_id = r.id
  JOIN public.partner_rfp_inbox i ON i.rfp_line_id = l.id
  WHERE r.source = 'backfill' AND r.backfill_note LIKE '%of the wizard send of%';
  SELECT count(*) INTO v_n3 FROM (
    SELECT r.id FROM public.rfp_records r
    JOIN public.rfp_record_lines l ON l.rfp_id = r.id
    JOIN public.partner_rfp_inbox i ON i.rfp_line_id = l.id
    WHERE r.source = 'backfill' AND r.backfill_note LIKE '%of the wizard send of%'
    GROUP BY r.id HAVING count(*) > 1) m;
  v_ok := v_n2 > 0 AND v_n1 = 0;
  v_detail := format('(wizard records %s, of them rebuilt from 2+ copies %s ; copies that differ from their record %s)', v_n2, v_n3, v_n1);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok AND v_n3 > 0 THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S12 provenance: each wizard record equals its copies', 66) || rpad('PASS', 14) || v_detail;
  ELSIF v_n1 = 0 AND (v_n2 = 0 OR v_n3 = 0) THEN v_inconc := v_inconc + 1; v_lines := v_lines || E'\n  ' || rpad('S12 provenance: each wizard record equals its copies', 66) || rpad('INCONCLUSIVE', 14) || v_detail || ' [NO SUBJECT: no wizard record rebuilt from 2+ copies]';
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S12 provenance: each wizard record equals its copies', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S13. The unverified list is exact: every wizard record rebuilt from ONE copy is noted
  --      'unverified single copy' and listed, and no other record is.
  v_ok := false;
  IF v_res IS NULL THEN
    v_detail := '(the backfill result is not readable)';
  ELSE
    SELECT count(*) FILTER (WHERE m.copies = 1 AND m.note LIKE 'unverified single copy%'),
           count(*) FILTER (WHERE (m.copies = 1) <> (m.note LIKE 'unverified single copy%'))
      INTO v_n1, v_n2
    FROM (SELECT r.id, r.backfill_note AS note, count(i.id) AS copies
            FROM public.rfp_records r
            JOIN public.rfp_record_lines l ON l.rfp_id = r.id
            LEFT JOIN public.partner_rfp_inbox i ON i.rfp_line_id = l.id
           WHERE r.source = 'backfill' AND r.backfill_note LIKE '%of the wizard send of%'
           GROUP BY r.id, r.backfill_note) m;
    v_ok := v_n2 = 0 AND v_n1 = jsonb_array_length(v_res -> 'unverified_single_copy');
    v_detail := format('(single-copy records noted %s ; listed %s ; mismatches %s)', v_n1, jsonb_array_length(v_res -> 'unverified_single_copy'), v_n2);
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S13 unverified single-copy list exact and printed below', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S13 unverified single-copy list exact and printed below', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S14. Client names: every backfilled record with a project carries the project's client name,
  --      and the corrections listed equal the records noted 'client name taken from project'.
  v_ok := false;
  IF v_res IS NULL THEN
    v_detail := '(the backfill result is not readable)';
  ELSE
    SELECT count(*) FILTER (WHERE r.client_name_snapshot IS DISTINCT FROM nullif(btrim(p.client_name::text), '')),
           count(*) FILTER (WHERE r.backfill_note LIKE '%client name taken from project%')
      INTO v_n1, v_n2
    FROM public.rfp_records r JOIN public.projects p ON p.id = r.project_id
    WHERE r.source = 'backfill';
    v_ok := v_n1 = 0 AND v_n2 = jsonb_array_length(v_res -> 'client_name_corrections');
    v_detail := format('(records whose client name differs from the project %s ; corrections noted %s ; listed %s)', v_n1, v_n2, jsonb_array_length(v_res -> 'client_name_corrections'));
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S14 client name from the project; corrections listed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S14 client name from the project; corrections listed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S15. Tokens: every token linked to a backfilled line belongs to that record's organization, and
  --      its attached_inbox_id (if any) is an inbox row of the same organization on the same line.
  SELECT count(*),
         count(*) FILTER (WHERE r.lead_org_id IS DISTINCT FROM t.org_id
                           OR (t.attached_inbox_id IS NOT NULL
                               AND NOT EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
                                                WHERE i.id = t.attached_inbox_id AND i.lead_org_id = t.org_id
                                                  AND i.rfp_line_id = t.rfp_line_id)))
    INTO v_n1, v_n2
  FROM public.rfp_magic_tokens t
  JOIN public.rfp_record_lines l ON l.id = t.rfp_line_id
  JOIN public.rfp_records r ON r.id = l.rfp_id
  WHERE r.source = 'backfill';
  v_ok := v_n1 > 0 AND v_n2 = 0;
  v_detail := format('(backfilled tokens %s ; wrong organization or attachment %s)', v_n1, v_n2);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S15 tokens: own line, own org, attached row on the same line', 66) || rpad('PASS', 14) || v_detail;
  ELSIF v_n1 = 0 THEN v_inconc := v_inconc + 1; v_lines := v_lines || E'\n  ' || rpad('S15 tokens: own line, own org, attached row on the same line', 66) || rpad('INCONCLUSIVE', 14) || v_detail || ' [NO SUBJECT: no token was backfilled]';
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S15 tokens: own line, own org, attached row on the same line', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S16. Idempotency: a second run of the SAME inlined body refuses with LG119, naming the
  --      backfill. If it did not refuse, whatever it did is undone with LG097.
  IF array_length(v_apply_err, 1) IS NULL AND v_body IS NOT NULL THEN
    BEGIN
      EXECUTE v_body;
      v_idem := 'NO ERROR';
      RAISE EXCEPTION 'undo' USING ERRCODE = 'LG097';
    EXCEPTION
      WHEN sqlstate 'LG097' THEN NULL;
      WHEN OTHERS THEN v_idem := SQLSTATE || ' ' || left(SQLERRM, 120);
    END;
  END IF;
  SELECT count(*) INTO v_n1 FROM public.rfp_records WHERE source = 'backfill';
  v_ok := v_idem LIKE 'LG119 %source = backfill%';
  v_detail := format('(second run: %s)', v_idem);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S16 idempotency: a second run refuses (LG119)', 66) || rpad('PASS', 14) || v_detail;
  ELSIF v_n1 = 0 THEN v_inconc := v_inconc + 1; v_lines := v_lines || E'\n  ' || rpad('S16 idempotency: a second run refuses (LG119)', 66) || rpad('INCONCLUSIVE', 14) || v_detail || ' [NO SUBJECT: nothing was backfilled]';
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S16 idempotency: a second run refuses (LG119)', 66) || rpad('FAIL', 14) || v_detail; END IF;

  ---------------------------------------------------------------------
  -- THE BACKFILL, AS THE REAL APPLY WILL DO IT (from ligament.backfill_119).
  ---------------------------------------------------------------------
  IF v_res IS NULL THEN
    v_backfill := E'  (not readable: read 119''s V1 to V4 after a dry run)\n';
  ELSE
    v_backfill :=
         format(E'  records %s (wizard %s, Lightning %s); lines %s\n', v_res ->> 'records', v_res ->> 'records_wizard', v_res ->> 'records_lightning', v_res ->> 'lines')
      || format(E'  inbox rows linked %s (of which %s to an existing step A line); tokens linked %s (attached_inbox_id set on %s)\n',
                v_res ->> 'inbox_rows_linked', v_res ->> 'inbox_rows_linked_to_step_a_lines', v_res ->> 'tokens_linked', v_res ->> 'tokens_attached')
      || format(E'  rows with no project_id: %s inbox rows, %s tokens\n', v_res ->> 'no_project_inbox_rows', v_res ->> 'no_project_tokens')
      || format(E'  REFUSED (%s):%s\n', v_res ->> 'groups_refused',
                coalesce((SELECT string_agg(E'\n    ' || x, '') FROM jsonb_array_elements_text(v_res -> 'refused') AS x), ' none'))
      || format(E'  UNVERIFIED SINGLE COPY (%s):%s\n', jsonb_array_length(v_res -> 'unverified_single_copy'),
                coalesce((SELECT string_agg(E'\n    ' || x, '') FROM jsonb_array_elements_text(v_res -> 'unverified_single_copy') AS x), ' none'))
      || format(E'  CLIENT NAME TAKEN FROM PROJECT (%s):%s\n', jsonb_array_length(v_res -> 'client_name_corrections'),
                coalesce((SELECT string_agg(E'\n    ' || x, '') FROM jsonb_array_elements_text(v_res -> 'client_name_corrections') AS x), ' none'));
  END IF;

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
    v_headline := format('DO NOT APPLY 119.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 119.';
    v_headline := format('SAFE TO APPLY 119.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 AND v_inconc = v_inconc_dsg THEN
    v_verdict_text := 'SAFE TO APPLY 119. The only INCONCLUSIVE rows are the NO SUBJECT cases ruled INCONCLUSIVE BY DESIGN.';
    v_headline := format('SAFE TO APPLY 119.  %s assertions passed; %s INCONCLUSIVE BY DESIGN (NO SUBJECT: %s - no unpaid or second lead agency exists). Nothing FAILED.',
                         v_pass, v_inconc_dsg, v_dsg_ids);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion beyond the by-design ones could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 119 YET.  %s assertion(s) INCONCLUSIVE (%s of them by design) - nothing FAILED, but the run does NOT show 119 does what it claims.', v_inconc, v_inconc_dsg);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 119.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s: 16 scenarios + 16 self-checks + M)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 2, both by design: U1, X1; NO SUBJECT counts here)\n', v_inconc)
    || format(E'BEFORE 119      : %s\n', v_unlinked0)
    || format(E'isolation check : %s scenario run(s) compared to the pre-phase fingerprint of partner_rfp_inbox, rfp_magic_tokens, rfp_records, rfp_record_lines, projects: %s\n',
              v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT         : lead org %s, project %s, agency member %s (entitled through 118''s helper: %s); vendor %s of org %s on partnership %s; token %s; other org %s; unpaid %s/%s; second lead agency %s/%s%s\n',
              v_o1, coalesce(v_p1::text, 'NONE'), coalesce(v_u1::text, 'NONE'), v_m1_entitled,
              coalesce(v_uv::text, 'NONE'), coalesce(v_ov::text, 'NONE'), coalesce(v_ps1::text, 'NONE'),
              coalesce(v_tok, 'NONE'), coalesce(v_oo::text, 'NONE'), coalesce(v_uu::text, 'NONE'), coalesce(v_ou::text, 'NONE'),
              coalesce(v_ux::text, 'NONE'), coalesce(v_ox::text, 'NONE'),
              CASE WHEN v_fallback THEN ' [FALLBACK: no qualifying partnership, vendor scenarios are NO SUBJECT]' ELSE '' END)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nBACKFILL (what the real apply will do)\n'
    || v_backfill
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 119\n  phase 2 = AFTER 119\n'
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
