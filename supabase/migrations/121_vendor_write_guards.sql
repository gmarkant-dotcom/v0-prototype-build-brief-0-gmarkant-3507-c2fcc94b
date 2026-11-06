-- =====================================================================
-- 121. VENDOR WRITE GUARDS: partner_rfp_responses (V1) AND delivery_reviews (ruling b).
--
-- AUTHORED 2026-11-06 on feat/121-vendor-write-guards (unattended run). NOT APPLIED. NOT RUN: there
-- is no Postgres and no credentials in the authoring session. The pre-apply test
-- (121_preapply_test.sql) is also the parse check. OWNER-RUN, in the Supabase SQL Editor.
-- Report: docs/121-vendor-write-guards-report.md (step 0, step 0 round 2, the build).
--
-- WHAT IT CLOSES (V1, open in production). The vendor's UPDATE policy on partner_rfp_responses,
-- "Partners update own RFP responses" (079:1414-1416), has no WITH CHECK beyond vendor_org_id and no
-- column limit. Through raw PostgREST a vendor can repoint lead_org_id or inbox_item_id (injecting
-- its bid into another agency's list), set status = 'awarded', rewrite agency_feedback and the 069
-- action timestamps. Its INSERT policy (079:1389-1404) ties the link columns but takes any status,
-- feedback or timestamp.
--
-- OWNER RULINGS (2026-11-06)
--   S1 = B + C. A vendor's edit never changes a status the agency set.
--     draft, submitted                 the vendor moves only between draft and submitted.
--     under_review (Changes Requested) a resubmission (status 'submitted') moves it to submitted;
--                                      any other vendor save keeps under_review.
--     shortlisted, meeting_requested   the content edit is accepted and the status is KEPT.
--     awarded, declined, any other     final: every vendor update is refused (42501).
--     A vendor never SETS an agency-set or final status (42501). Where S1 keeps the agency's
--     status, this guard writes OLD.status back rather than raising.
--     The vocabulary is partner_rfp_responses_status_check (scripts/019:8), exactly seven values;
--     the pre-flight refuses if the live constraint names any other.
--   M1 = (i). The summary-pending write stays in the app (service role, both routes). No SECURITY
--     DEFINER trigger; 110 keeps the four legacy columns NULL for every caller.
--   Reviews = (b). 114's WITH CHECK on "Agencies manage own delivery reviews" is kept whole and
--     gains: response_id NULL or a bid of the same lead organization AND of the partnership's
--     vendor; assignment_id NULL or an assignment on the same project AND partnership. No
--     engagement requirement.
--
-- WHAT IT DOES
--   1. public.partner_rfp_responses_vendor_write_guard(), BEFORE INSERT OR UPDATE FOR EACH ROW on
--      partner_rfp_responses. SECURITY INVOKER, search_path pinned, EXECUTE revoked from PUBLIC,
--      anon and authenticated. It acts only on a VENDOR SESSION, 118's definition (118:113-118,
--      118:792-796): a caller who is NOT on the trusted path (auth.uid() IS NULL AND current_user
--      NOT IN ('anon', 'authenticated')) and is NOT a member of the row's lead organization before
--      AND after the write (current_user_org_ids()). Agency members, the service role (the guest
--      route, lib/magic-token-attach.ts) and this SQL Editor role pass untouched. DENY BY DEFAULT:
--        UPDATE  to_jsonb(OLD) and to_jsonb(NEW) minus the VENDOR CONTENT allow-list must be equal;
--                any other difference raises 42501 naming the first column (alphabetical). Then S1.
--        INSERT  status must be draft or submitted; every column outside the allow-list and the
--                four link columns (id, inbox_item_id, vendor_org_id, lead_org_id, which the 079
--                INSERT policy ties to the caller's inbox row) must be NULL; created_at must be the
--                default, now().
--      THE VENDOR CONTENT ALLOW-LIST (report section 3, re-confirmed in step 0 round 2 b):
--        proposal_text, budget_proposal, timeline_proposal, attachments, payment_terms,
--        terms_disclosure, business_criteria_responses, business_criteria_acknowledgments,
--        budget_lines, proposal_sections, partner_display_name, updated_at, status (under S1).
--      FIXED ONCE INSERTED: id, inbox_item_id, vendor_org_id, lead_org_id, submitted_at, created_at.
--      AGENCY-OWNED, NEVER A VENDOR'S: agency_feedback, feedback_updated_at, shortlisted_at,
--        declined_at, meeting_requested_at (and the four 110 columns, NULL for everyone).
--   2. ALTER POLICY "Agencies manage own delivery reviews" ON delivery_reviews WITH CHECK (ruling b).
--      USING is untouched. ONE POLICY, ALTERED IN PLACE: the public policy count stays 161.
--   No other policy, grant, table or column changes. No row is written.
--
-- THE PRE-FLIGHT (LG121, fail-closed, inside the transaction; nothing is written when it refuses):
--   * the trusted path (no end-user session: the SQL Editor role);
--   * 120 is applied (its two vendor-copy guards enabled, rfp_vendor_copy_keys() present), and
--     current_user_org_ids() exists;
--   * the public policy count is 161;
--   * partner_rfp_responses carries EXACTLY 079's six policies (names, commands, roles
--     {authenticated}; the vendor UPDATE policy with no WITH CHECK, as step 0 read it), and
--     delivery_reviews EXACTLY its two (the agency ALL policy carrying 114's check);
--   * partner_rfp_responses' triggers are 110's guard and, on a re-run, 121's own: nothing else;
--   * partner_rfp_responses has exactly the 28 columns step 0 classified, and its status
--     constraint names exactly the seven S1 places;
--   * no existing delivery review already breaks the new check (each would be refused on its next
--     save). The refusal lists them.
--
-- IDEMPOTENCY: CREATE OR REPLACE for the function and trigger, ALTER POLICY for the check. A second
-- run changes nothing and its NOTICE says "121 already applied".
--
-- DOWN: 121_vendor_write_guards_down.sql drops the guard and restores 114's WITH CHECK exactly.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--   [ ] The 121 code (feat/121-vendor-write-guards) is DEPLOYED. Before it, the vendor page autosave
--       sends status 'draft', which this guard accepts but turns into "keep the status"; the code is
--       what stops the inbox row's status being reset on a resubmission of a shortlisted bid.
--       Applying first is safe, deploying first is the order of record.
--   [ ] supabase/sql-checks/121-vendor-write-inventory.sql has been run and read (R1-R9, D1-D7).
--       D4, D5 and D6 must be 0; the pre-flight enforces them.
--   [ ] P1 to P3 below answer as EXPECTED.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 121." (expected count in its header).
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P3 unchanged).
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Deploy the 121 code. Run the inventory query and P1 to P3; record the answers.
--   2. Paste supabase/migrations/121_preapply_test.sql and run it ONCE. The result is a red error
--      box; its first line must read "SAFE TO APPLY 121.".
--   3. DRY RUN: replace the final COMMIT statement (line number at the foot of this header) with
--      ROLLBACK and run the file. Prove it rolled back: P3 must answer exactly as in step 1.
--   4. Restore the COMMIT statement and run the file for real.
--   5. Run V1 to V4. Each must return EXACTLY the EXPECTED values.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md and the state of record. Next free: 122.
--   Rollback: supabase/migrations/121_vendor_write_guards_down.sql.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY.
-- =====================================================================
--
-- P1. 120 IS PRESENT AND 121 IS NOT. EXPECTED: non-null, null, 161.
--   SELECT to_regprocedure('public.rfp_vendor_copy_keys()'),
--          to_regprocedure('public.partner_rfp_responses_vendor_write_guard()'),
--          (SELECT count(*) FROM pg_policies WHERE schemaname = 'public');
--
-- P2. THE POLICIES 121 READS. EXPECTED: eight rows; delivery_reviews "Agencies manage own delivery
--     reviews" ALL with a with_check naming lead_org_id and projects but not response_id;
--     partner_rfp_responses "Partners update own RFP responses" UPDATE with with_check NULL.
--   SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('partner_rfp_responses', 'delivery_reviews') ORDER BY 1, 2;
--
-- P3. A FINGERPRINT TO PROVE THE DRY RUN ROLLED BACK (policies and triggers of the two tables).
--   SELECT md5(string_agg(tablename || policyname || coalesce(with_check, ''), ',' ORDER BY tablename, policyname))
--   FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('partner_rfp_responses', 'delivery_reviews');
--   SELECT string_agg(t.tgname::text || ':' || t.tgenabled::text, ',' ORDER BY t.tgname) FROM pg_trigger t
--   WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass AND NOT t.tgisinternal;
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT.
-- =====================================================================
--
-- V1. THE GUARD. EXPECTED: two rows, partner_rfp_responses_private_columns_guard and
--     partner_rfp_responses_vendor_write_guard, both O, tgtype 23 (BEFORE ROW INSERT OR UPDATE).
--   SELECT t.tgname, t.tgenabled::text, t.tgtype FROM pg_trigger t
--   WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass AND NOT t.tgisinternal ORDER BY 1;
--
-- V2. THE FUNCTION. EXPECTED: prosecdef f; proconfig {"search_path=public, pg_temp"}; anon_x f; auth_x f.
--   SELECT p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
--   FROM pg_proc p WHERE p.oid = 'public.partner_rfp_responses_vendor_write_guard()'::regprocedure;
--
-- V3. THE REVIEW CHECK. EXPECTED: one row, ALL, {authenticated}, with_check naming response_id,
--     vendor_org_id, assignment_id and project_assignments; qual unchanged from P2.
--   SELECT cmd, roles, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'delivery_reviews' AND policyname = 'Agencies manage own delivery reviews';
--
-- V4. POLICIES UNCHANGED IN NUMBER. EXPECTED: 161.
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- BEGIN, COMMIT and body-marker line numbers of the transaction below (BODY START 151, BODY END 502):
-- BEGIN is at line 150 and COMMIT is at line 503. Requires PostgreSQL 14+ (CREATE OR REPLACE TRIGGER).

