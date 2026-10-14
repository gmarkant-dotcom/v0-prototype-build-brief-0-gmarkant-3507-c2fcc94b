-- =====================================================================
-- 116 PRE-APPLY TEST. ONE PASTE. APPLIES 116, WRITES, READS, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-14 on feat/budget-line-math (unattended run). NOT RUN: THERE IS NO LOCAL
-- POSTGRES AND NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain
-- error, not in "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code below (between $m116$ markers) is 116_budget_line_math.sql,
-- lines 162-280 (the body between BEGIN; and COMMIT;, without the blank first and last lines).
-- If you edit the migration, re-copy it here.
--
-- 103 AND 104 ARE LIVE (applied 2026-10-12). This test does not apply them; it applies only 116,
-- inside its own transaction, between phase 1 and phase 2.
--
-- WHAT 116 MUST SHOW: with a unit rate the stored estimate is round(qty x rate x multiplier, 2),
-- whatever the client sent; clearing the rate keeps the last estimate and makes it typed; the
-- checks refuse quantity 0, a negative multiplier and a bad unit label; an overflowing product is
-- refused with 22003 and a clear message; a line with no math behaves exactly as before; R1 still
-- refuses deleting a computed non-zero line; a vendor reads and writes nothing; anon nothing; no
-- policy and no grant changed; the trigger function is invoker, pinned and executable by nobody.
--
-- PHASES: phase 1 BEFORE 116 (the columns do not exist: every math scenario answers MISSING, every
-- no-math scenario answers what it answers today), phase 2 AFTER 116. EVERY SCENARIO RUNS IN EVERY
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
--     "SAFE TO APPLY 116."       -> and only this.
--     "DO NOT APPLY 116 YET."    -> INCONCLUSIVE or NO SUBJECT. Not a green light.
--     "DO NOT APPLY 116."        -> an assertion FAILED, or the test is broken.
-- Rows read PASS, FAIL, INCONCLUSIVE, NOT DISCRIMINATING (same expectation in both phases, reported
-- as PASS with that note) or NO SUBJECT (reported as INCONCLUSIVE, never PASS).
--
-- THIS FILE DEFINES NO FUNCTION IN pg_temp AND NO TEMP TABLE. Every row it writes is written inside
-- a scenario's own nested block, which ends in LG097 and is undone with it.
--
-- =====================================================================
-- THE SUBJECTS (104's selection)
-- =====================================================================
-- vendor : a member of a partnership's vendor organization who is NOT a member of the lead
--          organization, preferring a partnership with a project assignment on a project of that
--          lead organization and whose partner_id is the vendor (so the vendor CAN read the project
--          row through projects_partner_select_assigned: the strongest case for "reads nothing").
--          The SUBJECT line reports whether the vendor can read the project.
-- o1, p1 : that partnership's lead organization and a project of it, preferring the assigned one.
-- m1     : a member of o1, preferring role owner. The agency actor.
-- anon   : SET LOCAL ROLE anon.
-- If no partnership qualifies, o1/p1/m1 fall back to any organization with a member and a project,
-- and every vendor scenario reports NO SUBJECT (INCONCLUSIVE).
-- Each scenario's SETUP runs as the table owner (no end-user session; it stands in for the trusted
-- path): it inserts one category on p1 and, where needed, one line, with fixed throwaway ids.
-- IT IMPERSONATES AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE authenticated, then
-- auth.uid() is read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097. A fingerprint
-- of every budget_lines and budget_project_categories row is compared after each.
--
-- RESULT CODES: OK:<value> (the scenario's one text value), MISSING (42703: the column does not
-- exist), E:<sqlstate> (refused with that code). E:22003 means the trigger's own message ("too
-- large"); a bare numeric overflow is reported as E:22003(bare) and does not match.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * ALTER TABLE ... ADD COLUMN on budget_lines inside the DO block, after phase 1 has read and
--     written it in rolled-back subtransactions, raises no 55006 "in use" (nothing holds a portal on
--     it; every scenario statement is a completed EXECUTE).
--   * Column resolution (42703) is reported before the privilege check (42501) for anon and the
--     vendor in phase 1; A2's and V3's phase-1 expectations accept either.
--   * RETURNING from a data-modifying CTE shows the row as the BEFORE trigger left it.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 39;
  c_phases       CONSTANT integer := 2;
  v_o1           uuid;
  v_p1           uuid;
  v_u1           uuid;
  v_uv           uuid;
  v_ps1          uuid;
  v_fallback     boolean := false;
  v_vendor_sees  boolean := false;
  v_cat          uuid := gen_random_uuid();
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
  v_math_rows    bigint;
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
  v_rows_sql     CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(concat_ws('|', id, project_id, category_id, name, estimate, archived_at, created_at), E'\n' ORDER BY id), ''))
       FROM public.budget_lines$f$;

  -- Setup fragments. format() arguments everywhere: %1$L p1, %2$L the category, %3$L the line.
  s_cat   CONSTANT text := $s$INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%2$L, %1$L, 'LG116 test category', 'cost');$s$;
  s_plain CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate) VALUES (%3$L, %1$L, %2$L, 'LG116 plain line', 100);$s$;
  s_zero  CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate) VALUES (%3$L, %1$L, %2$L, 'LG116 zero line', 0);$s$;
  s_math  CONSTANT text := $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%3$L, %1$L, %2$L, 'LG116 math line', 0, 4, 25);$s$;

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
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 116 YET.  NO SUBJECT: no organization has both a member and a project. Nothing was tested. This is not a pass.\n=====================================================\n';
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
  sc_id := ARRAY['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12',
                 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'C22', 'C23', 'C24',
                 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'A1', 'A2'];

  sc_label := ARRAY[
    $l$C1  agency: rate only -> estimate = rate$l$,
    $l$C2  agency: qty x rate$l$,
    $l$C3  agency: qty x rate x multiplier$l$,
    $l$C4  agency: rounds to the cent, half away from zero (0.025)$l$,
    $l$C5  agency: rounds a negative half away from zero (-0.025)$l$,
    $l$C6  agency: negative rate (discount line)$l$,
    $l$C7  agency: client estimate overwritten on INSERT$l$,
    $l$C8  agency: client estimate overwritten on UPDATE$l$,
    $l$C9  agency: changing quantity recomputes$l$,
    $l$C10 agency: clearing unit_rate keeps the last estimate$l$,
    $l$C11 agency: after clearing, the estimate is typed again$l$,
    $l$C12 agency: quantity 0 refused$l$,
    $l$C13 agency: negative multiplier refused$l$,
    $l$C14 agency: 25-character unit label refused$l$,
    $l$C15 agency: untrimmed unit label refused$l$,
    $l$C16 agency: empty unit label refused$l$,
    $l$C17 agency: overflowing product refused with 22003$l$,
    $l$C18 agency: the largest total that fits is accepted$l$,
    $l$C19 agency: INSERT with no math stores the typed estimate$l$,
    $l$C20 agency: UPDATE of a no-math line's estimate sticks$l$,
    $l$C21 agency: a no-math line reads NULL math$l$,
    $l$C22 agency: R1 refuses deleting a computed non-zero line$l$,
    $l$C23 agency: R1 deletes a computed line at 0 (rate 0)$l$,
    $l$C24 agency: reads back qty, rate, multiplier, unit$l$,
    $l$V1  vendor: reads no budget line of the project$l$,
    $l$V2  vendor: reads no math column$l$,
    $l$V3  vendor: cannot INSERT a line with math$l$,
    $l$V4  vendor: cannot INSERT a line without math$l$,
    $l$V5  vendor: cannot UPDATE a line's math$l$,
    $l$V6  vendor: cannot DELETE a line at estimate 0$l$,
    $l$A1  anon: reads no budget line$l$,
    $l$A2  anon: cannot INSERT a line with math$l$];

  sc_actor := ARRAY['m1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1',
                    'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1',
                    'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'anon', 'anon'];

  sc_setup := ARRAY[
    s_cat,                                                     -- C1
    s_cat,                                                     -- C2
    s_cat,                                                     -- C3
    s_cat,                                                     -- C4
    s_cat,                                                     -- C5
    s_cat,                                                     -- C6
    s_cat,                                                     -- C7
    s_cat || s_math,                                           -- C8
    s_cat || s_math,                                           -- C9
    s_cat || s_math,                                           -- C10
    s_cat || s_math || $s$UPDATE public.budget_lines SET unit_rate = NULL WHERE id = %3$L;$s$,   -- C11
    s_cat,                                                     -- C12
    s_cat,                                                     -- C13
    s_cat,                                                     -- C14
    s_cat,                                                     -- C15
    s_cat,                                                     -- C16
    s_cat,                                                     -- C17
    s_cat,                                                     -- C18
    s_cat,                                                     -- C19
    s_cat || s_plain,                                          -- C20
    s_cat || s_plain,                                          -- C21
    s_cat || $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%3$L, %1$L, %2$L, 'LG116 R1 line', 0, 2, 50);$s$,   -- C22
    s_cat || $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, unit_rate) VALUES (%3$L, %1$L, %2$L, 'LG116 R1 zero line', 500, 0);$s$,     -- C23
    s_cat || $s$INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate, quantity, unit_rate, multiplier, unit_label) VALUES (%3$L, %1$L, %2$L, 'LG116 read line', 0, 3, 10, 2, 'day');$s$,   -- C24
    s_cat || s_plain,                                          -- V1
    s_cat || s_plain,                                          -- V2
    s_cat,                                                     -- V3
    s_cat,                                                     -- V4
    s_cat || s_plain,                                          -- V5
    s_cat || s_zero,                                           -- V6
    s_cat || s_plain,                                          -- A1
    s_cat];                                                    -- A2

  sc_sql := ARRAY[
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, unit_rate) VALUES (%1$L, %2$L, 'LG116 C1', 0, 250) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%1$L, %2$L, 'LG116 C2', 0, 3, 1250.50) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate, multiplier) VALUES (%1$L, %2$L, 'LG116 C3', 0, 2.5, 1200, 1.5) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate, multiplier) VALUES (%1$L, %2$L, 'LG116 C4', 0, 0.125, 0.20, 1) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%1$L, %2$L, 'LG116 C5', 0, 0.125, -0.20) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate, multiplier) VALUES (%1$L, %2$L, 'LG116 C6', 0, 2, -150, 1.5) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%1$L, %2$L, 'LG116 C7', 999.99, 4, 25) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET estimate = 5 WHERE id = %3$L RETURNING estimate) SELECT coalesce(string_agg(estimate::text, ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET quantity = 6 WHERE id = %3$L RETURNING estimate) SELECT coalesce(string_agg(estimate::text, ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET unit_rate = NULL WHERE id = %3$L RETURNING estimate, unit_rate) SELECT coalesce(string_agg(estimate::text || '|' || coalesce(unit_rate::text, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET estimate = 42 WHERE id = %3$L RETURNING estimate, quantity) SELECT coalesce(string_agg(estimate::text || '|' || coalesce(quantity::text, 'NULL'), ','), 'NONE') FROM u$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%1$L, %2$L, 'LG116 C12', 0, 0, 10) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, unit_rate, multiplier) VALUES (%1$L, %2$L, 'LG116 C13', 0, 10, -1) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, unit_rate, unit_label) VALUES (%1$L, %2$L, 'LG116 C14', 0, 10, 'abcdefghijklmnopqrstuvwxy') RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, unit_rate, unit_label) VALUES (%1$L, %2$L, 'LG116 C15', 0, 10, ' day') RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, unit_rate, unit_label) VALUES (%1$L, %2$L, 'LG116 C16', 0, 10, '') RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%1$L, %2$L, 'LG116 C17', 0, 999999999.999, 999999999999.99) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%1$L, %2$L, 'LG116 C18', 0, 1, -999999999999.99) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%1$L, %2$L, 'LG116 C19', 123.45) RETURNING estimate) SELECT estimate::text FROM i$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET estimate = 77.7 WHERE id = %3$L RETURNING estimate) SELECT coalesce(string_agg(estimate::text, ','), 'NONE') FROM u$q$,
    $q$SELECT coalesce(string_agg(coalesce(quantity::text, 'NULL') || '|' || coalesce(unit_rate::text, 'NULL') || '|' || coalesce(multiplier::text, 'NULL') || '|' || coalesce(unit_label, 'NULL') || '|' || estimate::text, ','), 'NONE') FROM public.budget_lines WHERE id = %3$L$q$,
    $q$WITH d AS (DELETE FROM public.budget_lines WHERE id = %3$L RETURNING 1) SELECT (SELECT count(*) FROM d)::text || '|' || (SELECT count(*) FROM public.budget_lines WHERE id = %3$L)::text$q$,
    $q$WITH d AS (DELETE FROM public.budget_lines WHERE id = %3$L RETURNING 1) SELECT (SELECT count(*) FROM d)::text || '|' || (SELECT count(*) FROM public.budget_lines WHERE id = %3$L)::text$q$,
    $q$SELECT coalesce(string_agg(quantity::text || '|' || unit_rate::text || '|' || multiplier::text || '|' || unit_label || '|' || estimate::text, ','), 'NONE') FROM public.budget_lines WHERE id = %3$L$q$,
    $q$SELECT count(*)::text FROM public.budget_lines WHERE project_id = %1$L$q$,
    $q$SELECT count(*)::text FROM (SELECT quantity, unit_rate, multiplier, unit_label FROM public.budget_lines WHERE id = %3$L) s$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, quantity, unit_rate) VALUES (%1$L, %2$L, 'LG116 V3', 0, 1, 1) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%1$L, %2$L, 'LG116 V4', 1) RETURNING 1) SELECT count(*)::text FROM i$q$,
    $q$WITH u AS (UPDATE public.budget_lines SET quantity = 1, unit_rate = 1 WHERE id = %3$L RETURNING 1) SELECT count(*)::text FROM u$q$,
    $q$WITH d AS (DELETE FROM public.budget_lines WHERE id = %3$L RETURNING 1) SELECT count(*)::text FROM d$q$,
    $q$SELECT count(*)::text FROM public.budget_lines WHERE project_id = %1$L$q$,
    $q$WITH i AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate, unit_rate) VALUES (%1$L, %2$L, 'LG116 A2', 0, 1) RETURNING 1) SELECT count(*)::text FROM i$q$];

  sc_exp := ARRAY[
    'MISSING', 'OK:250.00',                         -- C1
    'MISSING', 'OK:3751.50',                        -- C2
    'MISSING', 'OK:4500.00',                        -- C3
    'MISSING', 'OK:0.03',                           -- C4
    'MISSING', 'OK:-0.03',                          -- C5
    'MISSING', 'OK:-450.00',                        -- C6
    'MISSING', 'OK:100.00',                         -- C7
    'MISSING', 'OK:100.00',                         -- C8
    'MISSING', 'OK:150.00',                         -- C9
    'MISSING', 'OK:100.00|NULL',                    -- C10
    'MISSING', 'OK:42.00|4.000',                    -- C11
    'MISSING', 'E:23514',                           -- C12
    'MISSING', 'E:23514',                           -- C13
    'MISSING', 'E:23514',                           -- C14
    'MISSING', 'E:23514',                           -- C15
    'MISSING', 'E:23514',                           -- C16
    'MISSING', 'E:22003',                           -- C17
    'MISSING', 'OK:-999999999999.99',               -- C18
    'OK:123.45', 'OK:123.45',                       -- C19
    'OK:77.70', 'OK:77.70',                         -- C20
    'MISSING', 'OK:NULL|NULL|NULL|NULL|100.00',     -- C21
    'MISSING', 'OK:0|1',                            -- C22
    'MISSING', 'OK:1|1',                            -- C23
    'MISSING', 'OK:3.000|10.00|2.000|day|60.00',    -- C24
    'OK:0', 'OK:0',                                 -- V1
    'MISSING', 'OK:0',                              -- V2
    'MISSING OR E:42501', 'E:42501',                -- V3
    'E:42501', 'E:42501',                           -- V4
    'MISSING OR OK:0', 'OK:0',                      -- V5
    'OK:0', 'OK:0',                                 -- V6
    'E:42501', 'E:42501',                           -- A1
    'MISSING OR E:42501', 'E:42501'];               -- A2

  v_n := array_length(sc_id, 1);
  IF v_n <> 32 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_setup, 1) <> v_n OR array_length(sc_sql, 1) <> v_n
     OR array_length(sc_exp, 1) <> v_n * c_phases THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length';
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  EXECUTE v_pol_sql  INTO v_pol_before;
  EXECUTE v_acl_sql  INTO v_acl_before;
  EXECUTE v_rows_sql INTO v_rows_before;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 116 is executed between phases.
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
            EXECUTE format(sc_setup[v_i], v_p1, v_cat, v_line);
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

          EXECUTE format(sc_sql[v_i], v_p1, v_cat, v_line) INTO v_txt;
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
              WHEN SQLSTATE = '22003' THEN 'E:22003' || CASE WHEN SQLERRM LIKE '%too large%' THEN '' ELSE '(bare)' END
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
        EXECUTE $m116$
