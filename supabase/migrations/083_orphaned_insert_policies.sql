-- =====================================================================
-- Migration 083: the two INSERT policies migration 079 never dropped.
--
--   project_documents  "Users can upload documents to projects they are on"
--   project_messages   "Users can send messages on projects they are on"
--
-- =====================================================================
-- STOP GATE. GREG APPLIES THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- This file is AUTHORED, NOT APPLIED. Nothing in the session that wrote it
-- executed a single statement against any database. It is applied by Greg,
-- by hand, in the Supabase SQL Editor, and only after the pre-flight
-- capture immediately below has been run and its output compared.
--
-- Sequence, in order, no step skipped:
--
--   1. Run the PRE-FLIGHT CAPTURE below. Compare it against what this file
--      says it expects. If it does not match, STOP and regenerate.
--   2. Run this file. Expect "Success. No rows returned".
--   3. Run the VERIFICATION block at the foot of this file. Every query
--      states its expected value. If any one of them disagrees, roll back
--      with 083_orphaned_insert_policies_down.sql.
--   4. Only then, update the migrations table in LIGAMENT_CONTEXT.md.
--
-- =====================================================================
-- WHY THESE TWO POLICIES ARE BROKEN, AND WHY NOTHING RAISED AN ERROR
-- =====================================================================
--
-- Migration 081 created both policies on 2026-08-17, one day before 079
-- was applied. 079 drops 83 policies BY NAME in its PHASE 4 and recreates
-- them in PHASE 10. These two are not among the 83: they did not exist
-- when 079's drop list was written, so 079 never touched them.
--
-- They were nonetheless rewritten, silently, by Postgres itself. A policy
-- body is not stored as text; it is stored as a parsed expression tree
-- referencing columns by attribute number. ALTER TABLE ... RENAME COLUMN
-- updates the name every such tree renders with, and raises nothing,
-- because from Postgres' point of view nothing about the expression
-- changed. So 079's PHASE 5 renames turned:
--
--     p.agency_id   = auth.uid()      into    p.org_id        = auth.uid()
--     pt.partner_id = auth.uid()      into    pt.vendor_org_id = auth.uid()
--
-- Both halves now compare an ORGANIZATION column to a USER id.
--
-- THIS IS NOT A LOCKOUT TODAY. 079's PHASE 2 backfill created one
-- organization per profile with organizations.id = profiles.id, so for all
-- sixteen live accounts the organization id IS the founding user's id and
-- both predicates evaluate exactly as they did before the rename. Every
-- document upload and every message send in production works right now.
--
-- IT BECOMES A LOCKOUT AT THE FIRST SIGNUP. 079's PHASE 12 trigger creates
-- organizations with gen_random_uuid(). For every account created from now
-- on, p.org_id never equals auth.uid() and pt.vendor_org_id never equals
-- auth.uid(). Both EXISTS clauses return false, the whole WITH CHECK
-- returns false, and the caller gets "new row violates row-level security
-- policy" on every attempt to upload a document or send a message. Not a
-- silent empty list: a hard, visible, total failure of two core features,
-- for every new customer, from their first day.
--
-- These are the only two policies in the schema in this state. Verified
-- live against pg_policies: exactly these two, no others.
--
-- =====================================================================
-- WHAT CHANGES, AND WHAT DOES NOT
-- =====================================================================
--
-- ONLY THE IDENTITY COMPARISON. Two expressions in each policy:
--
--     p.org_id         = auth.uid()
--       becomes    p.org_id IN (SELECT public.current_user_org_ids())
--
--     pt.vendor_org_id = auth.uid()
--       becomes    pt.vendor_org_id IN (SELECT public.current_user_org_ids())
--
-- That is the exact rewrite migration 081 predicted for itself. Each of
-- the four sites carries a "079:" marker in 081 naming this substitution.
--
-- EVERY OTHER CLAUSE IS REPRODUCED UNCHANGED, and each one is load-bearing:
--
--   * uploaded_by = auth.uid() and sender_id = auth.uid() survive exactly.
--     These are the ONLY thing stopping a caller attributing a write to a
--     colleague, and under the organization model they become MORE
--     important, not less: membership now makes every colleague satisfy
--     the project half of the predicate identically, so per-person
--     attribution is the only per-person check left in the policy.
--     NOTE they are compared to auth.uid() and MUST STAY THAT WAY. They
--     are person columns, not organization columns. Rewriting them through
--     current_user_org_ids() would be the same category error this
--     migration exists to correct, pointing the other way.
--
--   * The assignment_id-belongs-to-the-same-project EXISTS clause survives
--     byte-for-byte on both tables. It closes a second, distinct hole: the
--     partner SELECT policy for visibility = 'assignment' matches on
--     assignment_id ALONE, so a row pairing a project the caller may write
--     to with an assignment id from a project they may not is a document
--     or message surfaced to a vendor on a project it was never filed
--     against.
--
--   * The vendor branch on project_messages stays scoped on project_id
--     rather than assignment_id, for the reason 081 records: the messages
--     route permits a vendor to post a project-level message with
--     assignment_id NULL, and scoping on assignment_id would break it.
--
--   * AS PERMISSIVE, FOR INSERT, TO authenticated: unchanged on both.
--     TO authenticated matters here for a reason specific to 079: EXECUTE
--     on current_user_org_ids() is REVOKED FROM PUBLIC and granted only to
--     authenticated (079 PHASE 3). A policy granted TO public that called
--     it would raise "permission denied for function" for an anon request
--     instead of simply matching no rows. Both policies are already TO
--     authenticated and stay that way.
--
-- =====================================================================
-- IS THIS A WIDENING? NO. THE ARGUMENT, STATED.
-- =====================================================================
--
-- current_user_org_ids() is an AUTHORITY set, not a visibility set. Its
-- body is `SELECT m.org_id FROM public.org_members m WHERE m.user_id =
-- auth.uid()` and nothing else. It can never contain an organization the
-- caller is not a member of. It is emphatically NOT
-- current_user_counterparty_org_ids() or current_user_visible_profile_ids(),
-- either of which on a write path would let a vendor insert into an
-- agency's project merely by being partnered with it.
--
-- TODAY THE REWRITE IS EXACTLY EQUAL. Every live account belongs to
-- exactly one organization (079 PHASE 2 inserts one org_members row per
-- profile) and that organization's id equals the account's user id. So
-- `org_id IN (SELECT current_user_org_ids())` and `org_id = auth.uid()`
-- select the identical set for every one of the sixteen accounts. No
-- existing user gains or loses a single row.
--
-- GOING FORWARD it grants the same access to a second member of the same
-- organization. That is not an incidental widening: it is the ruled model
-- 079 implements, and it is the identical predicate all 81 policies 079
-- rewrote already use. Leaving `= auth.uid()` in place is not the narrower
-- option, it is the broken one - it denies the founder too.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. RUN THIS FIRST. READ-ONLY.
-- =====================================================================
--
-- P1. Both policy names must appear EXACTLY as spelled in the DROPs below.
--     This file uses plain DROP POLICY with NO IF EXISTS, matching the
--     deliberate convention of 079 and 081. The reason is specific and it
--     is not style: DROP and CREATE share one transaction, so a name that
--     does not match would leave the new policy created BESIDE the old
--     one. RLS policies are OR-ed. The exposure would survive a fix that
--     reported success. Without IF EXISTS a stale name raises and the
--     whole transaction aborts, which is the outcome we want.
--
--   SELECT tablename, policyname, cmd, roles, permissive, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('project_documents', 'project_messages')
--     AND cmd = 'INSERT'
--   ORDER BY tablename;
--
--   EXPECT exactly 2 rows:
--     project_documents | Users can upload documents to projects they are on | INSERT | {authenticated} | PERMISSIVE
--     project_messages  | Users can send messages on projects they are on    | INSERT | {authenticated} | PERMISSIVE
--
--   AND, in with_check, EXPECT to see `p.org_id = auth.uid()` and
--   `pt.vendor_org_id = auth.uid()`. If you instead see `agency_id` or
--   `partner_id`, migration 079 is NOT applied to this database and this
--   file must not be run. If you see current_user_org_ids() already, this
--   migration has already been applied.
--
-- P2. The two totals this migration must not move.
--
--   SELECT tablename, count(*) FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('project_documents','project_messages')
--   GROUP BY tablename ORDER BY tablename;
--
--   EXPECT project_documents 5, project_messages 4.
--
-- P3. The schema-wide total, recorded so the after-count can be compared
--     to it rather than to a number from a document.
--
--   SELECT count(*) AS policies_before FROM pg_policies WHERE schemaname='public';
--
--   EXPECT 108. READ THIS BEFORE TRUSTING THAT NUMBER: 108 is the figure
--   the 079 runbook derives for 079-applied-and-nothing-else (104 before,
--   minus 83 dropped, plus 81 replacements, plus 6 on the two new tables).
--   Migration 080 adds 3 more, giving 111, and 082 may add more again.
--   THE INVARIANT THIS MIGRATION MUST SATISFY IS NOT "the number is 108".
--   It is "the number after equals the number before", because 083 drops
--   two policies and creates two. Write down whatever P3 returns and
--   compare V3 to THAT.
--
-- P4. The helper this file depends on exists and is callable.
--
--   SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname = 'current_user_org_ids';
--
--   EXPECT 1 row, prosecdef = t, provolatile = 's',
--   proconfig = {"search_path=public, pg_temp"}, and proacl containing
--   authenticated=X/ . If this returns 0 rows, 079 is not applied. STOP.
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- project_documents
-- ---------------------------------------------------------------------
-- No IF EXISTS. A stale name must abort the transaction, not silently pass
-- and leave the replacement OR-ed beside the original.
DROP POLICY "Users can upload documents to projects they are on" ON public.project_documents;