BEGIN;
-- >>> 121 BODY START
-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION. Nothing is written before it.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  c_columns CONSTANT text[] := ARRAY[
    'agency_feedback', 'ai_summary_detailed', 'ai_summary_generated_at', 'ai_summary_short', 'attachments',
    'budget_lines', 'budget_proposal', 'business_criteria_acknowledgments', 'business_criteria_responses',
    'composite_score', 'created_at', 'declined_at', 'feedback_updated_at', 'id', 'inbox_item_id', 'lead_org_id',
    'meeting_requested_at', 'partner_display_name', 'payment_terms', 'proposal_sections', 'proposal_text',
    'shortlisted_at', 'status', 'submitted_at', 'terms_disclosure', 'timeline_proposal', 'updated_at',
    'vendor_org_id'];
  c_statuses CONSTANT text[] := ARRAY['awarded', 'declined', 'draft', 'meeting_requested', 'shortlisted',
                                      'submitted', 'under_review'];
  v_list text;
  v_def  text;
  v_n    bigint;
BEGIN
  -- 118's trusted path. Never weaken a guard to make this pass.
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '121 refuses to run: it must run with no end-user session (the SQL Editor role). auth.uid() is %, current_user is %.', auth.uid(), current_user
      USING ERRCODE = 'LG121';
  END IF;

  -- 120 is applied; 079's helper exists.
  IF to_regprocedure('public.rfp_vendor_copy_keys()') IS NULL
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled::text = 'O'
            AND (c.relname::text, t.tgname::text) IN (('partner_rfp_inbox', 'partner_rfp_inbox_vendor_copy_guard'),
                                                      ('rfp_magic_tokens', 'rfp_magic_tokens_vendor_copy_guard'))) <> 2 THEN
    RAISE EXCEPTION '121 refuses to run: 120 is not applied (rfp_vendor_copy_keys() or a vendor-copy guard is missing or disabled). Apply 120 first.'
      USING ERRCODE = 'LG121';
  END IF;
  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '121 refuses to run: public.current_user_org_ids() does not exist (079).' USING ERRCODE = 'LG121';
  END IF;

  -- The public policy count step 0 recorded.
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public';
  IF v_n <> 161 THEN
    RAISE EXCEPTION '121 refuses to run: there are % public policies, not the 161 recorded after 120. Find what changed first.', v_n
      USING ERRCODE = 'LG121';
  END IF;

  -- partner_rfp_responses: exactly 079's six policies, as step 0 read them.
  SELECT string_agg(policyname || ' (' || cmd || ')', ', ' ORDER BY policyname) INTO v_list
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses'
     AND (policyname::text, cmd::text) NOT IN (('Agencies select RFP responses they own', 'SELECT'),
                                   ('Agencies update response status and feedback', 'UPDATE'),
                                   ('Partners insert RFP responses for their inbox', 'INSERT'),
                                   ('Partners read response status and feedback', 'SELECT'),
                                   ('Partners select own RFP responses', 'SELECT'),
                                   ('Partners update own RFP responses', 'UPDATE'));
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '121 refuses to run: unexpected policy on partner_rfp_responses: %', v_list USING ERRCODE = 'LG121';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses') <> 6
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses'
                 AND roles <> ARRAY['authenticated']::name[])
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses'
                     AND policyname = 'Partners update own RFP responses' AND with_check IS NULL
                     AND qual LIKE '%vendor_org_id%current_user_org_ids%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses'
                     AND policyname = 'Agencies update response status and feedback'
                     AND qual LIKE '%lead_org_id%current_user_org_ids%' AND with_check LIKE '%lead_org_id%current_user_org_ids%') THEN
    RAISE EXCEPTION '121 refuses to run: partner_rfp_responses does not carry 079''s six policies as step 0 read them (a policy is missing, not TO authenticated, or its definition moved). Read P2.'
      USING ERRCODE = 'LG121';
  END IF;

  -- delivery_reviews: exactly its two policies; the agency ALL policy carries 114's check.
  SELECT string_agg(policyname || ' (' || cmd || ')', ', ' ORDER BY policyname) INTO v_list
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
     AND (policyname::text, cmd::text) NOT IN (('Agencies manage own delivery reviews', 'ALL'),
                                   ('Partners view own complete delivery reviews', 'SELECT'));
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '121 refuses to run: unexpected policy on delivery_reviews: %', v_list USING ERRCODE = 'LG121';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
                     AND policyname = 'Agencies manage own delivery reviews' AND roles = ARRAY['authenticated']::name[]
                     AND with_check LIKE '%current_user_org_ids%' AND with_check LIKE '%lead_org_id%'
                     AND with_check LIKE '%projects%') THEN
    RAISE EXCEPTION '121 refuses to run: delivery_reviews does not carry its two policies with 114''s check. Read P2.'
      USING ERRCODE = 'LG121';
  END IF;

  -- Triggers on partner_rfp_responses: 110's guard, and 121's own on a re-run. Nothing else.
  SELECT string_agg(t.tgname::text, ', ' ORDER BY t.tgname) INTO v_list
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass AND NOT t.tgisinternal
     AND t.tgname NOT IN ('partner_rfp_responses_private_columns_guard', 'partner_rfp_responses_vendor_write_guard');
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '121 refuses to run: unexpected trigger on partner_rfp_responses: %', v_list USING ERRCODE = 'LG121';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass
                  AND t.tgname = 'partner_rfp_responses_private_columns_guard' AND t.tgenabled::text = 'O') THEN
    RAISE EXCEPTION '121 refuses to run: 110''s partner_rfp_responses_private_columns_guard is missing or disabled.' USING ERRCODE = 'LG121';
  END IF;

  -- The 28 columns step 0 classified. A column outside them has no place in the allow-list.
  SELECT string_agg(a.attname::text, ', ' ORDER BY a.attname) INTO v_list
    FROM pg_attribute a
   WHERE a.attrelid = 'public.partner_rfp_responses'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND NOT (a.attname::text = ANY (c_columns));
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '121 refuses to run: partner_rfp_responses has a column step 0 did not classify: %', v_list USING ERRCODE = 'LG121';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.partner_rfp_responses'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped) <> 28 THEN
    RAISE EXCEPTION '121 refuses to run: partner_rfp_responses does not have the 28 columns step 0 classified.' USING ERRCODE = 'LG121';
  END IF;

  -- The status vocabulary: exactly the seven values S1 places.
  SELECT pg_get_constraintdef(k.oid) INTO v_def
    FROM pg_constraint k
   WHERE k.conrelid = 'public.partner_rfp_responses'::regclass AND k.conname = 'partner_rfp_responses_status_check';
  IF v_def IS NULL
     OR (SELECT array_agg(m[1] ORDER BY m[1] COLLATE "C") FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m) IS DISTINCT FROM c_statuses THEN
    RAISE EXCEPTION '121 refuses to run: partner_rfp_responses_status_check is not the seven statuses S1 places (%). Re-rule S1 first.', coalesce(v_def, 'missing')
      USING ERRCODE = 'LG121';
  END IF;

  -- The columns the review check reads.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'delivery_reviews'    AND column_name IN ('response_id', 'assignment_id', 'project_id', 'partnership_id', 'org_id'))
           OR (table_name = 'project_assignments' AND column_name IN ('id', 'project_id', 'partnership_id'))
           OR (table_name = 'partnerships'        AND column_name IN ('id', 'lead_org_id', 'vendor_org_id')))) <> 11 THEN
    RAISE EXCEPTION '121 refuses to run: a column the review check reads is missing (delivery_reviews, project_assignments, partnerships).' USING ERRCODE = 'LG121';
  END IF;

  -- No existing review already breaks the new check (inventory D4-D6).
  SELECT string_agg(x, '; ') INTO v_list FROM (
    SELECT 'review ' || r.id::text
           || CASE WHEN r.response_id IS NOT NULL AND NOT EXISTS (
                     SELECT 1 FROM public.partner_rfp_responses b
                      WHERE b.id = r.response_id AND b.lead_org_id = r.org_id AND b.vendor_org_id = p.vendor_org_id)
                   THEN ' response ' || r.response_id::text ELSE '' END
           || CASE WHEN r.assignment_id IS NOT NULL AND NOT EXISTS (
                     SELECT 1 FROM public.project_assignments a
                      WHERE a.id = r.assignment_id AND a.project_id = r.project_id AND a.partnership_id = r.partnership_id)
                   THEN ' assignment ' || r.assignment_id::text ELSE '' END AS x
      FROM public.delivery_reviews r
      LEFT JOIN public.partnerships p ON p.id = r.partnership_id
     WHERE (r.response_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM public.partner_rfp_responses b
               WHERE b.id = r.response_id AND b.lead_org_id = r.org_id AND b.vendor_org_id = p.vendor_org_id))
        OR (r.assignment_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM public.project_assignments a
               WHERE a.id = r.assignment_id AND a.project_id = r.project_id AND a.partnership_id = r.partnership_id))
     ORDER BY r.id
     LIMIT 50) m;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION '121 refuses to run: existing delivery reviews already break the new check and would be refused on their next save: %. Read them (inventory D4-D6) before anything else.', v_list
      USING ERRCODE = 'LG121';
  END IF;

  -- Captured for the post-check and the result. A previous run is recognised by its trigger.
  PERFORM set_config('ligament.m121_present',
                     CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass
                                        AND t.tgname = 'partner_rfp_responses_vendor_write_guard')
                          THEN '1' ELSE '0' END, true);
  PERFORM set_config('ligament.m121_policies', v_n::text, true);
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE VENDOR WRITE GUARD ON partner_rfp_responses (V1, ruling S1). See the header.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_rfp_responses_vendor_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- The vendor content allow-list. Everything else is refused for a vendor, including any column
  -- added to this table later.
  v_content   CONSTANT text[] := ARRAY['proposal_text', 'budget_proposal', 'timeline_proposal', 'attachments',
                                       'payment_terms', 'terms_disclosure', 'business_criteria_responses',
                                       'business_criteria_acknowledgments', 'budget_lines', 'proposal_sections',
                                       'partner_display_name', 'updated_at', 'status'];
  -- Set on a vendor INSERT only; the 079 INSERT policy ties them to the caller's inbox row.
  v_links     CONSTANT text[] := ARRAY['id', 'inbox_item_id', 'vendor_org_id', 'lead_org_id'];
  v_offending text;
