-- =====================================================================
-- 103 PRE-APPLY TEST. ONE PASTE. APPLIES 103, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-08 on feat/client-required-and-spine. PARSE-CHECKED ONLY.
-- NOT RUN. GENERATED FROM 103_budget_core.sql: the DDL this file applies is the
-- migration's own, statement by statement, so the two cannot drift.
--
-- WHY THIS FILE EXISTS. 103 creates money tables and the only thing keeping a
-- vendor out of them is the ABSENCE of a policy. A policy that admits too
-- much, or a table created without row level security, raises nothing at
-- apply time. This file writes first, inside a transaction that rolls back.
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
-- The DO block finishes with RAISE EXCEPTION carrying the whole report. It
-- defines NO function in pg_temp and creates NO temp table: the SQL Editor
-- answers 3F000 to both, which is why migration 101's test could never run.
-- Everything is inline.
--
-- READ THE FIRST LINE:
--     "SAFE TO APPLY 103."       -> and only this.
--     "DO NOT APPLY 103 YET."    -> INCONCLUSIVE (a missing subject, a test
--                                   fault, a non-discriminating control).
--                                   Not a green light.
--     "DO NOT APPLY 103."        -> a scenario FAILED, or the test is broken.
--
-- THE SQL EDITOR MAY ASK YOU TO CONFIRM. Nothing here is an UPDATE or DELETE
-- without a WHERE, but the editor may warn on that text inside a DO block.
-- Confirm: it is inside a rolled-back transaction.
--
-- =====================================================================
-- WHAT IT PROVES
-- =====================================================================
--   * an agency member READS AND WRITES their own budget, and so does a colleague
--   * an agency member CANNOT READ, INSERT, UPDATE, DELETE or MOVE ROWS INTO
--     another agency's budget (and the other agency cannot reach the first's)
--   * A VENDOR SESSION CANNOT READ ANY ROW IN ANY OF THE FOUR TABLES, cannot
--     write any, and still cannot when the vendor can read the project row
--   * the per-project chart is a COPY: editing or deleting the template changes
--     no project category, and editing the project copy changes no template row
--   * merge history cannot be rewritten, a category cannot be merged into
--     itself, across projects, twice, or into something already merged away
--   * nothing with money against it can be deleted silently
--   * the fee-or-cost flag is mandatory and constrained
--   * 103 changed no pre-existing policy
--
-- =====================================================================
-- IT IMPERSONATES, AND PROVES IT DID
-- =====================================================================
-- Each scenario sets request.jwt.claims and request.jwt.claim.sub, then SET
-- LOCAL ROLE authenticated, then READS auth.uid() BACK and raises LG098 if it
-- is not the intended user. LG098 is reported as INCONCLUSIVE with the words
-- TEST FAULT, never as a pass. The owner state (auth.uid() NULL) is checked
-- before every seed.
--
-- A ZERO IS ONLY EVIDENCE IF THE ROW IS THERE. Every "cannot read" and "cannot
-- write" scenario is run twice: as the OWNER (which bypasses row level
-- security and must see / do it) and as the ACTOR. If the owner cannot, the
-- verdict is INCONCLUSIVE, "NOT DISCRIMINATING", never PASS.
--
-- ISOLATION. Every scenario runs in its own nested BEGIN ... EXCEPTION block
-- and ends in RAISE EXCEPTION ... ERRCODE 'LG097', which that block's own
-- handler swallows, undoing the seed, the setup, the attempted write, the role
-- switch and the claims. A fingerprint of the four tables is recomputed after
-- EACH scenario; any difference ends the run with "THE TEST ITSELF IS BROKEN".
--
-- SUBJECTS. Chosen from live data, read-only apart from the rolled-back seed:
--   * an organization with a project, a member, and a partnership whose vendor
--     organization has a member who does NOT belong to it (the vendor),
--     preferring a project the vendor is assigned to so the vendor CAN read the
--     project row (VI1 reports whether that held);
--   * a second member of the same organization (the colleague), if any;
--   * a second organization with a project and a member (the other agency).
-- A SUBJECT THAT CANNOT BE FOUND IS REPORTED AS NO SUBJECT, NEVER PASSED.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled from the PostgreSQL documentation,
-- not executed):
--   * EXECUTE of each migration statement inside the DO block, then use of the
--     new tables in the same transaction, is accepted. Each statement is its
--     own EXECUTE; no multi-statement string is used.
--   * Row level security WITH CHECK is evaluated before NOT NULL / CHECK
--     constraints, so an insert into another organization raises 42501 and an
--     insert into your own with a bad flag raises 23514 / 23502.
--   * A NO ACTION foreign key fails at the end of the statement with 23503,
--     inside the EXECUTE, so it is catchable per scenario.
--   * The default ACL grants a table created here to authenticated (S4
--     measures it rather than assuming it).
--
-- THE NUMBER OF ASSERTIONS is c_expected below (75 = 65 scenarios + 10
-- structural). Change it with the scenario list.
-- =====================================================================

BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 75;
  v_ids          text[];
  v_actor_keys   text[]  := ARRAY[]::text[];
  v_actor_uids   uuid[]  := ARRAY[]::uuid[];
  v_have         jsonb   := '{}'::jsonb;
  v_uid          uuid;
  v_val          integer;
  v_actor        text;
  v_i            integer;
  v_ph           integer;
  v_idx          integer;
  v_n            integer;
  v_s            integer;
  v_k            text;
  v_stmt         text;
  v_missing      text;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_present      boolean;
  v_partial      boolean;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_ran          integer := 0;
  v_logged       integer := 0;
  v_lines        text := '';
  v_ba           text := '';
  v_info         text := '';
  v_headline     text;
  v_verdict_text text;
  v_report       text;
  v_ok           boolean;
  v_detail       text;
  v_verdict      text;
  v_note         text;
  v_exp          text;
  v_expn         integer;
  v_tc           text;
  v_ac           text;
  v_twin_ok      boolean;
  v_o1 uuid; v_p1 uuid; v_o2 uuid; v_p2 uuid;
  v_u1 uuid; v_u1b uuid; v_u2 uuid; v_uv uuid; v_ov uuid;
  v_a integer; v_b integer; v_c integer; v_d integer; v_t text;
  v_tables text[] := ARRAY['budget_template_categories', 'budget_project_categories', 'budget_lines', 'budget_category_merges'];
  v_pol_before text; v_pol_after text; v_pol_cnt_before integer;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_need   text[];
  sc_setup  text[];
  sc_sql    text[];
  sc_chk    text[];
  sc_expect text[];
  sc_twin   boolean[];
  seed_sql  text[];
  seed_need text[];
  r_cls     text[];
  r_val     integer[];
