-- =====================================================================================================
-- R-D3 RETAG REVERT v2 (2026-10-14). No temp tables. Pinned to the same two rows the apply changed:
-- project category e57719fe-9021-4cb2-84a4-ffcc24111404 and template category
-- 42a8ab0a-c102-4587-b116-c23e563dd816, cost -> fee. Then clears line overrides in the project that now
-- equal their category's kind (R-K4). Cleared overrides from the apply are NOT restored (the preview
-- output is their record; it listed none on 2026-10-14).
-- Fail-closed: F1 project missing; F2 organization not 79a82f92-...; F5 an UPDATE did not change exactly
-- one row (so it refuses if either row is not currently cost). DRY RUN: change the COMMIT line to ROLLBACK.
-- =====================================================================================================
BEGIN;

DO $revert$
DECLARE
  v_project      uuid := 'e533075f-95f0-414e-bbca-742c7d344aad';
  v_expected_org uuid := '79a82f92-c2bd-42ab-90a8-0b4d54f9e043';
  v_pc_id        uuid := 'e57719fe-9021-4cb2-84a4-ffcc24111404';
  v_tc_id        uuid := '42a8ab0a-c102-4587-b116-c23e563dd816';
  v_org uuid;
  v_n int; v_cleared int;
BEGIN
  SELECT org_id INTO v_org FROM public.projects WHERE id = v_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'R-D3 revert F1: project % not found', v_project; END IF;
  IF v_org IS DISTINCT FROM v_expected_org THEN
    RAISE EXCEPTION 'R-D3 revert F2: project organization % is not %', v_org, v_expected_org;
  END IF;

  UPDATE public.budget_project_categories SET fee_or_cost = 'fee'
   WHERE id = v_pc_id AND project_id = v_project AND fee_or_cost = 'cost';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'R-D3 revert F5: project category update changed % rows, expected 1', v_n; END IF;

  UPDATE public.budget_template_categories SET fee_or_cost = 'fee'
   WHERE id = v_tc_id AND org_id = v_org AND fee_or_cost = 'cost';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'R-D3 revert F5: template category update changed % rows, expected 1', v_n; END IF;

  UPDATE public.budget_lines l SET fee_or_cost = NULL
    FROM public.budget_project_categories c
   WHERE l.project_id = v_project AND c.project_id = v_project AND c.id = l.category_id
     AND l.fee_or_cost IS NOT NULL AND l.fee_or_cost = c.fee_or_cost;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RAISE NOTICE 'R-D3 reverted: 1 project category, 1 template category, % overrides cleared', v_cleared;
END
$revert$;

COMMIT;
