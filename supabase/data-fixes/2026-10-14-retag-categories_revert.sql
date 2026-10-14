-- =====================================================================================================
-- R-D3 RETAG REVERT (2026-10-14). Undoes 2026-10-14-retag-categories_apply.sql for the CATEGORIES only.
--
-- For the owner's test project and the agency template of the organization that owns it, ONLY:
--   1. budget_project_categories of the project (archived and merged-away included) whose name matches
--      one of the ten R-D2 names and is cost: set back to fee.
--   2. budget_template_categories of that organization, same match: set back to fee.
--   3. R-K4 across the project: an override that now equals its category's kind is set to NULL, so the
--      invariant still holds after the revert (a line marked fee in a category that is fee again).
--
-- CLEARED LINE OVERRIDES ARE NOT RESTORED. The apply set every override that equalled its category's
-- kind to NULL; which lines those were, and what they held, is recorded only in the output of
-- 2026-10-14-retag-categories_preview.sql run before the apply. Restore them by hand from that output
-- if needed.
-- ALSO NOTE: this sets EVERY matching cost row in scope to fee. A matching category that was already
-- cost before the apply (the preview lists only the fee rows it changed) is set to fee too. Compare
-- with the saved preview output before running.
--
-- Name match: case- and whitespace-insensitive, the same rule as categoryNameKey()
-- (lib/budget/starter-templates.ts). The project id is stated once (v_project in the DO block). No
-- dynamic SQL. Explicit id predicates only; nothing here depends on RLS.
--
-- FAILS CLOSED, same guards as the apply:
--   F1 the project does not exist;
--   F2 its organization is not exactly 79a82f92-c2bd-42ab-90a8-0b4d54f9e043;
--   F3 more than 10 project categories would change;
--   F4 more than 10 template categories would change;
--   F5 after the UPDATEs, any changed category row lies outside the project or the organization;
--   F6 after the UPDATEs, any cleared line lies outside the project;
--   F7 after the UPDATEs, more than 10 rows changed in either category table.
-- DRY RUN: change the COMMIT line at the end to ROLLBACK.
-- =====================================================================================================

BEGIN;

