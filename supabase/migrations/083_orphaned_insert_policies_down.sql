-- =====================================================================
-- Migration 083 DOWN: restore the two INSERT policies to the state
-- migration 083 found them in.
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- Run this ONLY if a verification query in 083_orphaned_insert_policies.sql
-- disagreed with its stated expectation, or if the V6 live smoke test
-- returned "new row violates row-level security policy" for a real caller.
--
-- =====================================================================
-- READ THIS BEFORE RUNNING IT. WHAT THIS RESTORES IS BROKEN.
-- =====================================================================
--
-- This down migration recreates the predicate exactly as 079's PHASE 5
-- column rename left it:
--
--     p.org_id         = auth.uid()
--     pt.vendor_org_id = auth.uid()
--
-- Both compare an ORGANIZATION column to a USER id. That state is correct
-- by coincidence for the sixteen accounts 079 backfilled, whose
-- organization id equals their founding user's id, and it locks out every
-- account created by the PHASE 12 trigger from its first day, because
-- those organizations carry gen_random_uuid().
--
-- So rolling back is NOT returning to a good state. It is returning to the
-- state that made 083 necessary, which is the right thing to do if 083
-- turned out to be worse, and the wrong thing to leave in place. If you run
-- this, the fix is still owed.
--
-- The alternative to rolling back, if 083's predicate is merely too narrow
-- for one real caller rather than wrong: fix that clause in 083 and re-run
-- it. The DROP in 083 will match the name it created, so re-running is
-- clean. Prefer that.
--
-- =====================================================================
-- WHAT THIS DOES NOT DO
-- =====================================================================
--
-- It does NOT restore the pre-081 policies ("Users can upload documents"
-- and "Users can send messages", with_check `uploaded_by = auth.uid()` and
-- `sender_id = auth.uid()` alone). Those had no project scoping whatsoever
-- and let any authenticated account on the platform plant a document or a
-- message into any customer's project by naming its id. Migration 081
-- closed that and this file does not reopen it. Everything except the two
-- identity comparisons stays as 081 wrote it.
--
-- The policy names are unchanged by 083, so this down migration drops the
-- same two names 083 created.
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- project_documents
-- ---------------------------------------------------------------------
-- No IF EXISTS, same reasoning as the up migration: a name that does not
-- match must abort the transaction rather than leave two OR-ed policies.
DROP POLICY "Users can upload documents to projects they are on" ON public.project_documents;

CREATE POLICY "Users can upload documents to projects they are on"
  ON public.project_documents
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()

    AND (
      -- RESTORED TO THE BROKEN FORM. See the header.
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_documents.project_id
          AND p.org_id = auth.uid()
      )

      -- RESTORED TO THE BROKEN FORM. See the header.
      OR EXISTS (
        SELECT 1
        FROM public.project_assignments pa
        JOIN public.partnerships pt ON pt.id = pa.partnership_id
        WHERE pa.project_id = project_documents.project_id
          AND pt.vendor_org_id = auth.uid()
      )
    )

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
DROP POLICY "Users can send messages on projects they are on" ON public.project_messages;

CREATE POLICY "Users can send messages on projects they are on"
  ON public.project_messages
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()

    AND (
      -- RESTORED TO THE BROKEN FORM. See the header.
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_messages.project_id
          AND p.org_id = auth.uid()
      )

      -- RESTORED TO THE BROKEN FORM. See the header.
      OR EXISTS (
        SELECT 1
        FROM public.project_assignments pa
        JOIN public.partnerships pt ON pt.id = pa.partnership_id
        WHERE pa.project_id = project_messages.project_id
          AND pt.vendor_org_id = auth.uid()
      )
    )

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
-- VERIFICATION after the rollback. Read-only.
-- =====================================================================
--
-- D1. Still exactly one INSERT policy per table.
--
--   SELECT tablename, count(*) AS insert_policies
--   FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('project_documents','project_messages')
--     AND cmd='INSERT'
--   GROUP BY tablename ORDER BY tablename;
--
--   EXPECT project_documents 1, project_messages 1.
--
-- D2. Per-table totals unchanged.
--
--   SELECT tablename, count(*) FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('project_documents','project_messages')
--   GROUP BY tablename ORDER BY tablename;
--
--   EXPECT project_documents 5, project_messages 4.
--
-- D3. Schema-wide total equals whatever P3 recorded before 083 was applied.
--
--   SELECT count(*) FROM pg_policies WHERE schemaname='public';
--
-- D4. The helper call is gone and the broken comparison is back. This
--     confirms the rollback actually took effect rather than reporting
--     success against an unchanged policy.
--
--   SELECT tablename,
--          with_check LIKE '%current_user_org_ids%' AS calls_helper,
--          with_check LIKE '%org_id = auth.uid()%'  AS broken_form_restored
--   FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('project_documents','project_messages')
--     AND cmd='INSERT'
--   ORDER BY tablename;
--
--   EXPECT calls_helper = false and broken_form_restored = true on both.
--   That is the rollback succeeding, and it is also a defect back in
--   production. The fix is still owed.
-- =====================================================================
