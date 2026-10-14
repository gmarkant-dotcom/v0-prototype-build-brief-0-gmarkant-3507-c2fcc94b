-- =====================================================================================================
-- R-D3 RETAG APPLY v2 (2026-10-14). No temp tables (v1 failed in the SQL Editor: 42P01 retag_changed).
-- Pinned to the two rows the preview listed: project category e57719fe-9021-4cb2-84a4-ffcc24111404 and
-- template category 42a8ab0a-c102-4587-b116-c23e563dd816 ("Event strategy and creative"), fee -> cost.
-- Then clears line overrides in the project that equal their category's kind (R-K4).
-- Fail-closed: F1 project missing; F2 organization not 79a82f92-...; F6 the name rule does not find
-- exactly the two pinned rows; F5 an UPDATE did not change exactly one row.
-- Proof: run the preview before and after. DRY RUN: change the COMMIT line to ROLLBACK.
-- =====================================================================================================
BEGIN;

DO $retag$
DECLARE
  v_project      uuid := 'e533075f-95f0-414e-bbca-742c7d344aad';
  v_expected_org uuid := '79a82f92-c2bd-42ab-90a8-0b4d54f9e043';
  v_pc_id        uuid := 'e57719fe-9021-4cb2-84a4-ffcc24111404';
  v_tc_id        uuid := '42a8ab0a-c102-4587-b116-c23e563dd816';
  v_names text[] := ARRAY['creative development','event strategy and creative','strategy and planning',
                          'creative and copywriting','design and art direction','community management',
                          'reporting and analytics','art direction','creative direction','series development'];
  v_org uuid;
  v_pc_ids uuid[]; v_tc_ids uuid[];
  v_n int; v_cleared int;
BEGIN
  SELECT org_id INTO v_org FROM public.projects WHERE id = v_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'R-D3 F1: project % not found', v_project; END IF;
  IF v_org IS DISTINCT FROM v_expected_org THEN
    RAISE EXCEPTION 'R-D3 F2: project organization % is not %', v_org, v_expected_org;
  END IF;

  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_pc_ids FROM public.budget_project_categories
   WHERE project_id = v_project AND fee_or_cost = 'fee'
     AND lower(regexp_replace(regexp_replace(name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) = ANY (v_names);
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tc_ids FROM public.budget_template_categories
   WHERE org_id = v_org AND fee_or_cost = 'fee'
     AND lower(regexp_replace(regexp_replace(name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) = ANY (v_names);
  IF v_pc_ids <> ARRAY[v_pc_id] OR v_tc_ids <> ARRAY[v_tc_id] THEN
    RAISE EXCEPTION 'R-D3 F6: expected exactly project % and template %, found project % and template %',
      v_pc_id, v_tc_id, v_pc_ids, v_tc_ids;
  END IF;

  UPDATE public.budget_project_categories SET fee_or_cost = 'cost'
   WHERE id = v_pc_id AND project_id = v_project AND fee_or_cost = 'fee';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'R-D3 F5: project category update changed % rows, expected 1', v_n; END IF;

  UPDATE public.budget_template_categories SET fee_or_cost = 'cost'
   WHERE id = v_tc_id AND org_id = v_org AND fee_or_cost = 'fee';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'R-D3 F5: template category update changed % rows, expected 1', v_n; END IF;

  UPDATE public.budget_lines l SET fee_or_cost = NULL
    FROM public.budget_project_categories c
   WHERE l.project_id = v_project AND c.project_id = v_project AND c.id = l.category_id
     AND l.fee_or_cost IS NOT NULL AND l.fee_or_cost = c.fee_or_cost;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RAISE NOTICE 'R-D3 applied: 1 project category, 1 template category, % overrides cleared', v_cleared;
END
$retag$;

COMMIT;
