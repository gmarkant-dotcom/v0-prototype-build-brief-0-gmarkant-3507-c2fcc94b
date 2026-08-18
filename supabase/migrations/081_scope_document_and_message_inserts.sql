-- =====================================================================
-- Migration 081: project_documents and project_messages INSERT policies
--                gain the project scoping they have never had.
--
-- =====================================================================
-- APPLIED 2026-08-17 and VERIFIED. This file records what actually ran.
-- =====================================================================
--
-- Two things differ from the version first authored, and both are
-- deliberate:
--
--   1. The two DROP statements are plain `DROP POLICY`, NOT
--      `DROP POLICY IF EXISTS`. The header section "CAPTURE A FRESH
--      pg_policies SNAPSHOT IMMEDIATELY BEFORE APPLYING" below explains
--      why that matters: a DROP that matches nothing REPORTS SUCCESS, and
--      because the DROP and the CREATE share one transaction, a stale name
--      would have left the new scoped policy created BESIDE the old
--      unscoped one. RLS policies are OR-ed, so the exposure would have
--      survived a fix that looked like it worked. Without IF EXISTS a
--      stale name raises and the whole transaction aborts, which is the
--      outcome we want. This is the safer statement, not the sloppier one.
--
--   2. Verification result #3 below previously said project_documents
--      should end with four policies and project_messages with three.
--      That arithmetic was wrong against the 2026-08-13 snapshot, which
--      records five and four. The live counts confirm five and four.
--
-- VERIFICATION RESULTS, observed after COMMIT on 2026-08-17:
--
--   * Both new policy names present; both old names gone.
--   * Exactly ONE INSERT policy on each table. This is check #2, the one
--      that matters, and it passed.
--   * Per-table policy totals: project_documents 5, project_messages 4 -
--      unchanged from the 2026-08-13 snapshot, as expected for a
--      two-dropped / two-created migration.
--   * Schema-wide policy total still 104.
--
-- NOTE FOR THE 079 RELEASE: docs/schema-snapshot-2026-08-13.md still
-- records the two OLD policy bodies for these tables. It is authoritative
-- for everything else and stale for exactly these two rows. The fresh
-- capture taken at the top of docs/079-release-runbook.md supersedes it.
--
-- ---------------------------------------------------------------------
-- THE EXPOSURE THIS CLOSED, STATED PLAINLY (the state before 2026-08-17)
-- ---------------------------------------------------------------------
-- Both tables carry an INSERT policy with NO PROJECT SCOPING AT ALL.
-- From docs/schema-snapshot-2026-08-13.md, the authoritative record:
--
--   project_documents  "Users can upload documents"
--     INSERT  {authenticated}  WITH CHECK (uploaded_by = auth.uid())
--
--   project_messages   "Users can send messages"
--     INSERT  {authenticated}  WITH CHECK (sender_id = auth.uid())
--
-- Read those literally. The ONLY thing either check asserts is that the
-- caller wrote their own id into the row. Neither says anything about the
-- project. So ANY authenticated user on the platform - any vendor, any
-- lead agency, any account that signed up ten seconds ago - can insert a
-- document row or a message row against ANY project id and ANY assignment
-- id, belonging to any customer, simply by naming it.
--
-- What that buys an attacker, concretely:
--
--   * A message row planted into another agency's project, which that
--     agency's own SELECT policy then renders to them as a message on
--     their project. The sender profile is real, so it reads as legitimate
--     traffic inside a workspace the attacker has no other access to.
--   * A document row planted with visibility = 'all_partners', which every
--     vendor assigned to that project can then read - a row pointing at a
--     blob URL the attacker controls.
--   * A row whose assignment_id belongs to a DIFFERENT project than its
--     project_id. The partner SELECT policy on project_documents matches
--     on assignment_id alone when visibility = 'assignment', so a mismatched
--     pair is a document that surfaces to a vendor on a project it was
--     never filed against. This is a second hole, distinct from the first,
--     and it is closed here too.
--
-- The application routes are NOT the reason this has not been exploited.
-- app/api/documents/upload/route.ts and app/api/projects/[id]/messages/route.ts
-- both check project access properly before inserting. But the policy, not
-- the caller, is the permission - and the Supabase anon key plus any
-- authenticated session reaches PostgREST directly, with no route in front
-- of it. This is the same class of defect as an interface-only gate, which
-- this codebase already shipped once this month
-- (docs/admin-security-fix-report.md).
--
-- ---------------------------------------------------------------------
-- WHAT THE FIX CLOSES
-- ---------------------------------------------------------------------
-- After this migration an INSERT succeeds only when the caller is:
--
--   * the lead agency that owns the project, or
--   * a vendor assigned to that project through one of their own
--     partnerships,
--
-- AND, in both cases, the row's assignment_id (when set) belongs to the
-- same project the row names. The predicates below are deliberately the
-- same conditions the two routes already enforce in application code. The
-- routes were right; the database was never told.
--
-- The `uploaded_by = auth.uid()` and `sender_id = auth.uid()` clauses are
-- PRESERVED, not replaced. They are the only thing stopping a caller from
-- attributing their own write to a colleague, and under the organization
-- model that becomes the more important half of the check, not the less.
--
-- ---------------------------------------------------------------------
-- 079 SEAM
-- ---------------------------------------------------------------------
-- Neither table carries a company identity column, so 079 does not rename
-- anything here - both are scoped transitively through a parent. But the
-- policy BODIES below name `projects.agency_id` and `partnerships.partner_id`,
-- and 079 renames both of those. Each occurrence is marked "079:". When
-- 079 lands these two policies must be rewritten in the same release, or
-- every document upload and every message send in the product starts
-- returning 42703.
--
-- ---------------------------------------------------------------------
-- CAPTURE A FRESH pg_policies SNAPSHOT IMMEDIATELY BEFORE APPLYING
-- (done on 2026-08-17; both names matched)
-- ---------------------------------------------------------------------
-- This file DROPS two policies BY THEIR LIVE NAME. Neither name exists
-- anywhere in this repository - docs/schema-baseline-2026-08-13.sql
-- records both as "on disk: NO policy of this name" - so if a DROP here
-- matches nothing, the old permissive policy CANNOT be recreated from any
-- file in this repo, and a DROP that matches nothing reports success.
--
-- Worse in this specific case: the DROP and the CREATE run in one
-- transaction, so a stale name means the new scoped policy is created
-- BESIDE the old unscoped one rather than instead of it. RLS policies are
-- OR-ed together. The exposure would survive the fix and the fix would
-- look like it worked.
--
-- So, before applying:
--
--   SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('project_documents', 'project_messages')
--   ORDER BY tablename, policyname;
--
-- Confirm the two names below appear EXACTLY as written. If either has
-- been renamed or removed since 2026-08-13, stop and regenerate this file
-- from the fresh capture.
--
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- project_documents
-- ---------------------------------------------------------------------
DROP POLICY "Users can upload documents" ON public.project_documents;  -- no IF EXISTS: a stale name must abort, not silently pass

