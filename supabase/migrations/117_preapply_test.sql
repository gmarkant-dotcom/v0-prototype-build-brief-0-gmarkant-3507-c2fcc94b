-- =====================================================================
-- 117 PRE-APPLY TEST. ONE PASTE. APPLIES 117, WRITES, READS, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-14 on feat/budget-line-kind (unattended run). NOT RUN: THERE IS NO LOCAL
-- POSTGRES AND NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain
-- error, not in "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code below (between $m117$ markers) is 117_budget_line_kind.sql,
-- lines 140-188 (the body between BEGIN; and COMMIT;, without the blank first and last lines).
-- If you edit the migration, re-copy it here.
--
-- 103, 104 AND 116 ARE LIVE (103/104 applied 2026-10-12, 116 applied 2026-10-14). This test does not
-- apply them; it applies only 117, inside its own transaction, between phase 1 and phase 2. It
-- reads 116's columns (quantity, unit_rate, multiplier, unit_label) and relies on 116's trigger.
--
-- WHAT 117 MUST SHOW: a line inserted without a kind reads NULL (inherit); a line can be set to fee
-- and to cost and reset to NULL; anything but 'fee', 'cost' or NULL is refused (case included);
-- changing ONLY the kind on a line with a unit rate leaves its estimate unchanged (116's trigger
-- fires on every update and recomputes the same number); moving a line to another category (what a
-- merge or a category re-flag does) keeps an override and lets an inherited line take the new
-- category's kind; a vendor cannot read, update or insert the column; anon nothing; no policy and
-- no grant changed; 116's trigger and function unchanged; existing rows unchanged, none given a kind.
--
-- PHASES: phase 1 BEFORE 117 (the column does not exist: every kind scenario answers MISSING, every
-- no-kind scenario answers what it answers today), phase 2 AFTER 117. EVERY SCENARIO RUNS IN EVERY
-- PHASE. A phase-1 mismatch is INCONCLUSIVE (the premise is wrong), never PASS; a phase-2 mismatch
-- is FAIL.
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
--     "SAFE TO APPLY 117."       -> and only this.
--     "DO NOT APPLY 117 YET."    -> INCONCLUSIVE or NO SUBJECT. Not a green light.
--     "DO NOT APPLY 117."        -> an assertion FAILED, or the test is broken.
-- Rows read PASS, FAIL, INCONCLUSIVE, NOT DISCRIMINATING (same expectation in both phases, reported
-- as PASS with that note) or NO SUBJECT (reported as INCONCLUSIVE, never PASS).
--
-- EXPECTED COUNT: 21 scenarios + 7 self-checks + M = 29 assertions.
--
-- THIS FILE DEFINES NO FUNCTION IN pg_temp AND NO TEMP TABLE. Every row it writes is written inside
-- a scenario's own nested block, which ends in LG097 and is undone with it.
--
-- =====================================================================
-- THE SUBJECTS (116's selection, as corrected in 4d3fa5a)
-- =====================================================================
-- vendor : a member of a partnership's VENDOR ORGANIZATION (partnerships.vendor_org_id; the old
--          partner_id was renamed in 079, which is what failed 116's first run) who is NOT a member
--          of the lead organization, preferring a partnership with a project assignment on a project
--          of that lead organization (so the vendor CAN read the project row through
--          projects_partner_select_assigned: the strongest case for "reads nothing"). The SUBJECT
--          line reports whether the vendor can read the project.
-- o1, p1 : that partnership's lead organization and a project of it, preferring the assigned one.
-- m1     : a member of o1, preferring role owner. The agency actor.
-- anon   : SET LOCAL ROLE anon.
-- If no partnership qualifies, o1/p1/m1 fall back to any organization with a member and a project,
-- and every vendor scenario reports NO SUBJECT (INCONCLUSIVE).
-- Each scenario's SETUP runs as the table owner (no end-user session; it stands in for the trusted
-- path): it inserts one or two categories on p1 and, where needed, one line, with fixed throwaway ids.
-- IT IMPERSONATES AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE authenticated, then
-- auth.uid() is read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097. A fingerprint
-- of every budget_lines and budget_project_categories row is compared after each.
--
-- RESULT CODES: OK:<value> (the scenario's one text value), MISSING (42703: the column does not
-- exist), E:<sqlstate> (refused with that code).
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * Column resolution (42703) is reported before the privilege check (42501) for anon and the
--     vendor in phase 1; KV3's and KA1-KA3's phase-1 expectations accept either.
--   * RETURNING from a data-modifying CTE shows the row as the BEFORE trigger left it (116's run
--     confirmed this for INSERT and UPDATE: C7, C8 passed).
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 28;
  c_phases       CONSTANT integer := 2;
  v_o1           uuid;
  v_p1           uuid;
  v_u1           uuid;
  v_uv           uuid;
  v_ps1          uuid;
  v_fallback     boolean := false;
  v_vendor_sees  boolean := false;
  v_cat          uuid := gen_random_uuid();
  v_cat2         uuid := gen_random_uuid();
  v_line         uuid := gen_random_uuid();
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
  v_rows_before  text;
  v_rows_after   text;
  v_trg_before   text;
  v_trg_after    text;
  v_kind_rows    bigint;
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
  v_fp_sql       CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_lines x), ''))
           || md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_project_categories x), ''))$f$;
  v_pol_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                      E'\n' ORDER BY tablename, policyname), ''))
       FROM pg_policies WHERE schemaname = 'public'$f$;
  v_acl_sql      CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), E'\n' ORDER BY c.relname)
                             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')), ''))
           || md5(coalesce((SELECT string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, E'\n' ORDER BY c.relname, a.attname)
                             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped), ''))$f$;
  -- Every column that exists before 117 (103's and 116's), so "existing rows unchanged" is byte-exact.
  v_rows_sql     CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(concat_ws('|', id, project_id, category_id, name, estimate, archived_at, created_at,
                                                 quantity, unit_rate, multiplier, unit_label), E'\n' ORDER BY id), ''))
       FROM public.budget_lines$f$;
  -- 116's trigger and its function body, so "116 unchanged" is exact.
  v_trg_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype || ':' || p.oid::regprocedure::text || ':' || p.prosrc
                                      || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':' || coalesce(p.proacl::text, ''),
                                      E'\n' ORDER BY t.tgname), ''))
       FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid = 'public.budget_lines'::regclass AND NOT t.tgisinternal$f$;

  -- Setup fragments. format() arguments everywhere: %1$L p1, %2$L the category (cost),
  -- %3$L the line, %4$L the second category (fee).
  s_cat   CONSTANT text := $s$INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%2$L, %1$L, 'LG117 cost category', 'cost');$s$;
  s_cat2  CONSTANT text := $s$INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%4$L, %1$L, 'LG117 fee category', 'fee');$s$;
  s_plain CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate) VALUES (%3$L, %1$L, %2$L, 'LG117 plain line', 100);$s$;
  s_math  CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%3$L, %1$L, %2$L, 'LG117 math line', 0, 4, 25);$s$;
  s_round CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, quantity, unit_rate, multiplier) VALUES (%3$L, %1$L, %2$L, 'LG117 rounding line', 0, 0.125, 0.20, 1);$s$;
  s_fee   CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, fee_or_cost) VALUES (%3$L, %1$L, %2$L, 'LG117 fee line', 100, 'fee');$s$;
  s_costo CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, fee_or_cost) VALUES (%3$L, %1$L, %2$L, 'LG117 cost override line', 100, 'cost');$s$;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
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
  SELECT vm.user_id, ps.id, ps.lead_org_id
    INTO v_uv, v_ps1, v_o1
  FROM public.partnerships ps
  JOIN public.org_members vm ON vm.org_id = ps.vendor_org_id
  WHERE ps.vendor_org_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = ps.lead_org_id)
    AND EXISTS (SELECT 1 FROM public.projects pr WHERE pr.org_id = ps.lead_org_id)
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = vm.user_id AND x.org_id = ps.lead_org_id)
  ORDER BY (ps.vendor_org_id = vm.org_id
            AND EXISTS (SELECT 1 FROM public.project_assignments pa JOIN public.projects pr ON pr.id = pa.project_id
                        WHERE pa.partnership_id = ps.id AND pr.org_id = ps.lead_org_id)) DESC,
           (EXISTS (SELECT 1 FROM public.project_assignments pa WHERE pa.partnership_id = ps.id)) DESC,
           ps.id, vm.user_id
  LIMIT 1;

  IF v_o1 IS NULL THEN
    v_fallback := true;
    SELECT pr.org_id INTO v_o1 FROM public.projects pr
    WHERE EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = pr.org_id)
    ORDER BY pr.org_id LIMIT 1;
  END IF;

  IF v_o1 IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 117 YET.  NO SUBJECT: no organization has both a member and a project. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  SELECT pr.id INTO v_p1 FROM public.projects pr WHERE pr.org_id = v_o1
  ORDER BY (v_ps1 IS NOT NULL AND EXISTS (SELECT 1 FROM public.project_assignments pa
                                          WHERE pa.project_id = pr.id AND pa.partnership_id = v_ps1)) DESC,
           pr.id
  LIMIT 1;

  SELECT m.user_id INTO v_u1 FROM public.org_members m WHERE m.org_id = v_o1
  ORDER BY (m.role = 'owner') DESC, m.user_id LIMIT 1;

  -- Can the vendor read the project row? Reported, not asserted.
  IF v_uv IS NOT NULL THEN
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uv::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_uv::text, true);
      SET LOCAL ROLE authenticated;
      IF auth.uid() IS DISTINCT FROM v_uv THEN
        RAISE EXCEPTION 'impersonation mismatch (vendor probe)' USING ERRCODE = 'LG098';
      END IF;
      v_vendor_sees := EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = v_p1);
      RESET ROLE;
      RAISE EXCEPTION 'probe done' USING ERRCODE = 'LG097';
    EXCEPTION WHEN sqlstate 'LG097' THEN NULL;
    END;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  ---------------------------------------------------------------------
  -- THE SCENARIOS. Parallel arrays; position i describes scenario i. sc_setup runs as the owner
  -- (may be several statements), sc_sql as the actor (ONE statement returning one text value).
  ---------------------------------------------------------------------
  sc_id := ARRAY['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'K11', 'K12',
                 'K13', 'K14', 'K15', 'KV1', 'KV2', 'KV3', 'KA1', 'KA2', 'KA3'];

  sc_label := ARRAY[
    $l$K1  agency: INSERT without a kind reads NULL (inherit)$l$,
    $l$K2  agency: INSERT with kind fee$l$,
    $l$K3  agency: INSERT with kind cost$l$,
    $l$K4  agency: override an inherited line to fee$l$,
    $l$K5  agency: override an inherited line to cost$l$,
    $l$K6  agency: reset an override to NULL (inherit)$l$,
    $l$K7  agency: 'Fee' (wrong case) refused$l$,
    $l$K8  agency: 'margin' refused$l$,
    $l$K9  agency: empty string refused$l$,
    $l$K10 agency: kind-only UPDATE on a rated line keeps estimate$l$,
    $l$K11 agency: kind-only UPDATE keeps a rounded estimate (0.03)$l$,
    $l$K12 agency: kind-only UPDATE on a typed line keeps estimate$l$,
    $l$K13 agency: moving an override line keeps its override$l$,
    $l$K14 agency: moving an inherited line takes the new kind$l$,
    $l$K15 agency: INSERT with no kind and no math as before$l$,
    $l$KV1 vendor: reads no line's kind$l$,
    $l$KV2 vendor: cannot UPDATE a line's kind$l$,
    $l$KV3 vendor: cannot INSERT a line with a kind$l$,
    $l$KA1 anon: cannot read the kind$l$,
    $l$KA2 anon: cannot UPDATE the kind$l$,
    $l$KA3 anon: cannot INSERT a line with a kind$l$];

  sc_actor := ARRAY['m1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1',
                    'm1', 'm1', 'm1', 'vendor', 'vendor', 'vendor', 'anon', 'anon', 'anon'];

  sc_setup := ARRAY[
    s_cat,                                                     -- K1
    s_cat,                                                     -- K2
    s_cat,                                                     -- K3
    s_cat || s_plain,                                          -- K4
    s_cat || s_plain,                                          -- K5
    s_cat || s_fee,                                            -- K6
    s_cat || s_plain,                                          -- K7
    s_cat || s_plain,                                          -- K8
    s_cat || s_plain,                                          -- K9
    s_cat || s_math,                                           -- K10
    s_cat || s_round,                                          -- K11
    s_cat || s_plain,                                          -- K12
    s_cat || s_cat2 || s_costo,                                -- K13
    s_cat || s_cat2 || s_plain,                                -- K14
    s_cat,                                                     -- K15
    s_cat || s_fee,                                            -- KV1
    s_cat || s_plain,                                          -- KV2
    s_cat,                                                     -- KV3
    s_cat || s_plain,                                          -- KA1
    s_cat || s_plain,                                          -- KA2
    s_cat];                                                    -- KA3

  sc_sql := ARRAY[
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%1$L, %2$L, 'LG117 K1', 10) RETURNING fee_or_cost) SELECT coalesce(fee_or_cost, 'NULL') FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, fee_or_cost) VALUES (%1$L, %2$L, 'LG117 K2', 10, 'fee') RETURNING fee_or_cost) SELECT coalesce(fee_or_cost, 'NULL') FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, fee_or_cost) VALUES (%1$L, %2$L, 'LG117 K3', 10, 'cost') RETURNING fee_or_cost) SELECT coalesce(fee_or_cost, 'NULL') FROM i$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'fee' WHERE id = %3$L RETURNING fee_or_cost) SELECT coalesce(string_agg(coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'cost' WHERE id = %3$L RETURNING fee_or_cost) SELECT coalesce(string_agg(coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = NULL WHERE id = %3$L RETURNING fee_or_cost) SELECT coalesce(string_agg(coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'Fee' WHERE id = %3$L RETURNING fee_or_cost) SELECT coalesce(string_agg(coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'margin' WHERE id = %3$L RETURNING fee_or_cost) SELECT coalesce(string_agg(coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = '' WHERE id = %3$L RETURNING fee_or_cost) SELECT coalesce(string_agg(coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'fee' WHERE id = %3$L RETURNING estimate, fee_or_cost) SELECT coalesce(string_agg(estimate::text || '|' || coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'fee' WHERE id = %3$L RETURNING estimate, fee_or_cost) SELECT coalesce(string_agg(estimate::text || '|' || coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'fee' WHERE id = %3$L RETURNING estimate, fee_or_cost) SELECT coalesce(string_agg(estimate::text || '|' || coalesce(fee_or_cost, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET category_id = %4$L WHERE id = %3$L RETURNING category_id, fee_or_cost) SELECT coalesce(string_agg(coalesce(u.fee_or_cost, 'NULL') || '|' || coalesce(u.fee_or_cost, c.fee_or_cost), ','), 'NONE') FROM u JOIN public.budget_project_categories c ON c.id = u.category_id$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET category_id = %4$L WHERE id = %3$L RETURNING category_id, fee_or_cost) SELECT coalesce(string_agg(coalesce(u.fee_or_cost, 'NULL') || '|' || coalesce(u.fee_or_cost, c.fee_or_cost), ','), 'NONE') FROM u JOIN public.budget_project_categories c ON c.id = u.category_id$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%1$L, %2$L, 'LG117 K15', 123.45) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$SELECT count(*)::text FROM (SELECT fee_or_cost FROM public.budget_lines WHERE id = %3$L) s$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'fee' WHERE id = %3$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, fee_or_cost) VALUES (%1$L, %2$L, 'LG117 KV3', 1, 'fee') RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$SELECT count(*)::text FROM (SELECT fee_or_cost FROM public.budget_lines WHERE project_id = %1$L) s$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET fee_or_cost = 'fee' WHERE id = %3$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, fee_or_cost) VALUES (%1$L, %2$L, 'LG117 KA3', 1, 'fee') RETURNING 1) SELECT count(*)::text FROM i$q$];

  sc_exp := ARRAY[
    'MISSING', 'OK:NULL',                           -- K1
    'MISSING', 'OK:fee',                            -- K2
    'MISSING', 'OK:cost',                           -- K3
    'MISSING', 'OK:fee',                            -- K4
    'MISSING', 'OK:cost',                           -- K5
    'MISSING', 'OK:NULL',                           -- K6 (setup writes the column: MISSING before 117)
    'MISSING', 'E:23514',                           -- K7
    'MISSING', 'E:23514',                           -- K8
    'MISSING', 'E:23514',                           -- K9
    'MISSING', 'OK:100.00|fee',                     -- K10
    'MISSING', 'OK:0.03|fee',                       -- K11
    'MISSING', 'OK:100.00|fee',                     -- K12
    'MISSING', 'OK:cost|cost',                      -- K13 stored override, effective kind
    'MISSING', 'OK:NULL|fee',                       -- K14 stored NULL, effective kind of the new category
    'OK:123.45', 'OK:123.45',                       -- K15
    'MISSING', 'OK:0',                              -- KV1 (setup writes the column: MISSING before 117)
    'MISSING', 'OK:0',                              -- KV2
    'MISSING OR E:42501', 'E:42501',                -- KV3
    'MISSING OR E:42501', 'E:42501',                -- KA1
    'MISSING OR E:42501', 'E:42501',                -- KA2
    'MISSING OR E:42501', 'E:42501'];               -- KA3

  v_n := array_length(sc_id, 1);
  IF v_n <> 21 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_setup, 1) <> v_n OR array_length(sc_sql, 1) <> v_n
     OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length';
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  EXECUTE v_pol_sql  INTO v_pol_before;
  EXECUTE v_acl_sql  INTO v_acl_before;
  EXECUTE v_rows_sql INTO v_rows_before;
  EXECUTE v_trg_sql  INTO v_trg_before;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 117 is executed between phases.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    EXECUTE v_fp_sql INTO v_fp0;

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc_actor[v_i];
      v_uid := CASE v_actor WHEN 'm1' THEN v_u1 WHEN 'vendor' THEN v_uv ELSE NULL END;

      IF (v_actor = 'vendor' AND v_uv IS NULL) OR (v_actor = 'm1' AND v_u1 IS NULL) OR v_p1 IS NULL THEN
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
            EXECUTE format(sc_setup[v_i], v_p1, v_cat, v_line, v_cat2);
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

          EXECUTE format(sc_sql[v_i], v_p1, v_cat, v_line, v_cat2) INTO v_txt;
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
              WHEN SQLSTATE = '42703' THEN 'MISSING'
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
        EXECUTE $m117$
-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION '117 refuses to apply: public.budget_lines does not exist. Apply 103 first.'
      USING ERRCODE = 'LG117';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.budget_lines'::regclass
               AND a.attname = 'fee_or_cost' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '117 refuses to apply: budget_lines already has fee_or_cost. Read the schema first; a drifted column must not be skipped silently.'
      USING ERRCODE = 'LG117';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.budget_lines'::regclass
               AND conname = 'budget_lines_fee_or_cost_check') THEN
    RAISE EXCEPTION '117 refuses to apply: budget_lines_fee_or_cost_check already exists.'
      USING ERRCODE = 'LG117';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE COLUMN. Nullable, no default: nothing is rewritten and every existing row reads NULL,
--    which is "inherit the category's kind", which is today's behaviour.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines ADD COLUMN fee_or_cost text NULL;

COMMENT ON COLUMN public.budget_lines.fee_or_cost IS
  'Migration 117 (R-K1). The line''s own fee or cost, overriding its category''s. NULL = inherit '
  'the category''s fee_or_cost. Effective kind = coalesce(budget_lines.fee_or_cost, '
  'budget_project_categories.fee_or_cost). Every total, margin and percentage sums by effective kind '
  'per line. Merging or re-flagging a category moves inherited lines with it; an override stays.';


-- ---------------------------------------------------------------------
-- 2. THE CHECK. The category's two values, written to pass on NULL explicitly.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_fee_or_cost_check
  CHECK (fee_or_cost IS NULL OR fee_or_cost IN ('fee', 'cost'));

-- PostgREST must see the column at commit.
NOTIFY pgrst, 'reload schema';
        $m117$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('117 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
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
  -- JUDGEMENT, exactly 116's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
  -- An expectation may list several accepted values separated by ' OR '.
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
    IF v_st = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_st = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1; END IF;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 66) || rpad(v_st, 14) || v_detail;
  END LOOP;

  -- S1. No policy anywhere in public changed (117 adds none and touches none).
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(before %s ; after %s)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy in public changed (fingerprint)', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S1  no policy in public changed (fingerprint)', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S2. No grant changed: every relacl in public and every column ACL in public.
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no table or column grant in public changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no table or column grant in public changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S3. The column exists, nullable, with exactly the category column's type.
  SELECT count(*) = 1 INTO v_ok
  FROM pg_attribute a, pg_attribute ca
  WHERE a.attrelid = 'public.budget_lines'::regclass AND a.attname = 'fee_or_cost' AND NOT a.attisdropped AND NOT a.attnotnull
    AND ca.attrelid = 'public.budget_project_categories'::regclass AND ca.attname = 'fee_or_cost' AND NOT ca.attisdropped
    AND format_type(a.atttypid, a.atttypmod) = format_type(ca.atttypid, ca.atttypmod)
    AND format_type(a.atttypid, a.atttypmod) = 'text';
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S3  fee_or_cost nullable, same type as the category''s', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S3  fee_or_cost nullable, same type as the category''s', 66) || rpad('FAIL', 14) || '(read 117''s V1)'; END IF;

  -- S4. The check: on budget_lines, allows NULL, and names exactly the two values the category's
  --     check names.
  SELECT count(*) = 1 INTO v_ok
  FROM pg_constraint l, pg_constraint c
  WHERE l.conrelid = 'public.budget_lines'::regclass AND l.conname = 'budget_lines_fee_or_cost_check' AND l.contype = 'c'
    AND c.conrelid = 'public.budget_project_categories'::regclass AND c.conname = 'budget_project_categories_fee_or_cost_check'
    AND pg_get_constraintdef(l.oid) ILIKE '%fee_or_cost IS NULL%'
    AND pg_get_constraintdef(l.oid) LIKE '%''fee''::text%' AND pg_get_constraintdef(l.oid) LIKE '%''cost''::text%'
    AND pg_get_constraintdef(c.oid) LIKE '%''fee''::text%' AND pg_get_constraintdef(c.oid) LIKE '%''cost''::text%';
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S4  check allows NULL, fee, cost (the category''s values)', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S4  check allows NULL, fee, cost (the category''s values)', 66) || rpad('FAIL', 14) || '(read 117''s V2)'; END IF;

  -- S5. Existing rows are not modified: every pre-117 column of every row is byte-identical, and no
  --     row was given a kind.
  v_kind_rows := NULL;
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.budget_lines WHERE fee_or_cost IS NOT NULL' INTO v_kind_rows;
  EXCEPTION WHEN OTHERS THEN v_kind_rows := NULL;
  END;
  v_ok := (v_rows_before IS NOT DISTINCT FROM v_rows_after) AND v_kind_rows = 0;
  v_ok := coalesce(v_ok, false);
  v_detail := format('(rows before %s ; after %s ; rows with a kind %s)', v_rows_before, v_rows_after, coalesce(v_kind_rows::text, 'unreadable'));
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S5  existing lines unchanged, none given a kind', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S5  existing lines unchanged, none given a kind', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S6. 116's trigger and function are unchanged, and the trigger is still there and enabled.
  SELECT count(*) = 1 INTO v_ok
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.budget_lines'::regclass AND NOT t.tgisinternal
    AND t.tgname = 'budget_lines_compute_estimate' AND t.tgenabled = 'O';
  v_ok := coalesce(v_ok, false) AND v_trg_before IS NOT DISTINCT FROM v_trg_after;
  v_detail := format('(before %s ; after %s)', v_trg_before, v_trg_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S6  116 trigger and function unchanged', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S6  116 trigger and function unchanged', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S7. budget_lines still has exactly 103's four policies (belt and braces beside S1).
  SELECT count(*) = 4
         AND bool_and(policyname IN ('budget_lines_org_select', 'budget_lines_org_insert', 'budget_lines_org_update', 'budget_lines_org_delete'))
    INTO v_ok
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'budget_lines';
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S7  budget_lines has exactly the four policies of 103', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S7  budget_lines has exactly the four policies of 103', 66) || rpad('FAIL', 14) || '(read pg_policies for budget_lines)'; END IF;

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
    v_headline := format('DO NOT APPLY 117.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 117.';
    v_headline := format('SAFE TO APPLY 117.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 117 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 117 does what it claims.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 117.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0; NO SUBJECT counts here)\n', v_inconc)
    || format(E'isolation check : %s scenario run(s) compared to the pre-phase fingerprint of budget_lines AND budget_project_categories: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'SUBJECT         : lead org %s, project %s, agency member %s; vendor %s on partnership %s (vendor can read the project row: %s)%s\n',
              v_o1, coalesce(v_p1::text, 'NONE'), coalesce(v_u1::text, 'NONE'), coalesce(v_uv::text, 'NONE'), coalesce(v_ps1::text, 'NONE'),
              v_vendor_sees, CASE WHEN v_fallback THEN ' [FALLBACK: no qualifying partnership, vendor scenarios are NO SUBJECT]' ELSE '' END)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 117\n  phase 2 = AFTER 117\n'
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