BEGIN
  -- 118's trusted path: the service role, migrations, the SQL Editor. Untouched.
  IF auth.uid() IS NULL AND current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- A member of the row's lead organization, before AND after the write: the agency. Untouched.
  IF coalesce(NEW.lead_org_id IN (SELECT public.current_user_org_ids()), false)
     AND (TG_OP = 'INSERT' OR coalesce(OLD.lead_org_id IN (SELECT public.current_user_org_ids()), false)) THEN
    RETURN NEW;
  END IF;

  -- Everyone else is a vendor session here.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL OR NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'A vendor can create a bid only as a draft or submitted, not %.', coalesce(NEW.status, 'NULL')
        USING ERRCODE = '42501',
              DETAIL  = 'partner_rfp_responses.status is the agency''s once the bid is submitted (migration 121, ruling S1).';
    END IF;

    SELECT n.key INTO v_offending
      FROM jsonb_each(to_jsonb(NEW) - v_content - v_links - 'created_at'::text) n
     WHERE n.value <> 'null'::jsonb
     ORDER BY n.key
     LIMIT 1;
    IF v_offending IS NULL AND NEW.created_at IS DISTINCT FROM now() THEN
      v_offending := 'created_at';
    END IF;
    IF v_offending IS NOT NULL THEN
      RAISE EXCEPTION 'A vendor cannot set partner_rfp_responses.%.', v_offending
        USING ERRCODE = '42501',
              DETAIL  = 'A vendor''s new bid may carry its own content and its inbox link only. Feedback, action timestamps, submitted_at and created_at are not a vendor''s (migration 121).';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. S1: a final bid (awarded, declined, or a status S1 does not name) is not edited at all.
  IF OLD.status IS NULL OR OLD.status NOT IN ('draft', 'submitted', 'under_review', 'shortlisted', 'meeting_requested') THEN
    RAISE EXCEPTION 'This bid is %, so it can no longer be edited.', coalesce(OLD.status, 'without a status')
      USING ERRCODE = '42501',
            DETAIL  = 'Vendors cannot change an awarded or declined bid (migration 121, ruling S1).';
  END IF;

  -- S1: a vendor never sets an agency-set or final status.
  IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IS NULL OR NEW.status NOT IN ('draft', 'submitted')) THEN
    RAISE EXCEPTION 'A vendor cannot set a bid''s status to %.', coalesce(NEW.status, 'NULL')
      USING ERRCODE = '42501',
            DETAIL  = 'Vendors move a bid only between draft and submitted. Every other status is the agency''s (migration 121, ruling S1).';
  END IF;

  -- Deny by default: nothing outside the content allow-list changes.
  SELECT o.key INTO v_offending
    FROM jsonb_each(to_jsonb(OLD) - v_content) o
    LEFT JOIN jsonb_each(to_jsonb(NEW) - v_content) n ON n.key = o.key
   WHERE n.value IS DISTINCT FROM o.value
   ORDER BY o.key
   LIMIT 1;
  IF v_offending IS NOT NULL THEN
    RAISE EXCEPTION 'A vendor cannot change partner_rfp_responses.%.', v_offending
      USING ERRCODE = '42501',
            DETAIL  = 'Vendors may change their bid content (proposal, budget, timeline, attachments, terms, criteria responses, budget lines, sections, display name, updated_at) and status under ruling S1. Nothing else (migration 121).';
  END IF;

  -- S1: the agency's status is kept. Changes requested moves only on a resubmission.
  IF OLD.status = 'under_review' THEN
    IF NEW.status IS DISTINCT FROM 'submitted' THEN
      NEW.status := OLD.status;
    END IF;
  ELSIF OLD.status IN ('shortlisted', 'meeting_requested') THEN
    NEW.status := OLD.status;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.partner_rfp_responses_vendor_write_guard() IS
  'Migration 121. BEFORE INSERT OR UPDATE on partner_rfp_responses, vendor sessions only (not the trusted '
  'path, not a member of the lead organization before and after). Deny by default: only the bid content '
  'allow-list may change (42501 names any other column). Ruling S1: a vendor never sets an agency-set or '
  'final status; under_review moves to submitted only on resubmission; shortlisted and meeting_requested '
  'are kept; awarded, declined and unknown statuses refuse every vendor update. A vendor insert is draft '
  'or submitted, with nothing agency-owned set.';

REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_vendor_write_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_vendor_write_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_vendor_write_guard() FROM authenticated;

CREATE OR REPLACE TRIGGER partner_rfp_responses_vendor_write_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_responses_vendor_write_guard();


-- ---------------------------------------------------------------------
-- 2. THE REVIEW CHECK (ruling b). 114's three conditions, unchanged, plus the bid and the
--    assignment. USING untouched. The subqueries run under the caller's RLS: the agency reads its
--    own bids, partnerships and assignments, exactly what app/api/agency/delivery-reviews reads.
-- ---------------------------------------------------------------------
ALTER POLICY "Agencies manage own delivery reviews" ON public.delivery_reviews
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND EXISTS (SELECT 1 FROM public.partnerships p
                 WHERE p.id = delivery_reviews.partnership_id
                   AND p.lead_org_id = delivery_reviews.org_id)
    AND EXISTS (SELECT 1 FROM public.projects pr
                 WHERE pr.id = delivery_reviews.project_id
                   AND pr.org_id = delivery_reviews.org_id)
    AND (delivery_reviews.response_id IS NULL
         OR EXISTS (SELECT 1 FROM public.partner_rfp_responses b
                      JOIN public.partnerships pv ON pv.id = delivery_reviews.partnership_id
                     WHERE b.id = delivery_reviews.response_id
                       AND b.lead_org_id = delivery_reviews.org_id
                       AND b.vendor_org_id = pv.vendor_org_id))
    AND (delivery_reviews.assignment_id IS NULL
         OR EXISTS (SELECT 1 FROM public.project_assignments a
                     WHERE a.id = delivery_reviews.assignment_id
                       AND a.project_id = delivery_reviews.project_id
                       AND a.partnership_id = delivery_reviews.partnership_id))
  );


