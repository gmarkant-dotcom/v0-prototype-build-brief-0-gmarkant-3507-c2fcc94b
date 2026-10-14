-- =====================================================================================================
-- R-D3 RETAG PREVIEW (2026-10-14). READ ONLY: one SELECT, writes nothing.
--
-- Shows what 2026-10-14-retag-categories_apply.sql would change for the owner's test project and the
-- agency template of the organization that owns it, and nothing else:
--   1. scope        the project, its derived organization, and whether that organization is exactly
--                   79a82f92-c2bd-42ab-90a8-0b4d54f9e043 (the apply refuses otherwise)
--   2. category     every budget_project_categories row of the project (archived and merged-away
--                   included) and every budget_template_categories row of the organization whose name
--                   matches one of the ten R-D2 names and is fee today: id, name, current kind, new kind
--   3. override     every budget_lines override in the project that R-K4 would clear after the retag
--                   (the line's fee_or_cost equals its category's kind): line id, name, current override.
--                   SAVE THIS OUTPUT: the revert does not restore cleared overrides; this is their record.
--   4. count        rows per table that would change
--   5. outside      rows OUTSIDE the scope whose name matches (count only), to show they are untouched
--
-- Name match: case- and whitespace-insensitive, the same rule as categoryNameKey()
-- (lib/budget/starter-templates.ts): trim, collapse inner whitespace to one space, lower-case.
-- Explicit id predicates only. Run as the SQL Editor's role; nothing here depends on RLS.
-- =====================================================================================================

WITH params AS (
  SELECT 'e533075f-95f0-414e-bbca-742c7d344aad'::uuid AS project_id,
         '79a82f92-c2bd-42ab-90a8-0b4d54f9e043'::uuid AS expected_org_id
),
names (name_key) AS (
  VALUES ('creative development'),
         ('event strategy and creative'),
         ('strategy and planning'),
         ('creative and copywriting'),
         ('design and art direction'),
         ('community management'),
         ('reporting and analytics'),
         ('art direction'),
         ('creative direction'),
         ('series development')
),
scope AS (
  SELECT p.project_id, p.expected_org_id, pr.id AS found_project, pr.org_id
  FROM params p
  LEFT JOIN public.projects pr ON pr.id = p.project_id
),
project_cats AS (
  SELECT c.id, c.name, c.fee_or_cost, c.archived_at,
         lower(regexp_replace(regexp_replace(c.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) AS name_key
  FROM public.budget_project_categories c
  JOIN scope s ON c.project_id = s.project_id
),
template_cats AS (
  SELECT t.id, t.name, t.fee_or_cost, t.archived_at,
         lower(regexp_replace(regexp_replace(t.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) AS name_key
  FROM public.budget_template_categories t
  JOIN scope s ON t.org_id = s.org_id
),
pc_change AS (
  SELECT * FROM project_cats WHERE fee_or_cost = 'fee' AND name_key IN (SELECT name_key FROM names)
),
tc_change AS (
  SELECT * FROM template_cats WHERE fee_or_cost = 'fee' AND name_key IN (SELECT name_key FROM names)
),
kind_after AS (
  SELECT c.id, CASE WHEN c.id IN (SELECT id FROM pc_change) THEN 'cost' ELSE c.fee_or_cost END AS kind
  FROM project_cats c
),
cleared AS (
  SELECT l.id, l.name, l.fee_or_cost, l.category_id, l.archived_at
  FROM public.budget_lines l
  JOIN scope s ON l.project_id = s.project_id
  JOIN kind_after k ON k.id = l.category_id
  WHERE l.fee_or_cost = k.kind
),
outside_pc AS (
  SELECT count(*) AS n, count(*) FILTER (WHERE c.fee_or_cost = 'fee') AS n_fee
  FROM public.budget_project_categories c
  WHERE c.project_id <> (SELECT project_id FROM scope)
    AND lower(regexp_replace(regexp_replace(c.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) IN (SELECT name_key FROM names)
),
outside_tc AS (
  SELECT count(*) AS n, count(*) FILTER (WHERE t.fee_or_cost = 'fee') AS n_fee
  FROM public.budget_template_categories t
  WHERE t.org_id IS DISTINCT FROM (SELECT org_id FROM scope)
    AND lower(regexp_replace(regexp_replace(t.name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) IN (SELECT name_key FROM names)
)
SELECT section, table_name, id, name, current_kind, new_kind, detail
FROM (
  SELECT 1 AS ord, 'scope'::text AS section, 'projects'::text AS table_name, s.project_id AS id, NULL::text AS name,
         NULL::text AS current_kind, NULL::text AS new_kind,
         CASE WHEN s.found_project IS NULL THEN 'PROJECT NOT FOUND: the apply refuses'
              ELSE format('derived organization %s; equals 79a82f92-c2bd-42ab-90a8-0b4d54f9e043: %s',
                          s.org_id, CASE WHEN s.org_id = s.expected_org_id THEN 'YES' ELSE 'NO, the apply refuses' END)
         END AS detail
  FROM scope s

  UNION ALL
  SELECT 2, 'category', 'budget_project_categories', c.id, c.name, c.fee_or_cost, 'cost',
         CASE WHEN c.archived_at IS NULL THEN 'live' ELSE 'archived' END
  FROM pc_change c

  UNION ALL
  SELECT 2, 'category', 'budget_template_categories', t.id, t.name, t.fee_or_cost, 'cost',
         CASE WHEN t.archived_at IS NULL THEN 'live' ELSE 'archived' END
  FROM tc_change t

  UNION ALL
  SELECT 3, 'override', 'budget_lines', l.id, l.name, l.fee_or_cost, NULL,
         format('category %s; %s; becomes inherit', l.category_id, CASE WHEN l.archived_at IS NULL THEN 'live' ELSE 'archived' END)
  FROM cleared l

  UNION ALL
  SELECT 4, 'count', 'budget_project_categories', NULL, NULL, NULL, NULL,
         format('%s row(s) would change fee -> cost (the apply refuses above 10)', (SELECT count(*) FROM pc_change))
  UNION ALL
  SELECT 4, 'count', 'budget_template_categories', NULL, NULL, NULL, NULL,
         format('%s row(s) would change fee -> cost (the apply refuses above 10)', (SELECT count(*) FROM tc_change))
  UNION ALL
  SELECT 4, 'count', 'budget_lines', NULL, NULL, NULL, NULL,
         format('%s override(s) would be cleared to inherit (R-K4)', (SELECT count(*) FROM cleared))

  UNION ALL
  SELECT 5, 'outside', 'budget_project_categories', NULL, NULL, NULL, NULL,
         format('%s row(s) in OTHER projects match the names (%s of them fee); untouched', o.n, o.n_fee)
  FROM outside_pc o
  UNION ALL
  SELECT 5, 'outside', 'budget_template_categories', NULL, NULL, NULL, NULL,
         format('%s row(s) in OTHER organizations match the names (%s of them fee); untouched', o.n, o.n_fee)
  FROM outside_tc o
) x
ORDER BY ord, table_name, name, id;
