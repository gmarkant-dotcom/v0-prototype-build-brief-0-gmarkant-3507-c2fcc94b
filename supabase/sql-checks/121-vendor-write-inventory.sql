-- =====================================================================
-- 121 VENDOR WRITE INVENTORY. ONE READ-ONLY QUERY, ONE RESULT SET. RUN BEFORE ANY 121 PRE-APPLY TEST.
--
-- AUTHORED 2026-11-06 on feat/121-vendor-write-guards (unattended run). NOT RUN: no database access
-- in the authoring session. It writes nothing (no TEMP table, no function, no DDL), so a failed run
-- costs nothing and the error names the line. Paste the whole file into the Supabase SQL Editor
-- (role postgres) and Run. Export the grid. docs/121-vendor-write-guards-report.md explains each row.
--
-- WHY. The 121 build STOPPED at step 0 (report section 2). The owner's rulings on S1-S3 depend on
-- what the live rows look like. This query answers, for partner_rfp_responses and delivery_reviews:
-- do any rows carry agency-owned values that look vendor-written, and what policies, triggers and
-- grants are live today.
--
-- READ THE ROWS (columns: section, item, expected, value, detail)
--   1 SUMMARY      legacy score/summary columns on partner_rfp_responses (110 nulls and guards them)
--                  and rows of partner_rfp_response_private (109)                       L1 EXPECTED 0
--   2 RESPONSES    agency-owned values on partner_rfp_responses that look vendor-written:
--     R1 lead_org_id differs from its inbox row's lead_org_id (a repointed bid)          EXPECTED 0
--     R2 guest bid (no inbox row) whose lead_org_id differs from its token's org_id      EXPECTED 0
--     R3 vendor_org_id differs from its inbox row's vendor_org_id (both set)             EXPECTED 0
--     R4 status 'awarded' with no project_assignments row for the bid's partnership
--        and project (the agency award route writes one)                                 expected 0
--     R5 agency_feedback set but feedback_updated_at NULL (the agency route stamps both) expected 0
--     R6 status shortlisted / meeting_requested / declined with its own *_at NULL
--        and created after 069 (2026-08; the agency route stamps the time)               count only
--     R7 status 'draft' but shortlisted_at or meeting_requested_at set: an agency
--        decision demoted by a vendor save (the S1 finding, autosave sends 'draft')      count only
--     R8 status 'submitted' but shortlisted_at or meeting_requested_at set and
--        declined_at NULL: a shortlist reset by a vendor revision (S1)                   count only
--     R9 status 'under_review' (no route in the code writes it)                          count only
--     RS one row per status value, with counts                                           record
--   3 REVIEWS      delivery_reviews whose shape breaks what the agency route writes:
--     D1 org_id is not the partnership's lead_org_id                                     EXPECTED 0
--     D2 org_id is not the project's org_id                                              EXPECTED 0
--     D3 org_id is an organization that is the VENDOR side of the review's partnership   EXPECTED 0
--     D4 response_id set, and that bid's lead_org_id is not the review's org_id          EXPECTED 0
--     D5 response_id set, and that bid's vendor_org_id is not the partnership's vendor   expected 0
--     D6 assignment_id set, and that assignment is on another project or partnership     EXPECTED 0
--     D7 no project_assignments row for (project_id, partnership_id): the route allows
--        it (assignment_id NULL); the "real engagement" question, S3                     count only
--   4 POLICIES     one row per policy on the two tables (cmd, roles, USING, WITH CHECK)  record
--     P0 public policy total                                                             EXPECTED 161
--   5 TRIGGERS     one row per non-internal trigger on the two tables (tgenabled::text)   record
--   6 GRANTS       table privileges of anon, authenticated, service_role on the two tables record
-- =====================================================================