-- ---------------------------------------------------------------------
-- 3. POST-CHECK AND RESULT. Any shortfall aborts the file: nothing is committed.
-- ---------------------------------------------------------------------
DO $post$
DECLARE
  v_before  text := current_setting('ligament.m121_policies', true);
  v_present boolean := current_setting('ligament.m121_present', true) = '1';
  v_after   bigint;
BEGIN
  SELECT count(*) INTO v_after FROM pg_policies WHERE schemaname = 'public';
  IF v_before IS DISTINCT FROM v_after::text THEN
    RAISE EXCEPTION '121 stopped: the public policy count moved (before %, after %). Nothing was committed.', v_before, v_after
      USING ERRCODE = 'LG121';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass
                    AND t.tgname = 'partner_rfp_responses_vendor_write_guard'
                    AND t.tgenabled::text = 'O' AND t.tgtype = 23) THEN
    RAISE EXCEPTION '121 stopped: partner_rfp_responses_vendor_write_guard is missing, disabled or not BEFORE INSERT OR UPDATE FOR EACH ROW. Nothing was committed.'
      USING ERRCODE = 'LG121';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
                    AND policyname = 'Agencies manage own delivery reviews' AND cmd = 'ALL'
                    AND with_check LIKE '%response_id%' AND with_check LIKE '%vendor_org_id%'
                    AND with_check LIKE '%assignment_id%' AND with_check LIKE '%project_assignments%'
                    AND with_check LIKE '%projects%' AND with_check LIKE '%lead_org_id%') THEN
    RAISE EXCEPTION '121 stopped: the delivery review check did not take. Nothing was committed.' USING ERRCODE = 'LG121';
  END IF;

  IF v_present THEN
    RAISE NOTICE '121 already applied: the guard and the review check were re-set to identical definitions; % public policies (unchanged).', v_after;
  ELSE
    RAISE NOTICE E'121 APPLIED.\n  partner_rfp_responses_vendor_write_guard: BEFORE INSERT OR UPDATE, vendor sessions only (ruling S1)\n  delivery_reviews "Agencies manage own delivery reviews": WITH CHECK adds the bid and the assignment (ruling b)\n  public policies: % before, % after (unchanged)',
      v_before, v_after;
  END IF;
END
$post$;
-- <<< 121 BODY END
COMMIT;