-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_present text;
BEGIN
  IF to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION '116 refuses to apply: public.budget_lines does not exist. Apply 103 first.'
      USING ERRCODE = 'LG116';
  END IF;

  SELECT string_agg(a.attname::text, ', ' ORDER BY a.attname) INTO v_present
  FROM pg_attribute a
  WHERE a.attrelid = 'public.budget_lines'::regclass
    AND a.attname IN ('quantity', 'unit_rate', 'multiplier', 'unit_label')
    AND NOT a.attisdropped;
  IF v_present IS NOT NULL THEN
    RAISE EXCEPTION '116 refuses to apply: budget_lines already has %. Read the schema first; a drifted column must not be skipped silently.', v_present
      USING ERRCODE = 'LG116';
  END IF;

  IF to_regprocedure('public.budget_lines_compute_estimate()') IS NOT NULL THEN
    RAISE EXCEPTION '116 refuses to apply: public.budget_lines_compute_estimate() already exists.'
      USING ERRCODE = 'LG116';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE FOUR COLUMNS. Nullable, no default: nothing is rewritten and every existing row reads
--    NULL in all four, which is "no math", which is today's behaviour.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines ADD COLUMN quantity   numeric(12,3) NULL;
ALTER TABLE public.budget_lines ADD COLUMN unit_rate  numeric(14,2) NULL;
ALTER TABLE public.budget_lines ADD COLUMN multiplier numeric(12,3) NULL;
ALTER TABLE public.budget_lines ADD COLUMN unit_label text          NULL;