CREATE TEMP TABLE revert_changed (
  table_name text NOT NULL,
  id         uuid NOT NULL,
  name       text NOT NULL,
  owner_id   uuid NOT NULL,   -- project_id for project categories, org_id for template categories
  old_kind   text NOT NULL,
  new_kind   text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE revert_cleared (
  id          uuid NOT NULL,
  name        text NOT NULL,
  project_id  uuid NOT NULL,
  category_id uuid NOT NULL,
  old_kind    text NOT NULL
) ON COMMIT DROP;

DO $revert$
DECLARE
  v_project  CONSTANT uuid := 'e533075f-95f0-414e-bbca-742c7d344aad';
  v_expected CONSTANT uuid := '79a82f92-c2bd-42ab-90a8-0b4d54f9e043';
  v_names    CONSTANT text[] := ARRAY[
    'creative development',
    'event strategy and creative',
    'strategy and planning',
    'creative and copywriting',
    'design and art direction',
    'community management',
    'reporting and analytics',
    'art direction',
    'creative direction',
    'series development'
  ];
  v_org      uuid;
  v_pc       integer;
  v_tc       integer;
  v_bad      integer;
BEGIN
  -- F1, F2
  SELECT pr.org_id INTO v_org FROM public.projects pr WHERE pr.id = v_project;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'R-D3 revert refused (F1): project % does not exist', v_project;
  END IF;
  IF v_org IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'R-D3 revert refused (F2): project % belongs to organization %, not %', v_project, v_org, v_expected;
  END IF;

  -- F3, F4
  SELECT count(*) INTO v_pc
  FROM public.budget_project_categories c
  WHERE c.project_id = v_project
    AND c.fee_or_cost = 'cost'
    AND lower(regexp_replace(regexp_replace(c.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) = ANY (v_names);
  SELECT count(*) INTO v_tc
  FROM public.budget_template_categories t
  WHERE t.org_id = v_org
    AND t.fee_or_cost = 'cost'
    AND lower(regexp_replace(regexp_replace(t.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) = ANY (v_names);
  IF v_pc > 10 THEN
    RAISE EXCEPTION 'R-D3 revert refused (F3): % project categories would change, more than 10', v_pc;
  END IF;
  IF v_tc > 10 THEN
    RAISE EXCEPTION 'R-D3 revert refused (F4): % template categories would change, more than 10', v_tc;
  END IF;

  -- 1. Project categories back to fee.
  WITH u AS (
    UPDATE public.budget_project_categories c
    SET fee_or_cost = 'fee'
    WHERE c.project_id = v_project
      AND c.fee_or_cost = 'cost'
      AND lower(regexp_replace(regexp_replace(c.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) = ANY (v_names)
    RETURNING c.id, c.name, c.project_id
  )
  INSERT INTO revert_changed (table_name, id, name, owner_id, old_kind, new_kind)
  SELECT 'budget_project_categories', u.id, u.name, u.project_id, 'cost', 'fee' FROM u;

  -- 2. Template categories of the project's organization back to fee.
  WITH u AS (
    UPDATE public.budget_template_categories t
    SET fee_or_cost = 'fee'
    WHERE t.org_id = v_org
      AND t.fee_or_cost = 'cost'
      AND lower(regexp_replace(regexp_replace(t.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) = ANY (v_names)
    RETURNING t.id, t.name, t.org_id
  )
  INSERT INTO revert_changed (table_name, id, name, owner_id, old_kind, new_kind)
  SELECT 'budget_template_categories', u.id, u.name, u.org_id, 'cost', 'fee' FROM u;

  -- 3. R-K4 across the project.
  WITH u AS (
    UPDATE public.budget_lines l
    SET fee_or_cost = NULL
    FROM public.budget_project_categories c
    WHERE l.project_id = v_project
      AND c.project_id = v_project
      AND c.id = l.category_id
      AND l.fee_or_cost = c.fee_or_cost
    RETURNING l.id, l.name, l.project_id, l.category_id, c.fee_or_cost
  )
  INSERT INTO revert_cleared (id, name, project_id, category_id, old_kind)
  SELECT u.id, u.name, u.project_id, u.category_id, u.fee_or_cost FROM u;

  -- F5
  SELECT count(*) INTO v_bad
  FROM revert_changed r
  WHERE (r.table_name = 'budget_project_categories' AND r.owner_id <> v_project)
     OR (r.table_name = 'budget_template_categories' AND r.owner_id <> v_org);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'R-D3 revert rolled back (F5): % changed category row(s) lie outside project % / organization %', v_bad, v_project, v_org;
  END IF;

  -- F6
  SELECT count(*) INTO v_bad FROM revert_cleared r WHERE r.project_id <> v_project;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'R-D3 revert rolled back (F6): % cleared line(s) lie outside project %', v_bad, v_project;
  END IF;

  -- F7
  SELECT count(*) INTO v_pc FROM revert_changed WHERE table_name = 'budget_project_categories';
  SELECT count(*) INTO v_tc FROM revert_changed WHERE table_name = 'budget_template_categories';
  IF v_pc > 10 OR v_tc > 10 THEN
    RAISE EXCEPTION 'R-D3 revert rolled back (F7): % project and % template categories changed, more than 10', v_pc, v_tc;
  END IF;

  RAISE NOTICE 'R-D3 revert: % project categories, % template categories set back to fee; % line overrides cleared',
    v_pc, v_tc, (SELECT count(*) FROM revert_cleared);
END
$revert$;

-- Summary: rows changed per table, overrides cleared, then every changed row.
SELECT x.table_name, x.change, x.rows_changed, x.id, x.name, x.old_kind, x.new_kind
FROM (
  SELECT 1 AS ord, t.table_name, t.change, (SELECT count(*) FROM revert_changed r WHERE r.table_name = t.table_name) AS rows_changed,
         NULL::uuid AS id, NULL::text AS name, NULL::text AS old_kind, NULL::text AS new_kind
  FROM (VALUES ('budget_project_categories', 'cost -> fee'), ('budget_template_categories', 'cost -> fee')) AS t (table_name, change)
  UNION ALL
  SELECT 1, 'budget_lines', 'override cleared (R-K4)', (SELECT count(*) FROM revert_cleared), NULL, NULL, NULL, NULL
  UNION ALL
  SELECT 2, r.table_name, 'row', NULL, r.id, r.name, r.old_kind, r.new_kind FROM revert_changed r
  UNION ALL
  SELECT 2, 'budget_lines', 'row', NULL, c.id, c.name, c.old_kind, 'NULL (inherit)' FROM revert_cleared c
) x
ORDER BY x.ord, x.table_name, x.name, x.id;

COMMIT;