CREATE POLICY "Users can upload documents to projects they are on"
  ON public.project_documents
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Preserved from the old policy: you may only file a document in your
    -- own name.
    uploaded_by = auth.uid()

    AND (
      -- The lead agency that owns the project.
      -- 079: projects.agency_id becomes projects.org_id, and the comparison
      --      becomes `p.org_id = ANY (public.current_user_org_ids())`.
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_documents.project_id
          AND p.agency_id = auth.uid()
      )

      -- Or a vendor assigned to that project through one of their own
      -- partnerships.
      -- 079: partnerships.partner_id becomes partnerships.vendor_org_id, and
      --      the comparison becomes
      --      `pt.vendor_org_id = ANY (public.current_user_org_ids())`.
      OR EXISTS (
        SELECT 1
        FROM public.project_assignments pa
        JOIN public.partnerships pt ON pt.id = pa.partnership_id
        WHERE pa.project_id = project_documents.project_id
          AND pt.partner_id = auth.uid()
      )
    )

    -- And the assignment, when named, belongs to the same project. Without
    -- this, a row can pair a project the caller may write to with an
    -- assignment id from a project they may not, and the partner SELECT
    -- policy for visibility = 'assignment' matches on assignment_id alone.
    AND (
      project_documents.assignment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.project_assignments pa2
        WHERE pa2.id = project_documents.assignment_id
          AND pa2.project_id = project_documents.project_id
      )
    )
  );

