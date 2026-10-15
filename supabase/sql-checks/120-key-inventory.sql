-- =====================================================================
-- 120 KEY INVENTORY. ONE READ-ONLY QUERY, ONE RESULT SET. RUN BEFORE THE 120 PRE-APPLY TEST.
--
-- AUTHORED 2026-10-15 on feat/rfp-record-c (unattended run). NOT RUN: no database access in the
-- authoring session. It writes nothing, so a failed run costs nothing and the error names the
-- line. Paste the whole file into the Supabase SQL Editor (role postgres) and Run. Export the grid.
--
-- WHAT IT IS FOR. Migration 120 rewrites every vendor copy to an ALLOW-LIST of top-level keys:
--   partner_rfp_inbox.master_rfp_json        -> projectName, overview, objectives, timeline,
--                                               business_criteria_required, budget_categories,
--                                               nda_link, response_deadline
--   rfp_magic_tokens.reference_materials     -> materials   (when it is an object; a bare array is
--                                               the legacy materials list and stays as it is)
-- (the same lists as lib/rfp-vendor-copy.ts). This query lists EVERY distinct top-level key that
-- exists today in those JSON columns, and in the token's other JSON columns for completeness, with
-- row counts, so the owner can confirm the allow-list against live data: any key marked REMOVE that
-- a vendor screen needs, or any key never seen in the code, is a reason to stop before 120.
--
-- READ THE ROWS
--   section 1 KEYS     one row per (column, top-level key): rows carrying it, of them linked
--                      (rfp_line_id set) and unlinked, and what 120 does with it (KEEP / REMOVE /
--                      NOT SCRUBBED: the token's whole-value columns, which no vendor or guest
--                      reads raw). The pseudo-keys (null), (array), (scalar) count rows whose
--                      column is not an object.
--   section 2 CHECKS   the conditions 120's pre-flight (LG120) enforces or reports, as counts:
--     C1 linked inbox rows / tokens whose line is missing                          EXPECTED 0
--     C2 inbox rows whose master_rfp_json is neither NULL nor an object             EXPECTED 0
--     C3 inbox rows carrying _magic_token whose token still exists but is NOT
--        reachable through rfp_magic_tokens.attached_inbox_id or its line           EXPECTED 0
--        (120 refuses: scrubbing the marker would lose the only join)
--     C4 inbox rows carrying _magic_token whose token row no longer exists          EXPECTED 1
--        (inbox 04391718, closed 2026-08-18; scrubbed, listed in a NOTICE)
--     C5 unlinked inbox rows (rfp_line_id NULL)                                     EXPECTED 1 (04391718)
--     C6 linked inbox rows with a removed key the record does not hold              EXPECTED 0
--        (120 refuses and lists them)
--     C7 FINDING, NOT SCRUBBED: linked inbox rows whose estimated_budget (the vendor's figure) is
--        not the line's released_budget (D2). 120 does not touch this column.       expected 0
--     C8 FINDING, NOT SCRUBBED: inbox rows whose scope_item_id carries a token
--        ('magic:<token>'), readable by the vendor that owns the row.              count only
--     C9 FINDING, NOT SCRUBBED: notifications whose data still carries magicToken
--        (D8; step C stops writing it).                                             count only
-- =====================================================================

WITH
allow_inbox AS (
  SELECT ARRAY['projectName','overview','objectives','timeline','business_criteria_required','budget_categories','nda_link','response_deadline']::text[] AS k
),
allow_token AS (
  SELECT ARRAY['materials']::text[] AS k
),
inbox_keys AS (
  SELECT 'partner_rfp_inbox.master_rfp_json'::text AS col,
         CASE WHEN i.master_rfp_json IS NULL THEN '(null)'
              WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN e.key
              WHEN jsonb_typeof(i.master_rfp_json) = 'array' THEN '(array)'
              ELSE '(scalar)' END AS key,
         i.id::text AS row_id,
         (i.rfp_line_id IS NOT NULL) AS linked
  FROM public.partner_rfp_inbox i
  LEFT JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) AS e(key) ON true
  WHERE jsonb_typeof(i.master_rfp_json) IS DISTINCT FROM 'object' OR e.key IS NOT NULL
),
token_cols AS (
  SELECT t.id::text AS row_id, (t.rfp_line_id IS NOT NULL) AS linked, c.col, c.val
  FROM public.rfp_magic_tokens t
  CROSS JOIN LATERAL (VALUES ('rfp_magic_tokens.reference_materials', t.reference_materials),
                             ('rfp_magic_tokens.business_criteria_required', t.business_criteria_required),
                             ('rfp_magic_tokens.budget_categories', t.budget_categories),
                             ('rfp_magic_tokens.evaluation_criteria', t.evaluation_criteria)) AS c(col, val)
),
token_keys AS (
  SELECT tc.col,
         CASE WHEN tc.val IS NULL THEN '(null)'
              WHEN jsonb_typeof(tc.val) = 'object' THEN e.key
              WHEN jsonb_typeof(tc.val) = 'array' THEN '(array)'
              ELSE '(scalar)' END AS key,
         tc.row_id, tc.linked
  FROM token_cols tc
  LEFT JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(tc.val) = 'object' THEN tc.val ELSE '{}'::jsonb END) AS e(key) ON true
  WHERE jsonb_typeof(tc.val) IS DISTINCT FROM 'object' OR e.key IS NOT NULL
),
all_keys AS (
  SELECT * FROM inbox_keys
  UNION ALL
  SELECT * FROM token_keys
),
section1 AS (
  SELECT '1 KEYS'::text AS section,
         a.col AS item,
         a.key AS key,
         count(DISTINCT a.row_id) AS rows_total,
         count(DISTINCT a.row_id) FILTER (WHERE a.linked) AS rows_linked,
         count(DISTINCT a.row_id) FILTER (WHERE NOT a.linked) AS rows_unlinked,
         CASE
           WHEN a.key IN ('(null)', '(array)', '(scalar)') THEN
             CASE WHEN a.col = 'partner_rfp_inbox.master_rfp_json' AND a.key <> '(null)' THEN 'REFUSED BY 120 (not an object)'
                  ELSE 'unchanged' END
           WHEN a.col = 'partner_rfp_inbox.master_rfp_json' THEN
             CASE WHEN a.key = ANY ((SELECT k FROM allow_inbox)) THEN 'KEEP' ELSE 'REMOVE' END
           WHEN a.col = 'rfp_magic_tokens.reference_materials' THEN
             CASE WHEN a.key = ANY ((SELECT k FROM allow_token)) THEN 'KEEP' ELSE 'REMOVE' END
           ELSE 'NOT SCRUBBED (whole-value token column; agency-only RLS; the guest API sends an explicit view)'
         END AS action_120
  FROM all_keys a
  GROUP BY a.col, a.key
),
magic_rows AS (
  SELECT i.id, i.lead_org_id, i.rfp_line_id, i.master_rfp_json ->> '_magic_token' AS marker
  FROM public.partner_rfp_inbox i
  WHERE jsonb_typeof(i.master_rfp_json) = 'object' AND i.master_rfp_json ? '_magic_token'
),
removed_linked AS (
  -- Linked inbox rows carrying a removed key with a non-empty value the record does not hold.
  SELECT i.id, e.key
  FROM public.partner_rfp_inbox i
  JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
  JOIN public.rfp_records r ON r.id = l.rfp_id
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(i.master_rfp_json) = 'object' THEN i.master_rfp_json ELSE '{}'::jsonb END) AS e(key, value)
  WHERE NOT (e.key = ANY ((SELECT k FROM allow_inbox)))
    AND e.value IS NOT NULL AND e.value NOT IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
    AND NOT (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = '')
    AND NOT (
      -- The record's master holds a non-empty value under the same key, or ...
      coalesce((r.master_rfp -> e.key) NOT IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
      -- ... the record's dedicated column holds it.
      OR CASE e.key
        WHEN 'evaluation_criteria' THEN coalesce(r.evaluation_criteria NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb), false)
        WHEN 'client'              THEN coalesce(btrim(r.client_name_snapshot) <> '', false)
        WHEN 'totalBudget'         THEN coalesce(btrim(r.total_budget) <> '', false)
        WHEN 'scopeItems'          THEN true   -- the row's own line is in the record by construction
        WHEN '_magic_token'        THEN NOT EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk WHERE tk.token = e.value #>> '{}')
                                        OR EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk
                                                    WHERE tk.token = e.value #>> '{}' AND tk.org_id = i.lead_org_id
                                                      AND (tk.attached_inbox_id = i.id OR tk.rfp_line_id = i.rfp_line_id))
        ELSE false
      END
    )
),
section2 AS (
  SELECT '2 CHECKS'::text, 'C1 linked rows whose line is missing'::text, NULL::text,
         ((SELECT count(*) FROM public.partner_rfp_inbox i WHERE i.rfp_line_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.id = i.rfp_line_id))
          + (SELECT count(*) FROM public.rfp_magic_tokens t WHERE t.rfp_line_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.rfp_record_lines l WHERE l.id = t.rfp_line_id)))::bigint,
         NULL::bigint, NULL::bigint, 'EXPECTED 0 (120 refuses)'::text
  UNION ALL
  SELECT '2 CHECKS', 'C2 inbox master_rfp_json neither NULL nor an object', NULL,
         (SELECT count(*) FROM public.partner_rfp_inbox i
           WHERE i.master_rfp_json IS NOT NULL AND jsonb_typeof(i.master_rfp_json) <> 'object'),
         NULL, NULL, 'EXPECTED 0 (120 refuses)'
  UNION ALL
  SELECT '2 CHECKS', 'C3 _magic_token rows whose live token is not reachable by link columns', NULL,
         (SELECT count(*) FROM magic_rows m
           WHERE EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk WHERE tk.token = m.marker)
             AND NOT EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk
                              WHERE tk.token = m.marker AND tk.org_id = m.lead_org_id
                                AND (tk.attached_inbox_id = m.id OR (m.rfp_line_id IS NOT NULL AND tk.rfp_line_id = m.rfp_line_id)))),
         NULL, NULL, 'EXPECTED 0 (120 refuses: the marker is the only join for these rows)'
  UNION ALL
  SELECT '2 CHECKS', 'C4 _magic_token rows whose token row no longer exists', NULL,
         (SELECT count(*) FROM magic_rows m WHERE NOT EXISTS (SELECT 1 FROM public.rfp_magic_tokens tk WHERE tk.token = m.marker)),
         NULL, NULL, 'EXPECTED 1: inbox 04391718 (scrubbed; listed in a NOTICE)'
  UNION ALL
  SELECT '2 CHECKS', 'C5 unlinked inbox rows', NULL,
         (SELECT count(*) FROM public.partner_rfp_inbox i WHERE i.rfp_line_id IS NULL),
         NULL, NULL, 'EXPECTED 1: inbox 04391718 (120 refuses any other unlinked row that would lose a key)'
  UNION ALL
  SELECT '2 CHECKS', 'C6 linked rows with a removed key the record does not hold', NULL,
         (SELECT count(DISTINCT id) FROM removed_linked), NULL, NULL,
         coalesce('EXPECTED 0 (120 refuses). Keys: ' || (SELECT string_agg(DISTINCT key, ', ') FROM removed_linked), 'EXPECTED 0 (120 refuses)')
  UNION ALL
  SELECT '2 CHECKS', 'C7 FINDING: linked rows whose estimated_budget is not the released budget', NULL,
         (SELECT count(*) FROM public.partner_rfp_inbox i JOIN public.rfp_record_lines l ON l.id = i.rfp_line_id
           WHERE nullif(btrim(i.estimated_budget), '') IS DISTINCT FROM nullif(btrim(l.released_budget), '')),
         NULL, NULL, 'not changed by 120 (owner decision; see docs/rfp-record-c-report.md)'
  UNION ALL
  SELECT '2 CHECKS', 'C8 FINDING: inbox scope_item_id carrying a token (magic:<token>)', NULL,
         (SELECT count(*) FROM public.partner_rfp_inbox i WHERE i.scope_item_id LIKE 'magic:%'),
         NULL, NULL, 'not changed by 120 (owner decision; see docs/rfp-record-c-report.md)'
  UNION ALL
  SELECT '2 CHECKS', 'C9 FINDING: notifications whose data carries magicToken', NULL,
         (SELECT count(*) FROM public.notifications n WHERE jsonb_typeof(n.data::jsonb) = 'object' AND n.data::jsonb ? 'magicToken'),
         NULL, NULL, 'not changed by 120 (owner decision; see docs/rfp-record-c-report.md)'
)
SELECT section, item, key, rows_total, rows_linked, rows_unlinked, action_120 FROM section1
UNION ALL
SELECT * FROM section2
ORDER BY 1, 2, 3;