WITH
resp AS (
  SELECT r.id, r.lead_org_id, r.vendor_org_id, r.inbox_item_id, r.status, r.agency_feedback,
         r.feedback_updated_at, r.shortlisted_at, r.meeting_requested_at, r.declined_at, r.created_at,
         i.lead_org_id AS inbox_lead, i.vendor_org_id AS inbox_vendor, i.project_id AS inbox_project
  FROM public.partner_rfp_responses r
  LEFT JOIN public.partner_rfp_inbox i ON i.id = r.inbox_item_id
),
guest AS (
  SELECT r.id, r.lead_org_id, t.org_id AS token_org, t.project_id AS token_project
  FROM public.partner_rfp_responses r
  JOIN public.rfp_magic_tokens t ON t.response_id = r.id
  WHERE r.inbox_item_id IS NULL
),
award AS (
  SELECT r.id,
         EXISTS (SELECT 1 FROM public.partnerships p
                 JOIN public.project_assignments pa ON pa.partnership_id = p.id
                 WHERE p.lead_org_id = r.lead_org_id
                   AND p.vendor_org_id = r.vendor_org_id
                   AND pa.project_id = COALESCE(r.inbox_project,
                                                (SELECT g.token_project FROM guest g WHERE g.id = r.id))) AS has_assignment
  FROM resp r
  WHERE r.status = 'awarded'
),
rows_out AS (
  -- 1 SUMMARY
  SELECT 1 AS s, '1 SUMMARY' AS section, 'L1 legacy score/summary non-null on partner_rfp_responses' AS item, '0' AS expected,
         (SELECT count(*) FROM public.partner_rfp_responses
           WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
              OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL)::text AS value,
         '110 guard refuses any non-null value for every caller' AS detail
  UNION ALL
  SELECT 1, '1 SUMMARY', 'L2 partner_rfp_response_private rows', 'record',
         (SELECT count(*) FROM public.partner_rfp_response_private)::text,
         'summaries present: ' || (SELECT count(*) FROM public.partner_rfp_response_private WHERE ai_summary_generated_at IS NOT NULL)::text
         || '; scores present: ' || (SELECT count(*) FROM public.partner_rfp_response_private WHERE composite_score IS NOT NULL)::text
  UNION ALL
  SELECT 1, '1 SUMMARY', 'L3 responses with no private row (summary pending)', 'record',
         (SELECT count(*) FROM public.partner_rfp_responses r
           WHERE NOT EXISTS (SELECT 1 FROM public.partner_rfp_response_private n WHERE n.response_id = r.id))::text,
         'pending under ruling S-A until the agency generates it'

  -- 2 RESPONSES
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R1 lead_org_id differs from inbox lead_org_id', '0',
         (SELECT count(*) FROM resp WHERE inbox_item_id IS NOT NULL AND inbox_lead IS DISTINCT FROM lead_org_id)::text,
         COALESCE((SELECT string_agg(left(id::text, 8), ' ' ORDER BY id) FROM resp
                    WHERE inbox_item_id IS NOT NULL AND inbox_lead IS DISTINCT FROM lead_org_id), '')
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R2 guest bid lead_org_id differs from token org_id', '0',
         (SELECT count(*) FROM guest WHERE token_org IS DISTINCT FROM lead_org_id)::text,
         COALESCE((SELECT string_agg(left(id::text, 8), ' ' ORDER BY id) FROM guest WHERE token_org IS DISTINCT FROM lead_org_id), '')
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R3 vendor_org_id differs from inbox vendor_org_id', '0',
         (SELECT count(*) FROM resp WHERE inbox_vendor IS NOT NULL AND vendor_org_id IS NOT NULL AND inbox_vendor <> vendor_org_id)::text,
         COALESCE((SELECT string_agg(left(id::text, 8), ' ' ORDER BY id) FROM resp
                    WHERE inbox_vendor IS NOT NULL AND vendor_org_id IS NOT NULL AND inbox_vendor <> vendor_org_id), '')
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R4 awarded with no project_assignments row', '0',
         (SELECT count(*) FROM award WHERE NOT has_assignment)::text,
         COALESCE((SELECT string_agg(left(id::text, 8), ' ' ORDER BY id) FROM award WHERE NOT has_assignment), '')
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R5 agency_feedback set, feedback_updated_at NULL', '0',
         (SELECT count(*) FROM resp WHERE agency_feedback IS NOT NULL AND feedback_updated_at IS NULL)::text,
         COALESCE((SELECT string_agg(left(id::text, 8), ' ' ORDER BY id) FROM resp
                    WHERE agency_feedback IS NOT NULL AND feedback_updated_at IS NULL), '')
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R6 agency status without its own timestamp (created after 2026-09-01)', 'count only',
         (SELECT count(*) FROM resp
           WHERE created_at >= '2026-09-01'
             AND ((status = 'shortlisted' AND shortlisted_at IS NULL)
               OR (status = 'meeting_requested' AND meeting_requested_at IS NULL)
               OR (status = 'declined' AND declined_at IS NULL)))::text,
         '069 has no backfill; older rows are expected to lack the timestamp'
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R7 draft but shortlisted_at or meeting_requested_at set', 'count only',
         (SELECT count(*) FROM resp WHERE status = 'draft' AND (shortlisted_at IS NOT NULL OR meeting_requested_at IS NOT NULL))::text,
         COALESCE((SELECT string_agg(left(id::text, 8), ' ' ORDER BY id) FROM resp
                    WHERE status = 'draft' AND (shortlisted_at IS NOT NULL OR meeting_requested_at IS NOT NULL)), '')
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R8 submitted but shortlisted_at or meeting_requested_at set, not declined', 'count only',
         (SELECT count(*) FROM resp WHERE status = 'submitted' AND declined_at IS NULL
             AND (shortlisted_at IS NOT NULL OR meeting_requested_at IS NOT NULL))::text,
         COALESCE((SELECT string_agg(left(id::text, 8), ' ' ORDER BY id) FROM resp
                    WHERE status = 'submitted' AND declined_at IS NULL
                      AND (shortlisted_at IS NOT NULL OR meeting_requested_at IS NOT NULL)), '')
  UNION ALL
  SELECT 2, '2 RESPONSES', 'R9 status under_review', 'count only',
         (SELECT count(*) FROM resp WHERE status = 'under_review')::text, 'no route in the repository writes under_review'
  UNION ALL
  SELECT 2, '2 RESPONSES', 'RS status ' || COALESCE(status, '(null)'), 'record', count(*)::text, ''
  FROM public.partner_rfp_responses GROUP BY status

  -- 3 REVIEWS
  UNION ALL
  SELECT 3, '3 REVIEWS', 'D1 org_id is not the partnership lead_org_id', '0',
         (SELECT count(*) FROM public.delivery_reviews d JOIN public.partnerships p ON p.id = d.partnership_id
           WHERE p.lead_org_id IS DISTINCT FROM d.org_id)::text, ''
  UNION ALL
  SELECT 3, '3 REVIEWS', 'D2 org_id is not the project org_id', '0',
         (SELECT count(*) FROM public.delivery_reviews d JOIN public.projects pr ON pr.id = d.project_id
           WHERE pr.org_id IS DISTINCT FROM d.org_id)::text, ''
  UNION ALL
  SELECT 3, '3 REVIEWS', 'D3 org_id is the vendor side of the partnership', '0',
         (SELECT count(*) FROM public.delivery_reviews d JOIN public.partnerships p ON p.id = d.partnership_id
           WHERE p.vendor_org_id = d.org_id)::text, ''
  UNION ALL
  SELECT 3, '3 REVIEWS', 'D4 response_id bid led by another organization', '0',
         (SELECT count(*) FROM public.delivery_reviews d JOIN public.partner_rfp_responses r ON r.id = d.response_id
           WHERE r.lead_org_id IS DISTINCT FROM d.org_id)::text, ''
  UNION ALL
  SELECT 3, '3 REVIEWS', 'D5 response_id bid of another vendor than the partnership', '0',
         (SELECT count(*) FROM public.delivery_reviews d
            JOIN public.partner_rfp_responses r ON r.id = d.response_id
            JOIN public.partnerships p ON p.id = d.partnership_id
           WHERE r.vendor_org_id IS NOT NULL AND r.vendor_org_id IS DISTINCT FROM p.vendor_org_id)::text, ''
  UNION ALL
  SELECT 3, '3 REVIEWS', 'D6 assignment_id on another project or partnership', '0',
         (SELECT count(*) FROM public.delivery_reviews d JOIN public.project_assignments pa ON pa.id = d.assignment_id
           WHERE pa.project_id IS DISTINCT FROM d.project_id OR pa.partnership_id IS DISTINCT FROM d.partnership_id)::text, ''
  UNION ALL
  SELECT 3, '3 REVIEWS', 'D7 no project_assignments row for (project_id, partnership_id)', 'count only',
         (SELECT count(*) FROM public.delivery_reviews d
           WHERE NOT EXISTS (SELECT 1 FROM public.project_assignments pa
                              WHERE pa.project_id = d.project_id AND pa.partnership_id = d.partnership_id))::text,
         'of ' || (SELECT count(*) FROM public.delivery_reviews)::text || ' reviews'

  -- 4 POLICIES
  UNION ALL
  SELECT 4, '4 POLICIES', 'P0 public policy total', '161', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::text, ''
  UNION ALL
  SELECT 4, '4 POLICIES', p.tablename || ' | ' || p.policyname, p.cmd || ' ' || p.roles::text,
         p.permissive,
         'USING ' || COALESCE(p.qual, '(none)') || ' || WITH CHECK ' || COALESCE(p.with_check, '(none)')
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename IN ('partner_rfp_responses', 'delivery_reviews', 'partner_rfp_response_private')

  -- 5 TRIGGERS
  UNION ALL
  SELECT 5, '5 TRIGGERS', c.relname || ' | ' || t.tgname, 'record', t.tgenabled::text,
         'function ' || t.tgfoid::regproc::text || '; before ' || ((t.tgtype & 2) = 2)::text
         || '; insert ' || ((t.tgtype & 4) = 4)::text || '; update ' || ((t.tgtype & 16) = 16)::text
         || '; delete ' || ((t.tgtype & 8) = 8)::text
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
    AND c.relname IN ('partner_rfp_responses', 'delivery_reviews', 'partner_rfp_response_private')

  -- 6 GRANTS
  UNION ALL
  SELECT 6, '6 GRANTS', g.t || ' | ' || g.r, 'record',
         'S' || has_table_privilege(g.r, g.t, 'SELECT')::text || ' I' || has_table_privilege(g.r, g.t, 'INSERT')::text
         || ' U' || has_table_privilege(g.r, g.t, 'UPDATE')::text || ' D' || has_table_privilege(g.r, g.t, 'DELETE')::text,
         'TRUNCATE ' || has_table_privilege(g.r, g.t, 'TRUNCATE')::text || ' REFERENCES ' || has_table_privilege(g.r, g.t, 'REFERENCES')::text
         || ' TRIGGER ' || has_table_privilege(g.r, g.t, 'TRIGGER')::text
  FROM unnest(ARRAY['public.partner_rfp_responses', 'public.delivery_reviews']) AS g0(t)
  CROSS JOIN LATERAL unnest(ARRAY['anon', 'authenticated', 'service_role']) AS g1(r)
  CROSS JOIN LATERAL (SELECT g0.t AS t, g1.r AS r) AS g
)
SELECT section, item, expected, value, detail
FROM rows_out
ORDER BY s, item;