-- ---------------------------------------------------------------------
-- project_messages
-- ---------------------------------------------------------------------
DROP POLICY "Users can send messages" ON public.project_messages;  -- no IF EXISTS: a stale name must abort, not silently pass

CREATE POLICY "Users can send messages on projects they are on"
  ON public.project_messages
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Preserved from the old policy: you may only send in your own name.
    sender_id = auth.uid()

    AND (
      -- The lead agency that owns the project.
      -- 079: p.agency_id -> p.org_id, compared through current_user_org_ids().
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_messages.project_id
          AND p.agency_id = auth.uid()
      )

      -- Or a vendor assigned to that project. Scoped on project_id rather
      -- than assignment_id, because the messages route permits a vendor to
      -- post a project-level message with assignment_id NULL
      -- (app/api/projects/[id]/messages/route.ts) and scoping on
      -- assignment_id alone would break that path.
      -- 079: pt.partner_id -> pt.vendor_org_id, compared through
      --      current_user_org_ids().
      OR EXISTS (
        SELECT 1
        FROM public.project_assignments pa
        JOIN public.partnerships pt ON pt.id = pa.partnership_id
        WHERE pa.project_id = project_messages.project_id
          AND pt.partner_id = auth.uid()
      )
    )

    -- And the assignment, when named, belongs to the same project. The
    -- partner SELECT policy on this table matches on assignment_id alone,
    -- so a mismatched pair is a message delivered to a vendor on a project
    -- it was never sent to.
    AND (
      project_messages.assignment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.project_assignments pa2
        WHERE pa2.id = project_messages.assignment_id
          AND pa2.project_id = project_messages.project_id
      )
    )
  );

COMMIT;

-- =====================================================================
-- VERIFICATION. Run each of these after COMMIT. Expected results stated.
-- =====================================================================
--
-- 1. The old unscoped policies are GONE and exactly one INSERT policy per
--    table remains. Expect 2 rows, both with the new names, and neither
--    with_check equal to a bare `uploaded_by = auth.uid()` or
--    `sender_id = auth.uid()`.
--
--    SELECT tablename, policyname, cmd, roles, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('project_documents', 'project_messages')
--      AND cmd = 'INSERT'
--    ORDER BY tablename;
--
-- 2. THE ONE THAT MATTERS. If a stale name meant the DROP matched nothing,
--    the table now has TWO INSERT policies, they are OR-ed, and the
--    exposure is untouched. Expect exactly 1 for each table.
--
--    SELECT tablename, count(*) AS insert_policies
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('project_documents', 'project_messages')
--      AND cmd = 'INSERT'
--    GROUP BY tablename;
--
-- 3. Nothing else on these two tables changed. Expect the same SELECT,
--    UPDATE and DELETE policies as the 2026-08-13 snapshot: four more on
--    project_documents (two SELECT, one UPDATE, one DELETE), so FIVE in
--    total, and three more on project_messages (two SELECT, one UPDATE),
--    so FOUR in total. OBSERVED 2026-08-17: 5 and 4. Pass.
--
--    SELECT tablename, cmd, count(*)
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('project_documents', 'project_messages')
--    GROUP BY tablename, cmd
--    ORDER BY tablename, cmd;
--
-- 4. Total policy count across the schema is UNCHANGED by this migration -
--    two dropped, two created. Expect the same number as before applying.
--
--    SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- 5. Live smoke test, in the browser, not in SQL. Both are write paths the
--    policy now governs and neither is covered by the counts above:
--      a. As the lead agency, upload a document to a project. It saves.
--      b. As a vendor assigned to a project, post a message on it. It sends.
--    If either returns "new row violates row-level security policy", the
--    predicate is wrong for a real caller and the old policy must be
--    restored from the header of this file while it is fixed.
-- =====================================================================