COMMENT ON COLUMN public.budget_lines.quantity IS
  'Migration 116. How many units (3 decimals, > 0). NULL counts as 1 when unit_rate is set.';
COMMENT ON COLUMN public.budget_lines.unit_rate IS
  'Migration 116. Money per unit (numeric(14,2), may be negative for a discount line). WHEN SET, '
  'the trigger budget_lines_compute_estimate overwrites estimate with '
  'round(coalesce(quantity,1) * unit_rate * coalesce(multiplier,1), 2). NULL: estimate is typed.';
COMMENT ON COLUMN public.budget_lines.multiplier IS
  'Migration 116. A factor on quantity x rate (3 decimals, > 0), e.g. 1.5 for overtime or a fringe. '
  'NULL counts as 1 when unit_rate is set.';
COMMENT ON COLUMN public.budget_lines.unit_label IS
  'Migration 116. What one unit is ("day", "hour", "shoot day"): trimmed, 1 to 24 characters. '
  'Display only; it changes no number.';


-- ---------------------------------------------------------------------
-- 2. THE CHECKS. Each is written to pass on NULL explicitly.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_quantity_positive
  CHECK (quantity IS NULL OR quantity > 0);

ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_multiplier_positive
  CHECK (multiplier IS NULL OR multiplier > 0);

ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_unit_label_shape
  CHECK (unit_label IS NULL OR (unit_label = btrim(unit_label) AND char_length(unit_label) BETWEEN 1 AND 24));