CREATE POLICY "Users can upload documents to projects they are on"
  ON public.project_documents
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- PRESERVED. You may only file a document in your own name. This is a
    -- PERSON column and stays compared to auth.uid().
    uploaded_by = auth.uid()

    AND (
      -- The lead agency that owns the project.
      -- 083: was `p.org_id = auth.uid()`, which after 079's rename compared
      --      an organization column to a user id.
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_documents.project_id
          AND p.org_id IN (SELECT public.current_user_org_ids())
      )

      -- Or a vendor assigned to that project through one of their own
      -- partnerships.
      -- 083: was `pt.vendor_org_id = auth.uid()`, same defect.
      OR EXISTS (
        SELECT 1
        FROM public.project_assignments pa
        JOIN public.partnerships pt ON pt.id = pa.partnership_id
        WHERE pa.project_id = project_documents.project_id
          AND pt.vendor_org_id IN (SELECT public.current_user_org_ids())
      )
    )

    -- PRESERVED, unchanged. The assignment, when named, belongs to the same
    -- project. Without this a row can pair a project the caller may write
    -- to with an assignment id from a project they may not, and the partner
    -- SELECT policy for visibility = 'assignment' matches on assignment_id
    -- alone.
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
    -- PRESERVED. You may only send in your own name. PERSON column, stays
    -- compared to auth.uid().
    sender_id = auth.uid()

    AND (
      -- The lead agency that owns the project.
      -- 083: was `p.org_id = auth.uid()`.
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_messages.project_id
          AND p.org_id IN (SELECT public.current_user_org_ids())
      )

      -- Or a vendor assigned to that project. PRESERVED as scoped on
      -- project_id rather than assignment_id: the messages route permits a
      -- vendor to post a project-level message with assignment_id NULL
      -- (app/api/projects/[id]/messages/route.ts), and scoping on
      -- assignment_id alone would break that path.
      -- 083: was `pt.vendor_org_id = auth.uid()`.
      OR EXISTS (
        SELECT 1
        FROM public.project_assignments pa
        JOIN public.partnerships pt ON pt.id = pa.partnership_id
        WHERE pa.project_id = project_messages.project_id
          AND pt.vendor_org_id IN (SELECT public.current_user_org_ids())
      )
    )

    -- PRESERVED, unchanged. The partner SELECT policy on this table matches
    -- on assignment_id alone, so a mismatched pair is a message delivered
    -- to a vendor on a project it was never sent to.
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
-- VERIFICATION. Read-only. Run every one of these after COMMIT.
-- Each states its expected value. Any disagreement means roll back with
-- 083_orphaned_insert_policies_down.sql.
-- =====================================================================
--
-- V1. THE ONE THAT MATTERS MOST. Exactly ONE INSERT policy per table.
--     If a DROP had matched nothing, there would now be two, they would be
--     OR-ed, and the broken predicate would still be live behind a fix that
--     reported success. (Without IF EXISTS this cannot happen silently -
--     but verify it anyway, because that is the whole point of the file.)
--
--   SELECT tablename, count(*) AS insert_policies
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('project_documents', 'project_messages')
--     AND cmd = 'INSERT'
--   GROUP BY tablename
--   ORDER BY tablename;
--
--   EXPECT exactly 2 rows, each with insert_policies = 1:
--     project_documents | 1
--     project_messages  | 1
--
-- V2. Per-table totals are unchanged. Two dropped, two created.
--
--   SELECT tablename, count(*) AS total_policies
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('project_documents', 'project_messages')
--   GROUP BY tablename
--   ORDER BY tablename;
--
--   EXPECT:
--     project_documents | 5
--     project_messages  | 4
--
-- V3. The schema-wide total is unchanged.
--
--   SELECT count(*) AS policies_after FROM pg_policies WHERE schemaname='public';
--
--   EXPECT 108, AND MORE IMPORTANTLY expect exactly the number P3 returned
--   before applying. If P3 returned 111 because migration 080 is applied,
--   then 111 is the correct answer here and 108 is the wrong one. The
--   invariant is equality with P3, not the literal 108.
--
-- V4. The identity comparison is gone and the helper call is present, on
--     both policies. This is the substantive check: V1 to V3 only count.
--
--   SELECT tablename, policyname, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('project_documents', 'project_messages')
--     AND cmd = 'INSERT'
--   ORDER BY tablename;
--
--   EXPECT, in BOTH with_check bodies:
--     * `current_user_org_ids()` appears TWICE.
--     * NEITHER `p.org_id = auth.uid()` NOR `pt.vendor_org_id = auth.uid()`
--       appears at all.
--     * `uploaded_by = auth.uid()` still appears on project_documents.
--     * `sender_id = auth.uid()` still appears on project_messages.
--     * The assignment_id / project_id EXISTS clause still appears on both.
--
--   The same check as a boolean, if reading two long expressions by eye is
--   not appealing:
--
--   SELECT tablename,
--          with_check LIKE '%current_user_org_ids%'                AS calls_helper,
--          with_check LIKE '%org_id = auth.uid()%'                 AS still_broken_agency,
--          with_check LIKE '%vendor_org_id = auth.uid()%'          AS still_broken_vendor,
--          with_check LIKE '%assignment_id%'                       AS keeps_assignment_check
--   FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('project_documents','project_messages')
--     AND cmd='INSERT'
--   ORDER BY tablename;
--
--   EXPECT calls_helper = true, still_broken_agency = false,
--   still_broken_vendor = false, keeps_assignment_check = true, on both rows.
--
-- V5. No other policy anywhere in the schema still compares an organization
--     column to auth.uid(). This is the assertion that these two were the
--     only ones, re-run as a closing check rather than trusted from a note.
--
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) ~
--         '(org_id|lead_org_id|vendor_org_id)[[:space:]]*=[[:space:]]*auth\.uid\(\)'
--   ORDER BY tablename, policyname;
--
--   EXPECT 0 rows.
--
-- V6. LIVE SMOKE TEST, in the browser, not in SQL. Neither of these is
--     covered by any count above, and both are write paths this policy now
--     governs:
--
--     a. As the lead agency (gmarkant@gmail.com), open a project and upload
--        a document. It saves, with no "new row violates row-level security
--        policy".
--     b. As the vendor (gmarkant@icloud.com), open a project you are
--        assigned to and post a message. It sends.
--
--     If either fails with an RLS violation, the predicate is wrong for a
--     real caller. Roll back with the down migration and fix it there.
-- =====================================================================