BEGIN
  ---------------------------------------------------------------------
  -- SUBJECT. NO SUBJECT IS REPORTED, NEVER PASSED.
  ---------------------------------------------------------------------
  -- The vendor-side organization first: an organization with a project, a member,
  -- and a partnership whose vendor organization has a member who is NOT in it.
  SELECT pr.org_id, pr.id
    INTO v_o1, v_p1
  FROM public.projects pr
  WHERE EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = pr.org_id)
    AND EXISTS (
      SELECT 1 FROM public.partnerships ps
      JOIN public.org_members vm ON vm.org_id = ps.vendor_org_id
      WHERE ps.lead_org_id = pr.org_id
        AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = vm.user_id AND x.org_id = pr.org_id)
    )
  ORDER BY ((SELECT count(*) FROM public.org_members m2 WHERE m2.org_id = pr.org_id) >= 2) DESC,
           (EXISTS (
              SELECT 1 FROM public.project_assignments pa
              JOIN public.partnerships ps2 ON ps2.id = pa.partnership_id
              WHERE pa.project_id = pr.id AND ps2.vendor_org_id IS NOT NULL)) DESC,
           pr.id
  LIMIT 1;

  IF v_o1 IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 103 YET.  NO SUBJECT: no organization has a project, a member and a partnership whose vendor organization has a member outside it. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  SELECT m.user_id INTO v_u1
  FROM public.org_members m WHERE m.org_id = v_o1
  ORDER BY (m.role = 'owner') DESC, m.user_id LIMIT 1;

  SELECT m.user_id INTO v_u1b
  FROM public.org_members m WHERE m.org_id = v_o1 AND m.user_id <> v_u1
  ORDER BY m.user_id LIMIT 1;

  -- The vendor: prefer one whose partnership has an assignment on v_p1, so the vendor can READ the
  -- project row and the boundary under test is the budget tables and not the project.
  SELECT vm.user_id, ps.vendor_org_id
    INTO v_uv, v_ov
  FROM public.partnerships ps
  JOIN public.org_members vm ON vm.org_id = ps.vendor_org_id
  WHERE ps.lead_org_id = v_o1
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = vm.user_id AND x.org_id = v_o1)
  ORDER BY (EXISTS (SELECT 1 FROM public.project_assignments pa WHERE pa.project_id = v_p1 AND pa.partnership_id = ps.id)) DESC,
           vm.user_id
  LIMIT 1;

  -- The other agency: a different organization with a project and a member, and neither the
  -- agency member nor the vendor belongs to it.
  SELECT pr.org_id, pr.id
    INTO v_o2, v_p2
  FROM public.projects pr
  WHERE pr.org_id <> v_o1
    AND EXISTS (SELECT 1 FROM public.org_members m
                WHERE m.org_id = pr.org_id AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_o1))
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.org_id = pr.org_id AND x.user_id IN (v_u1, v_uv))
  ORDER BY pr.id
  LIMIT 1;

  IF v_o2 IS NOT NULL THEN
    SELECT m.user_id INTO v_u2
    FROM public.org_members m
    WHERE m.org_id = v_o2 AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_o1)
    ORDER BY m.user_id LIMIT 1;
  END IF;

  v_ids := ARRAY[v_o1::text, v_p1::text, v_o2::text, v_p2::text,
                 gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                 gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                 gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text];
  v_actor_keys := ARRAY['m1', 'm1b', 'm2', 'vendor'];
  v_actor_uids := ARRAY[v_u1, v_u1b, v_u2, v_uv];
  v_have := jsonb_build_object('m1', v_u1 IS NOT NULL, 'm1b', v_u1b IS NOT NULL,
                               'm2', v_u2 IS NOT NULL AND v_o2 IS NOT NULL,
                               'vendor', v_uv IS NOT NULL, 'o2', v_o2 IS NOT NULL);

  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  ---------------------------------------------------------------------
  -- THE SCENARIOS. Parallel arrays; position i describes scenario i.
  -- sc_sql returns ONE integer. %N$L placeholders are the subject and
  -- seed ids (v_ids). sc_expect: N:k exact, G:k at least, E:code an
  -- error with that SQLSTATE, I informational (not counted).
  -- sc_twin: also run it as the OWNER first; an expected zero or an
  -- expected 42501 is only evidence if the owner can see / write the row.
  ---------------------------------------------------------------------
  sc_id := ARRAY['K1', 'K2', 'K3', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X11', 'X12', 'X13', 'X14', 'X15', 'X16', 'VK1', 'VI1', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'CP1', 'CP2', 'CP3', 'CP4', 'MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9', 'MG10', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
  sc_label := ARRAY[
    $q$K1 control: owner sees both seeded lines$q$,
    $q$K2 control: owner sees all five categories$q$,
    $q$K3 control: owner sees both template rows$q$,
    $q$A1  member reads own line$q$,
    $q$A2  member reads own template category$q$,
    $q$A3  member reads own project categories$q$,
    $q$A4  member inserts a template category$q$,
    $q$A5  member updates own template category$q$,
    $q$A6  member deletes own template category$q$,
    $q$A7  member inserts a project category$q$,
    $q$A8  member inserts a budget line$q$,
    $q$A9  member updates a line's estimate$q$,
    $q$A10 member deletes own line$q$,
    $q$A11 member records a merge$q$,
    $q$A12 member reads a merge record$q$,
    $q$A13 colleague reads the member's line$q$,
    $q$A14 colleague inserts a line$q$,
    $q$X1  other agency's line: read$q$,
    $q$X2  other agency's template: read$q$,
    $q$X3  other agency's categories: read$q$,
    $q$X4  other agency's merge record: read$q$,
    $q$X5  insert a template row for the other org$q$,
    $q$X6  insert a category on the other project$q$,
    $q$X7  insert a line on the other project$q$,
    $q$X8  insert a merge on the other project$q$,
    $q$X9  other agency's line: update$q$,
    $q$X10 other agency's line: delete$q$,
    $q$X11 other agency's template: update$q$,
    $q$X12 other agency's template: delete$q$,
    $q$X13 move own template row to the other org$q$,
    $q$X14 move own category to the other project$q$,
    $q$X15 control: the other agency reads its own line$q$,
    $q$X16 the other agency cannot read the first's line$q$,
    $q$VK1 control: the vendor session sees its own partnership$q$,
    $q$VI1 info: vendor can read the project row (assigned)$q$,
    $q$V1  vendor reads a budget line$q$,
    $q$V2  vendor reads a template category$q$,
    $q$V3  vendor reads project categories$q$,
    $q$V4  vendor reads a merge record$q$,
    $q$V5  vendor inserts a line on the project$q$,
    $q$V6  vendor inserts a template row for the agency$q$,
    $q$V7  vendor inserts a category on the project$q$,
    $q$V8  vendor inserts a merge on the project$q$,
    $q$V9  vendor updates a line$q$,
    $q$V10 vendor deletes a line$q$,
    $q$V11 vendor reads every seeded line at once$q$,
    $q$CP1 copy template to project (INSERT ... SELECT)$q$,
    $q$CP2 editing the template leaves the project copy$q$,
    $q$CP3 deleting the template row leaves the copy$q$,
    $q$CP4 editing the project copy leaves the template$q$,
    $q$MG1 merge a category into itself$q$,
    $q$MG2 merge into another project's category$q$,
    $q$MG3 merge INTO a category already merged away$q$,
    $q$MG4 merge the same category away twice$q$,
    $q$MG5 member rewrites a merge record$q$,
    $q$MG6 member deletes a merge record$q$,
    $q$MG7 delete a category a merge record names$q$,
    $q$MG8 delete a category that has a line$q$,
    $q$MG9 file a line under another project's category$q$,
    $q$MG10 a chain A to B to C is allowed$q$,
    $q$F1  template category with an unknown flag$q$,
    $q$F2  project category with an unknown flag$q$,
    $q$F3  template category with no flag$q$,
    $q$F4  project category with no flag$q$,
    $q$F5  category with a blank name$q$,
    $q$F6  line with no estimate$q$];
  sc_actor := ARRAY['owner', 'owner', 'owner', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1b', 'm1b', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm2', 'm2', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1'];
  sc_need := ARRAY['o2', 'o2', 'o2', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1b', 'm1b', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm2,o2', 'm2,o2', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor,o2', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1,o2', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1,o2', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1'];
  sc_setup := ARRAY[
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %4$L, %10$L, %11$L)$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%15$L, %2$L, 'T-ORIG', 'cost')$q$,
    $q$INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%15$L, %2$L, 'T-ORIG', 'cost')$q$,
    $q$INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%15$L, %2$L, 'T-ORIG', 'cost')$q$,
    $q$$q$,
    $q$$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$$q$,
    $q$$q$,
    $q$INSERT INTO public.budget_category_merges (id, project_id, from_category_id, into_category_id) VALUES (%14$L, %2$L, %7$L, %8$L)$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$];
  sc_sql := ARRAY[
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id IN (%12$L, %13$L)$q$,
    $q$SELECT count(*)::int FROM public.budget_project_categories WHERE id IN (%7$L, %8$L, %9$L, %10$L, %11$L)$q$,
    $q$SELECT count(*)::int FROM public.budget_template_categories WHERE id IN (%5$L, %6$L)$q$,
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id = %12$L$q$,
    $q$SELECT count(*)::int FROM public.budget_template_categories WHERE id = %5$L$q$,
    $q$SELECT count(*)::int FROM public.budget_project_categories WHERE id IN (%7$L, %8$L, %9$L)$q$,
    $q$WITH x AS (INSERT INTO public.budget_template_categories (org_id, name, fee_or_cost) VALUES (%1$L, 'new-template', 'fee') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_template_categories SET name = 'A5-renamed' WHERE id = %5$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_template_categories WHERE id = %5$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_project_categories (project_id, name, fee_or_cost) VALUES (%2$L, 'new-category', 'cost') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%2$L, %7$L, 'new-line', 50.00) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_lines SET estimate = 125.50 WHERE id = %12$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_lines WHERE id = %12$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%2$L, %7$L, %8$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$SELECT count(*)::int FROM public.budget_category_merges WHERE id = %14$L$q$,
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id = %12$L$q$,
    $q$WITH x AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%2$L, %7$L, 'colleague-line', 50.00) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.budget_template_categories WHERE id = %6$L$q$,
    $q$SELECT count(*)::int FROM public.budget_project_categories WHERE id IN (%10$L, %11$L)$q$,
    $q$SELECT count(*)::int FROM public.budget_category_merges WHERE id = %14$L$q$,
    $q$WITH x AS (INSERT INTO public.budget_template_categories (org_id, name, fee_or_cost) VALUES (%3$L, 'new-template', 'fee') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_project_categories (project_id, name, fee_or_cost) VALUES (%4$L, 'new-category', 'cost') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%4$L, %10$L, 'new-line', 50.00) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%4$L, %10$L, %11$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_lines SET estimate = 1 WHERE id = %13$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_lines WHERE id = %13$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_template_categories SET name = 'hijack' WHERE id = %6$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_template_categories WHERE id = %6$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_template_categories SET org_id = %3$L WHERE id = %5$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_project_categories SET project_id = %4$L WHERE id = %9$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id = %12$L$q$,
    $q$SELECT count(*)::int FROM public.partnerships WHERE vendor_org_id IN (SELECT public.current_user_org_ids())$q$,
    $q$SELECT count(*)::int FROM public.projects WHERE id = %2$L$q$,
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id = %12$L$q$,
    $q$SELECT count(*)::int FROM public.budget_template_categories WHERE id = %5$L$q$,
    $q$SELECT count(*)::int FROM public.budget_project_categories WHERE id IN (%7$L, %8$L, %9$L)$q$,
    $q$SELECT count(*)::int FROM public.budget_category_merges WHERE id = %14$L$q$,
    $q$WITH x AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%2$L, %7$L, 'vendor-line', 50.00) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_template_categories (org_id, name, fee_or_cost) VALUES (%1$L, 'new-template', 'fee') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_project_categories (project_id, name, fee_or_cost) VALUES (%2$L, 'new-category', 'cost') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%2$L, %7$L, %8$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_lines SET estimate = 1 WHERE id = %12$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_lines WHERE id = %12$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$SELECT count(*)::int FROM public.budget_lines WHERE id IN (%12$L, %13$L)$q$,
    $q$WITH x AS (INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) SELECT %15$L::uuid, %2$L::uuid, t.name, t.fee_or_cost FROM public.budget_template_categories t WHERE t.id = %5$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_template_categories SET name = 'T-EDITED', fee_or_cost = 'fee' WHERE id = %5$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_template_categories WHERE id = %5$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_project_categories SET name = 'C-EDITED', fee_or_cost = 'fee' WHERE id = %15$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%2$L, %7$L, %7$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%2$L, %7$L, %10$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%2$L, %8$L, %7$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%2$L, %7$L, %9$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.budget_category_merges SET into_category_id = %9$L WHERE id = %14$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_category_merges WHERE id = %14$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_project_categories WHERE id = %8$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.budget_project_categories WHERE id = %7$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_lines (project_id, category_id, name, estimate) VALUES (%2$L, %10$L, 'new-line', 50.00) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_category_merges (project_id, from_category_id, into_category_id) VALUES (%2$L, %8$L, %9$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_template_categories (org_id, name, fee_or_cost) VALUES (%1$L, 'new-template', 'margin') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_project_categories (project_id, name, fee_or_cost) VALUES (%2$L, 'new-category', 'margin') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_template_categories (org_id, name) VALUES (%1$L, 'no-flag') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_project_categories (project_id, name) VALUES (%2$L, 'no-flag') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_project_categories (project_id, name, fee_or_cost) VALUES (%2$L, '  ', 'cost') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.budget_lines (project_id, category_id, name) VALUES (%2$L, %7$L, 'no-estimate') RETURNING 1) SELECT count(*)::int FROM x$q$];
  sc_chk := ARRAY[
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$SELECT count(*)::int FROM public.budget_project_categories WHERE id = %15$L AND name = 'T-ORIG' AND fee_or_cost = 'cost'$q$,
    $q$SELECT count(*)::int FROM public.budget_project_categories WHERE id = %15$L AND name = 'T-ORIG' AND fee_or_cost = 'cost'$q$,
    $q$SELECT count(*)::int FROM public.budget_template_categories WHERE id = %5$L AND name = 'T-ORIG' AND fee_or_cost = 'cost'$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$];
  sc_expect := ARRAY['N:2', 'N:5', 'N:2', 'N:1', 'N:1', 'N:3', 'N:1', 'N:1', 'N:1', 'N:1', 'N:1', 'N:1', 'N:1', 'N:1', 'N:1', 'N:1', 'N:1', 'N:0', 'N:0', 'N:0', 'N:0', 'E:42501', 'E:42501', 'E:42501', 'E:42501', 'N:0', 'N:0', 'N:0', 'N:0', 'E:42501', 'E:42501', 'N:1', 'N:0', 'G:1', 'I', 'N:0', 'N:0', 'N:0', 'N:0', 'E:42501', 'E:42501', 'E:42501', 'E:42501', 'N:0', 'N:0', 'N:0', 'N:1', 'N:1', 'N:1', 'N:1', 'E:23514', 'E:23503', 'E:23514', 'E:23505', 'N:0', 'N:0', 'E:23503', 'E:23503', 'E:23503', 'N:1', 'E:23514', 'E:23514', 'E:23502', 'E:23502', 'E:23514', 'E:23502'];
  sc_twin := ARRAY[false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, true, false, false, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false, false, false, true, true, false, false, false, false, false, false, false, false, false, false]::boolean[];
  seed_sql := ARRAY[
    $q$INSERT INTO public.budget_template_categories (id, org_id, name, fee_or_cost) VALUES (%5$L, %1$L, 'T-ORIG', 'cost')~|~INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%7$L, %2$L, 'C1', 'cost'), (%8$L, %2$L, 'C2', 'fee'), (%9$L, %2$L, 'C3', 'cost')~|~INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate) VALUES (%12$L, %2$L, %7$L, 'L1', 100.00)$q$,
    $q$INSERT INTO public.budget_template_categories (id, org_id, name, fee_or_cost) VALUES (%6$L, %3$L, 'TX-ORIG', 'cost')~|~INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%10$L, %4$L, 'CX', 'cost'), (%11$L, %4$L, 'CX2', 'fee')~|~INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate) VALUES (%13$L, %4$L, %10$L, 'LX', 200.00)$q$];
  seed_need := ARRAY['', 'o2'];

  v_n := array_length(sc_id, 1);
  IF v_n <> 66 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_need, 1) <> v_n OR array_length(sc_setup, 1) <> v_n
     OR array_length(sc_sql, 1) <> v_n OR array_length(sc_chk, 1) <> v_n
     OR array_length(sc_expect, 1) <> v_n OR array_length(sc_twin, 1) <> v_n THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (id %, label %, actor %, need %, setup %, sql %, chk %, expect %, twin %)',
      array_length(sc_id, 1), array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_need, 1),
      array_length(sc_setup, 1), array_length(sc_sql, 1), array_length(sc_chk, 1), array_length(sc_expect, 1),
      array_length(sc_twin, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[2 * v_n]);
  r_val := array_fill(NULL::integer,   ARRAY[2 * v_n]);

  ---------------------------------------------------------------------
  -- STATE BEFORE ANYTHING IS APPLIED.
  ---------------------------------------------------------------------
  SELECT count(*) INTO v_a FROM unnest(v_tables) AS t WHERE to_regclass('public.' || t) IS NOT NULL;
  v_present := (v_a = 4);
  v_partial := (v_a BETWEEN 1 AND 3);

  SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY tablename, policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND NOT (tablename = ANY (v_tables));
  SELECT count(*) INTO v_pol_cnt_before FROM pg_policies WHERE schemaname = 'public';

  IF v_partial THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 103 YET.  PARTIAL STATE: some but not all of the 103 objects already exist. Nothing was tested. Find out why before anything is applied.\n=====================================================\n';
  END IF;

  IF NOT v_present THEN
    -- 103 ITSELF, statement by statement, TAKEN FROM THE MIGRATION FILE BY A SCRIPT. The
    -- migration's own fail-closed pre-flight DO block is not repeated: the checks above report
    -- the same facts instead of raising.
        EXECUTE $t103_00$CREATE TABLE public.budget_template_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  fee_or_cost text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_template_categories_name_present
    CHECK (btrim(name) <> ''),
  CONSTRAINT budget_template_categories_fee_or_cost_check
    CHECK (fee_or_cost IN ('fee', 'cost'))
)$t103_00$;

        EXECUTE $t103_01$COMMENT ON TABLE public.budget_template_categories IS
  'An agency''s house-standard chart of accounts: the categories every new project''s chart is '
  'COPIED from (ruling 2f). Copy-on-create, not a pointer: budget_project_categories carries no '
  'reference to a row here, so editing or deleting a template category changes no project. '
  'Agency-scoped; no vendor policy exists or may be added (ruling 2e).'$t103_01$;

        EXECUTE $t103_02$COMMENT ON COLUMN public.budget_template_categories.fee_or_cost IS
  'fee or cost (ruling 2b). NOT NULL with no default on purpose: margin is only computable '
  'because every category carries this flag, and a default would misclassify silently. '
  'A fee is what the agency earns; a cost is what it passes through or spends.'$t103_02$;

        EXECUTE $t103_03$CREATE INDEX budget_template_categories_org_idx
  ON public.budget_template_categories (org_id)$t103_03$;

        EXECUTE $t103_04$CREATE TABLE public.budget_project_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  fee_or_cost text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_project_categories_project_id_id_key
    UNIQUE (project_id, id),
  CONSTRAINT budget_project_categories_name_present
    CHECK (btrim(name) <> ''),
  CONSTRAINT budget_project_categories_fee_or_cost_check
    CHECK (fee_or_cost IN ('fee', 'cost'))
)$t103_04$;

        EXECUTE $t103_05$COMMENT ON TABLE public.budget_project_categories IS
  'A project''s chart of accounts, created as a COPY of the agency template and then owned by '
  'the project (ruling 2f). It starts equal to the template and diverges freely; nothing here '
  'points back at a template row. A category that has been merged away is NEVER deleted: it is '
  'named by a budget_category_merges row, which is what makes a ledger entry''s original '
  'category resolvable after the merge. Categories may be added at any time.'$t103_05$;

        EXECUTE $t103_06$CREATE TABLE public.budget_lines (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid          NOT NULL REFERENCES public.projects(id),
  category_id uuid          NOT NULL,
  name        text          NOT NULL,
  estimate    numeric(14,2) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_lines_category_fkey
    FOREIGN KEY (project_id, category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT budget_lines_name_present
    CHECK (btrim(name) <> '')
)$t103_06$;

        EXECUTE $t103_07$COMMENT ON TABLE public.budget_lines IS
  'The master budget, one row per line, belonging to a PROJECT. The master budget is the working '
  'artifact the agency owns (ruling 2a), never a mirror of a spreadsheet. Agency-scoped; NO '
  'vendor policy exists or may be added: a vendor never sees the master budget (ruling 2e), and '
  'what a vendor sees travels in the RFP payload, which is a released artifact distinct from '
  'this row. THIS TABLE HOLDS THE ESTIMATE ONLY. Committed, Actual and Paid (ruling 2c) are not '
  'columns: each has a source elsewhere (awards and purchase orders, the ledger, payments) and '
  'whether they are stored or derived is open question 2 in docs/ligament-00-budgeting-spec.md. '
  'Nothing here links to an RFP, a bid or an award: that join is open question 4.'$t103_07$;

        EXECUTE $t103_08$COMMENT ON COLUMN public.budget_lines.estimate IS
  'What the line was budgeted at (ruling 2c, state one of four). numeric(14,2), the precision '
  'scripts/037-client-cash-flow.sql uses for money. NOT NULL with no default, and not constrained '
  'to be non-negative: a discount line is a real budget line. The currency is NOT recorded; see '
  'the report.'$t103_08$;

        EXECUTE $t103_09$CREATE INDEX budget_lines_project_category_idx
  ON public.budget_lines (project_id, category_id)$t103_09$;

        EXECUTE $t103_10$CREATE TABLE public.budget_category_merges (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_category_id uuid        NOT NULL,
  into_category_id uuid        NOT NULL,
  merged_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_category_merges_from_fkey
    FOREIGN KEY (project_id, from_category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT budget_category_merges_into_fkey
    FOREIGN KEY (project_id, into_category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT budget_category_merges_not_self
    CHECK (from_category_id <> into_category_id),
  CONSTRAINT budget_category_merges_from_once
    UNIQUE (from_category_id)
)$t103_10$;

        EXECUTE $t103_11$COMMENT ON TABLE public.budget_category_merges IS
  'Append-only record that one category of a project was merged into another (ruling 2f). The '
  'merged-away category row is kept so a ledger entry''s original category still resolves. No '
  'UPDATE and no DELETE policy exists, so history cannot be rewritten by an agency member. A '
  'category appears as from_category_id at most once and never as an into_category_id once it '
  'has been merged away (budget_category_merges_guard), so the chain has no cycle.'$t103_11$;

        EXECUTE $t103_12$CREATE INDEX budget_category_merges_into_idx
  ON public.budget_category_merges (into_category_id)$t103_12$;

        EXECUTE $t103_13$CREATE INDEX budget_category_merges_project_idx
  ON public.budget_category_merges (project_id)$t103_13$;

        EXECUTE $t103_14$CREATE FUNCTION public.budget_category_merges_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text, 103));

  IF EXISTS (
    SELECT 1 FROM public.budget_category_merges m
    WHERE m.from_category_id = NEW.into_category_id
  ) THEN
    RAISE EXCEPTION 'category % has itself been merged away and cannot receive a merge', NEW.into_category_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$$t103_14$;

        EXECUTE $t103_15$CREATE TRIGGER budget_category_merges_guard
  BEFORE INSERT ON public.budget_category_merges
  FOR EACH ROW
  EXECUTE FUNCTION public.budget_category_merges_guard()$t103_15$;

        EXECUTE $t103_16$REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM PUBLIC$t103_16$;

        EXECUTE $t103_17$REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM anon$t103_17$;

        EXECUTE $t103_18$REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM authenticated$t103_18$;

        EXECUTE $t103_19$REVOKE ALL ON TABLE public.budget_template_categories FROM PUBLIC$t103_19$;

        EXECUTE $t103_20$REVOKE ALL ON TABLE public.budget_template_categories FROM anon$t103_20$;

        EXECUTE $t103_21$REVOKE ALL ON TABLE public.budget_project_categories  FROM PUBLIC$t103_21$;

        EXECUTE $t103_22$REVOKE ALL ON TABLE public.budget_project_categories  FROM anon$t103_22$;

        EXECUTE $t103_23$REVOKE ALL ON TABLE public.budget_lines               FROM PUBLIC$t103_23$;

        EXECUTE $t103_24$REVOKE ALL ON TABLE public.budget_lines               FROM anon$t103_24$;

        EXECUTE $t103_25$REVOKE ALL ON TABLE public.budget_category_merges     FROM PUBLIC$t103_25$;

        EXECUTE $t103_26$REVOKE ALL ON TABLE public.budget_category_merges     FROM anon$t103_26$;

        EXECUTE $t103_27$ALTER TABLE public.budget_template_categories ENABLE ROW LEVEL SECURITY$t103_27$;

        EXECUTE $t103_28$ALTER TABLE public.budget_project_categories  ENABLE ROW LEVEL SECURITY$t103_28$;

        EXECUTE $t103_29$ALTER TABLE public.budget_lines               ENABLE ROW LEVEL SECURITY$t103_29$;

        EXECUTE $t103_30$ALTER TABLE public.budget_category_merges     ENABLE ROW LEVEL SECURITY$t103_30$;

        EXECUTE $t103_31$CREATE POLICY "budget_template_categories_org_select"
  ON public.budget_template_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))$t103_31$;

        EXECUTE $t103_32$CREATE POLICY "budget_template_categories_org_insert"
  ON public.budget_template_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()))$t103_32$;

        EXECUTE $t103_33$CREATE POLICY "budget_template_categories_org_update"
  ON public.budget_template_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()))$t103_33$;

        EXECUTE $t103_34$CREATE POLICY "budget_template_categories_org_delete"
  ON public.budget_template_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))$t103_34$;

        EXECUTE $t103_35$CREATE POLICY "budget_project_categories_org_select"
  ON public.budget_project_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_35$;

        EXECUTE $t103_36$CREATE POLICY "budget_project_categories_org_insert"
  ON public.budget_project_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_36$;

        EXECUTE $t103_37$CREATE POLICY "budget_project_categories_org_update"
  ON public.budget_project_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_37$;

        EXECUTE $t103_38$CREATE POLICY "budget_project_categories_org_delete"
  ON public.budget_project_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_38$;

        EXECUTE $t103_39$CREATE POLICY "budget_lines_org_select"
  ON public.budget_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_39$;

        EXECUTE $t103_40$CREATE POLICY "budget_lines_org_insert"
  ON public.budget_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_40$;

        EXECUTE $t103_41$CREATE POLICY "budget_lines_org_update"
  ON public.budget_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_41$;

        EXECUTE $t103_42$CREATE POLICY "budget_lines_org_delete"
  ON public.budget_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_42$;

        EXECUTE $t103_43$CREATE POLICY "budget_category_merges_org_select"
  ON public.budget_category_merges AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_43$;

        EXECUTE $t103_44$CREATE POLICY "budget_category_merges_org_insert"
  ON public.budget_category_merges AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_44$;

  END IF;

  v_fp0 := (md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_template_categories x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_project_categories x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_lines x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_category_merges x), '')));

  ---------------------------------------------------------------------
  -- THE LOOP. PHASE 1 = AS THE OWNER (only where sc_twin). PHASE 2 = AS THE ACTOR.
  -- Every scenario runs in its own nested block and ends in LG097, which that block's own
  -- handler swallows, undoing the seed, the setup, the role switch and the claims.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. 2 LOOP
    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_ph - 1) * v_n + v_i;
      IF v_ph = 1 AND NOT sc_twin[v_i] THEN
        CONTINUE;
      END IF;
      v_actor := CASE WHEN v_ph = 1 THEN 'owner' ELSE sc_actor[v_i] END;

      v_missing := NULL;
      IF sc_need[v_i] <> '' THEN
        FOREACH v_k IN ARRAY string_to_array(sc_need[v_i], ',') LOOP
          IF NOT coalesce((v_have ->> v_k)::boolean, false) THEN
            v_missing := coalesce(v_missing || ',', '') || v_k;
          END IF;
        END LOOP;
      END IF;

      IF v_missing IS NOT NULL THEN
        r_cls[v_idx] := 'NOSUBJECT:' || v_missing;
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          -- Seed and setup run as the OWNER (no end-user session). Undone with the scenario.
          FOR v_s IN 1 .. array_length(seed_sql, 1) LOOP
            IF seed_need[v_s] = '' OR coalesce((v_have ->> seed_need[v_s])::boolean, false) THEN
              FOREACH v_stmt IN ARRAY string_to_array(seed_sql[v_s], '~|~') LOOP
                EXECUTE format(v_stmt, VARIADIC v_ids);
              END LOOP;
            END IF;
          END LOOP;
          IF sc_setup[v_i] <> '' THEN
            FOREACH v_stmt IN ARRAY string_to_array(sc_setup[v_i], '~|~') LOOP
              EXECUTE format(v_stmt, VARIADIC v_ids);
            END LOOP;
          END IF;

          IF v_actor <> 'owner' THEN
            v_uid := v_actor_uids[array_position(v_actor_keys, v_actor)];
            IF v_uid IS NULL THEN
              RAISE EXCEPTION 'no subject user for actor %', v_actor USING ERRCODE = 'LG098';
            END IF;
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
            PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
            SET LOCAL ROLE authenticated;
            -- THE CONTROL THAT PROVES IMPERSONATION TOOK. A mismatch is a TEST FAULT, never a verdict.
            IF auth.uid() IS DISTINCT FROM v_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (%): auth.uid() is %, expected %', v_actor, auth.uid(), v_uid USING ERRCODE = 'LG098';
            END IF;
          END IF;

          EXECUTE format(sc_sql[v_i], VARIADIC v_ids) INTO v_val;
          IF sc_chk[v_i] <> '' THEN
            EXECUTE format(sc_chk[v_i], VARIADIC v_ids) INTO v_val;
          END IF;

          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);

          r_cls[v_idx] := 'DONE';
          r_val[v_idx] := v_val;
          RAISE EXCEPTION 'scenario % complete: undoing its writes', sc_id[v_i] USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN
            NULL;
          WHEN OTHERS THEN
            r_cls[v_idx] := CASE
              WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := (md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_template_categories x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_project_categories x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_lines x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_category_merges x), '')));
      v_iso_runs := v_iso_runs + 1;
      IF v_fp IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc_id[v_i] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;
  END LOOP;

  RESET ROLE;

  ---------------------------------------------------------------------
  -- JUDGEMENT. One verdict per counted scenario, then the structural lines.
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    v_exp := sc_expect[v_i];
    v_tc := CASE
      WHEN NOT sc_twin[v_i] THEN '(not run)'
      WHEN r_cls[v_i] = 'DONE' THEN format('value %s', r_val[v_i])
      ELSE r_cls[v_i] END;
    v_ac := CASE WHEN r_cls[v_n + v_i] = 'DONE' THEN format('value %s', r_val[v_n + v_i]) ELSE r_cls[v_n + v_i] END;

    IF v_exp = 'I' THEN
      v_info := v_info || format(E'  %s : %s\n', sc_label[v_i], v_ac);
      CONTINUE;
    END IF;

    v_ran := v_ran + 1;
    v_ba := v_ba || format(E'  %s\n      OWNER : %s\n      ACTOR : %s\n', sc_label[v_i], v_tc, v_ac);
    v_twin_ok := (NOT sc_twin[v_i]) OR (r_cls[v_i] = 'DONE' AND coalesce(r_val[v_i], 0) >= 1);

    IF r_cls[v_n + v_i] LIKE 'NOSUBJECT%' OR r_cls[v_i] LIKE 'NOSUBJECT%' THEN
      v_verdict := 'INCONCLUSIVE';
      v_note := format('NO SUBJECT (%s). Not exercised. This is not a pass.', r_cls[v_n + v_i]);
    ELSIF r_cls[v_n + v_i] LIKE 'FAULT%' OR r_cls[v_i] LIKE 'FAULT%' THEN
      v_verdict := 'INCONCLUSIVE';
      v_note := format('TEST FAULT, impersonation did not take (OWNER: %s; ACTOR: %s). Says nothing about 103.', v_tc, v_ac);
    ELSIF v_exp LIKE 'N:%' THEN
      v_expn := substring(v_exp from 3)::integer;
      IF r_cls[v_n + v_i] = 'DONE' AND r_val[v_n + v_i] = v_expn THEN
        IF v_twin_ok THEN
          v_verdict := 'PASS';  v_note := format('(%s)', v_ac);
        ELSE
          v_verdict := 'INCONCLUSIVE';
          v_note := format('NOT DISCRIMINATING. The actor saw %s but the OWNER saw %s, so the row it should have seen is not there.', v_expn, v_tc);
        END IF;
      ELSIF r_cls[v_n + v_i] = 'DONE' THEN
        v_verdict := 'FAIL';  v_note := format('expected %s, got %s.', v_expn, r_val[v_n + v_i]);
      ELSE
        v_verdict := 'FAIL';  v_note := format('expected %s, got %s.', v_expn, r_cls[v_n + v_i]);
      END IF;
    ELSIF v_exp LIKE 'G:%' THEN
      v_expn := substring(v_exp from 3)::integer;
      IF r_cls[v_n + v_i] = 'DONE' AND r_val[v_n + v_i] >= v_expn THEN
        v_verdict := 'PASS';  v_note := format('(%s)', v_ac);
      ELSE
        v_verdict := 'FAIL';  v_note := format('expected at least %s, got %s.', v_expn, v_ac);
      END IF;
    ELSIF v_exp LIKE 'E:%' THEN
      IF r_cls[v_n + v_i] LIKE 'ERR:' || substring(v_exp from 3) || '%' THEN
        IF v_twin_ok THEN
          v_verdict := 'PASS';  v_note := format('(refused %s)', substring(v_exp from 3));
        ELSE
          v_verdict := 'INCONCLUSIVE';
          v_note := format('NOT DISCRIMINATING. The actor was refused, but the OWNER could not do it either (%s), so the refusal cannot be credited to the policy.', v_tc);
        END IF;
      ELSIF r_cls[v_n + v_i] = 'DONE' THEN
        v_verdict := 'FAIL';  v_note := format('ADMITTED. Expected %s, but the statement succeeded (%s). THE BOUNDARY IS OPEN.', substring(v_exp from 3), v_ac);
      ELSE
        v_verdict := 'FAIL';  v_note := format('expected %s, got %s.', substring(v_exp from 3), r_cls[v_n + v_i]);
      END IF;
    ELSE
      v_verdict := 'FAIL';  v_note := 'THE TEST ITSELF IS BROKEN: unknown expectation ' || v_exp;
    END IF;

    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 56) || rpad(v_verdict, 14) || v_note;
    IF v_verdict = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_verdict = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1;
    END IF;
  END LOOP;

  ---------------------------------------------------------------------
  -- STRUCTURAL ASSERTIONS. Read from the catalog after the DDL is in.
  ---------------------------------------------------------------------
  -- S1. four tables exist, row level security on
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*), count(*) FILTER (WHERE c.relrowsecurity) INTO v_a, v_b
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (v_tables);
    v_ok := (v_a = 4 AND v_b = 4);
    v_detail := format('(tables %s, row level security on %s; expected 4 and 4)', v_a, v_b);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S1  four tables exist, row level security on', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S1  four tables exist, row level security on', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S1  four tables exist, row level security on', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S2. fourteen policies, all authenticated, right commands
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*), count(*) FILTER (WHERE roles <> ARRAY['authenticated']::name[]) INTO v_a, v_b
    FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (v_tables);
    SELECT string_agg(tablename || ':' || cmds, ' ' ORDER BY tablename) INTO v_t
    FROM (SELECT tablename, string_agg(cmd, ',' ORDER BY cmd) AS cmds
          FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (v_tables) GROUP BY tablename) q;
    v_ok := (v_a = 14 AND v_b = 0 AND v_t = 'budget_category_merges:INSERT,SELECT budget_lines:DELETE,INSERT,SELECT,UPDATE budget_project_categories:DELETE,INSERT,SELECT,UPDATE budget_template_categories:DELETE,INSERT,SELECT,UPDATE');
    v_detail := format('(%s policies, %s not to authenticated only; %s)', v_a, v_b, v_t);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S2  fourteen policies, all authenticated, right commands', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S2  fourteen policies, all authenticated, right commands', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S2  fourteen policies, all authenticated, right commands', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S3. no policy mentions a vendor, partnership or assignment
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY (v_tables)
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(vendor|partnership|assign)';
    v_ok := (v_a = 0);
    v_detail := format('(%s policies mention a vendor, partnership or assignment; expected 0)', v_a);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S3  no policy mentions a vendor, partnership or assignment', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S3  no policy mentions a vendor, partnership or assignment', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S3  no policy mentions a vendor, partnership or assignment', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S4. anon has no privilege, authenticated has table access
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM unnest(v_tables) AS t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
    WHERE has_table_privilege('anon', 'public.' || t, p);
    SELECT count(*) INTO v_b FROM unnest(v_tables) AS t, unnest(ARRAY['SELECT', 'INSERT']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || t, p);
    v_ok := (v_a = 0 AND v_b = 8);
    v_detail := format('(anon privileges %s, expected 0; authenticated SELECT/INSERT grants %s, expected 8)', v_a, v_b);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S4  anon has no privilege, authenticated has table access', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S4  anon has no privilege, authenticated has table access', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S4  anon has no privilege, authenticated has table access', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S5. budget_lines holds the estimate and no invented column
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_t
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'budget_lines';
    v_ok := (v_t = 'category_id,created_at,estimate,id,name,project_id');
    v_detail := format('(columns: %s)', v_t);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S5  budget_lines holds the estimate and no invented column', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S5  budget_lines holds the estimate and no invented column', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S5  budget_lines holds the estimate and no invented column', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S6. fee_or_cost is NOT NULL with no default on both charts
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('budget_template_categories', 'budget_project_categories')
      AND column_name = 'fee_or_cost' AND is_nullable = 'NO' AND column_default IS NULL;
    v_ok := (v_a = 2);
    v_detail := format('(%s of 2 tables have fee_or_cost NOT NULL with no default)', v_a);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S6  fee_or_cost is NOT NULL with no default on both charts', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S6  fee_or_cost is NOT NULL with no default on both charts', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S6  fee_or_cost is NOT NULL with no default on both charts', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S7. no money foreign key cascades
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) FILTER (WHERE contype = 'f'), count(*) FILTER (WHERE contype = 'f' AND confdeltype <> 'a') INTO v_a, v_b
    FROM pg_constraint WHERE conrelid = 'public.budget_lines'::regclass;
    SELECT count(*) FILTER (WHERE contype = 'f' AND confdeltype = 'a'), count(*) FILTER (WHERE contype = 'f' AND confdeltype = 'c') INTO v_c, v_d
    FROM pg_constraint WHERE conrelid = 'public.budget_category_merges'::regclass;
    v_ok := (v_a = 2 AND v_b = 0 AND v_c = 2 AND v_d = 1);
    v_detail := format('(budget_lines: %s foreign keys, %s not NO ACTION; merges: %s NO ACTION, %s CASCADE; expected 2/0 and 2/1)', v_a, v_b, v_c, v_d);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S7  no money foreign key cascades', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S7  no money foreign key cascades', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S7  no money foreign key cascades', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S8. the project chart has no pointer to the template
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM pg_constraint
    WHERE conrelid = 'public.budget_project_categories'::regclass AND contype = 'f' AND confrelid = 'public.projects'::regclass;
    SELECT count(*) INTO v_b FROM pg_constraint
    WHERE conrelid = 'public.budget_project_categories'::regclass AND contype = 'f';
    v_ok := (v_a = 1 AND v_b = 1);
    v_detail := format('(foreign keys on the project chart: %s, of which to projects %s; expected 1 and 1, so none points at the template)', v_b, v_a);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S8  the project chart has no pointer to the template', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S8  the project chart has no pointer to the template', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S8  the project chart has no pointer to the template', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S9. no pre-existing policy changed
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    IF v_present THEN
      v_ok := NULL;
      v_detail := 'the objects already existed before this run, so the +14 policy delta cannot be measured here. Re-run P3 and V3 by hand.';
    ELSE
      SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                     E'\n' ORDER BY tablename, policyname), ''))
        INTO v_pol_after
      FROM pg_policies WHERE schemaname = 'public' AND NOT (tablename = ANY (v_tables));
      SELECT count(*) INTO v_a FROM pg_policies WHERE schemaname = 'public';
      v_ok := (v_pol_before IS NOT DISTINCT FROM v_pol_after AND v_a = v_pol_cnt_before + 14);
      v_detail := format('(fingerprint of every other policy %s before and after; total %s -> %s, expected +14)', v_pol_before, v_pol_cnt_before, v_a);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S9  no pre-existing policy changed', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S9  no pre-existing policy changed', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S9  no pre-existing policy changed', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S10. merge trigger present, BEFORE INSERT; function callable by nobody
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM pg_trigger
    WHERE tgrelid = 'public.budget_category_merges'::regclass AND NOT tgisinternal
      AND tgname = 'budget_category_merges_guard' AND tgenabled = 'O'
      AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 4) = 4;
    v_ok := (v_a = 1
             AND NOT has_function_privilege('anon', 'public.budget_category_merges_guard()', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.budget_category_merges_guard()', 'EXECUTE'));
    v_detail := format('(trigger rows %s, expected 1; function EXECUTE for anon/authenticated must be false)', v_a);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S10 merge trigger present, BEFORE INSERT; function callable by nobody', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S10 merge trigger present, BEFORE INSERT; function callable by nobody', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S10 merge trigger present, BEFORE INSERT; function callable by nobody', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;


  ---------------------------------------------------------------------
  -- VERDICT + REPORT. Self-checks outrank everything.
  ---------------------------------------------------------------------
  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 103.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected THEN
    v_verdict_text := 'SAFE TO APPLY 103.';
    v_headline := format('SAFE TO APPLY 103.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 103 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 103 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 103.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected)
    || format(E'PASS            : %s   (expected %s)\n', v_pass, c_expected)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n', v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'isolation check : %s scenario run(s) each compared to the pre-loop fingerprint: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'state at start  : 103 objects present before this test = %s (false means this test applied the DDL itself, inside the transaction that rolls back)\n', v_present)
    || format(E'SUBJECT          : agency member %s, colleague %s (org %s, project %s); other agency member %s (org %s, project %s); vendor user %s (vendor org %s)\n',
              v_u1, coalesce(v_u1b::text, 'NONE'), v_o1, v_p1, coalesce(v_u2::text, 'NONE'), coalesce(v_o2::text, 'NONE'), coalesce(v_p2::text, 'NONE'), v_uv, v_ov)
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nINFORMATIONAL (not counted)\n'
    || v_info
    || E'\nOWNER = the same statement as the table owner (proves the row is there / the write is possible);\nACTOR = as the impersonated end user.\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

-- THE BACKSTOP. IT STAYS. Not reached on the expected path (the DO block ends in
-- RAISE EXCEPTION and aborts the transaction). It is the net for a client that swallows
-- the error: the transaction would still hold the test's CREATE TABLEs.
ROLLBACK;