-- ---------------------------------------------------------------------
-- 3. THE COMPUTED ESTIMATE.
--
-- SECURITY INVOKER on purpose: it reads nothing and writes only NEW, so it needs no privilege of
-- its own. The product is formed in unconstrained numeric, so it cannot overflow before the check;
-- the check is applied AFTER rounding (999999999999.995 rounds to 1000000000000.00, which does not
-- fit). The error names the limit in words instead of leaving the bare "numeric field overflow"
-- the assignment would raise.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.budget_lines_compute_estimate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estimate numeric;
BEGIN
  IF NEW.unit_rate IS NULL THEN
    RETURN NEW;
  END IF;

  v_estimate := round(coalesce(NEW.quantity, 1) * NEW.unit_rate * coalesce(NEW.multiplier, 1), 2);

  IF abs(v_estimate) >= 1000000000000 THEN
    RAISE EXCEPTION 'budget line total % is too large: quantity x rate x multiplier must stay below 1,000,000,000,000.00 either way', v_estimate
      USING ERRCODE = '22003';
  END IF;

  NEW.estimate := v_estimate;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.budget_lines_compute_estimate() IS
  'Migration 116. BEFORE INSERT OR UPDATE on budget_lines. When unit_rate is set, estimate := '
  'round(coalesce(quantity,1) * unit_rate * coalesce(multiplier,1), 2), overwriting the client''s '
  'value; 22003 if that does not fit numeric(14,2). When unit_rate is NULL the row is untouched.';

CREATE TRIGGER budget_lines_compute_estimate
  BEFORE INSERT OR UPDATE ON public.budget_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.budget_lines_compute_estimate();

REVOKE EXECUTE ON FUNCTION public.budget_lines_compute_estimate() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.budget_lines_compute_estimate() FROM anon;
REVOKE EXECUTE ON FUNCTION public.budget_lines_compute_estimate() FROM authenticated;

-- PostgREST must see the columns at commit.
NOTIFY pgrst, 'reload schema';
        $m116$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('116 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
    END IF;
  END LOOP;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  EXECUTE v_pol_sql  INTO v_pol_after;
  EXECUTE v_acl_sql  INTO v_acl_after;
  EXECUTE v_rows_sql INTO v_rows_after;

  ---------------------------------------------------------------------
  -- JUDGEMENT, exactly 115's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
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

  -- S1. No policy anywhere in public changed (116 adds none and touches none; R1 included).
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

  -- S3. The four columns exist, nullable, with exactly the ruled types.
  SELECT count(*) = 4 INTO v_ok
  FROM pg_attribute a
  WHERE a.attrelid = 'public.budget_lines'::regclass AND NOT a.attisdropped AND NOT a.attnotnull
    AND ((a.attname = 'quantity'   AND format_type(a.atttypid, a.atttypmod) = 'numeric(12,3)')
      OR (a.attname = 'unit_rate'  AND format_type(a.atttypid, a.atttypmod) = 'numeric(14,2)')
      OR (a.attname = 'multiplier' AND format_type(a.atttypid, a.atttypmod) = 'numeric(12,3)')
      OR (a.attname = 'unit_label' AND format_type(a.atttypid, a.atttypmod) = 'text'));
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S3  four nullable columns with the ruled types', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S3  four nullable columns with the ruled types', 66) || rpad('FAIL', 14) || '(read 116''s V1)'; END IF;

  -- S4. The trigger function: INVOKER, search_path pinned, no PUBLIC entry, anon and
  --     authenticated cannot execute it.
  -- has_function_privilege() raises 42883 on a missing function, so it is only asked when the
  -- function exists (a failed apply is reported by M, not by a crash here).
  v_ok := false;
  IF to_regprocedure('public.budget_lines_compute_estimate()') IS NOT NULL THEN
    SELECT NOT p.prosecdef
           AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
           AND p.proacl IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      INTO v_ok
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.budget_lines_compute_estimate()');
    v_ok := coalesce(v_ok, false)
            AND NOT has_function_privilege('anon', 'public.budget_lines_compute_estimate()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.budget_lines_compute_estimate()', 'EXECUTE');
  END IF;
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S4  function invoker, pinned, not executable by anon/auth', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S4  function invoker, pinned, not executable by anon/auth', 66) || rpad('FAIL', 14) || '(read 116''s V3)'; END IF;

  -- S5. The trigger: one, on budget_lines, BEFORE, ROW, INSERT and UPDATE, enabled, calling it.
  SELECT count(*) = 1 INTO v_ok
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.budget_lines'::regclass AND NOT t.tgisinternal
    AND t.tgname = 'budget_lines_compute_estimate'
    AND t.tgfoid = to_regprocedure('public.budget_lines_compute_estimate()')
    AND t.tgenabled = 'O'
    AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16
    AND (t.tgtype & 8) = 0;
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S5  trigger BEFORE INSERT OR UPDATE, row level, enabled', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S5  trigger BEFORE INSERT OR UPDATE, row level, enabled', 66) || rpad('FAIL', 14) || '(read 116''s V2)'; END IF;

  -- S6. Existing rows are not modified: the original columns of every row are byte-identical,
  --     and no row carries math.
  v_math_rows := NULL;
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.budget_lines WHERE quantity IS NOT NULL OR unit_rate IS NOT NULL OR multiplier IS NOT NULL OR unit_label IS NOT NULL'
      INTO v_math_rows;
  EXCEPTION WHEN OTHERS THEN v_math_rows := NULL;
  END;
  v_ok := (v_rows_before IS NOT DISTINCT FROM v_rows_after) AND v_math_rows = 0;
  v_ok := coalesce(v_ok, false);
  v_detail := format('(rows before %s ; after %s ; rows with math %s)', v_rows_before, v_rows_after, coalesce(v_math_rows::text, 'unreadable'));
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S6  existing lines unchanged, none given math', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S6  existing lines unchanged, none given math', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S7. R1's policy is still the one 103 created (belt and braces beside S1).
  SELECT count(*) = 1 INTO v_ok
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'budget_lines' AND policyname = 'budget_lines_org_delete'
    AND cmd = 'DELETE' AND roles = ARRAY['authenticated']::name[]
    AND qual ILIKE '%estimate IS NULL%' AND qual ILIKE '%current_user_org_ids%';
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S7  R1 delete policy present and unchanged in shape', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S7  R1 delete policy present and unchanged in shape', 66) || rpad('FAIL', 14) || '(read pg_policies for budget_lines)'; END IF;

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
    v_headline := format('DO NOT APPLY 116.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 116.';
    v_headline := format('SAFE TO APPLY 116.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 116 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 116 does what it claims.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 116.  %s assertion(s) FAILED.', v_fail);
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
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 116\n  phase 2 = AFTER 116\n'
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
