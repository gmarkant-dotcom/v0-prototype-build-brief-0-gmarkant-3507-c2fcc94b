-- =====================================================================
-- 121 PRE-APPLY TEST. ONE PASTE. APPLIES 121, WRITES, READS, THEN ROLLS BACK.
--
-- AUTHORED 2026-11-06 on feat/121-vendor-write-guards (unattended run). NOT RUN: THERE IS NO LOCAL
-- POSTGRES AND NO CREDENTIALS HERE. Expect to fix a typo on the first run; a typo ends in a plain
-- error, not in "SAFE TO APPLY". OWNER-RUN, in the Supabase SQL Editor.
-- The inlined migration code below (inside the $m121$ string) is 121_vendor_write_guards.sql from
-- the line "-- >>> 121 BODY START" to the line "-- <<< 121 BODY END" inclusive: the whole body
-- between BEGIN; and COMMIT;. Both files carry those two marker lines, so the copies can be compared
-- mechanically. If you edit the migration, re-copy the marked block here and re-check.
--
-- 071-120 ARE LIVE. This test applies only 121, inside its own transaction, between phase 1 and
-- phase 2.
--
-- LESSONS APPLIED (118-120): (1) subjects are selected through partnerships.vendor_org_id (never the
-- old partner_id); (2) every "char" catalog column (tgenabled) is cast to text before || or
-- comparison output (42725); (3) NO TEMP TABLE AND NO pg_temp FUNCTION (42P01 in the SQL Editor):
-- everything lives inside the one DO block; (4) the SQL Editor shows only the last statement's
-- result, so the final RAISE carries the whole result.
--
-- WHAT 121 MUST SHOW
--   V1 (ruling S1). A vendor edits content on a draft and a submitted bid (accepted both times). On a
--   shortlisted, meeting-requested or changes-requested bid the edit is accepted and the agency's
--   status is kept after 121 (before 121 the vendor's 'draft' demotes it: the baseline). A vendor
--   setting awarded, shortlisted, declined, meeting_requested or under_review, repointing
--   lead_org_id or inbox_item_id, setting submitted_at or created_at, or rewriting agency_feedback,
--   feedback_updated_at or a 069 timestamp is accepted before and refused after. A vendor edit of an
--   awarded or declined bid is refused after. A vendor insert with an agency-owned value or a status
--   other than draft or submitted is refused after; a plain draft or submitted insert is accepted
--   both times. The agency sets status, feedback and timestamps and relinks its bid in both phases;
--   the service role (guest route, magic-token attach) is untouched; anon gets nothing.
--   REVIEWS (ruling b). An agency review naming its own bid of the partnership's vendor and an
--   assignment on the same project and partnership is accepted both times, and so is one naming
--   neither; a bid of another lead organization, of another vendor, of no vendor, or an assignment
--   of another project, is accepted before and refused after, on insert and on update. A vendor
--   writes no review in either phase.
--   SELF-CHECKS: the public policy count is 161 before and after; no policy but the one altered
--   changed; that one keeps its command, roles and USING; no grant changed outside the new function;
--   the function is invoker, pinned, not executable by anon or authenticated; the trigger is
--   BEFORE INSERT OR UPDATE FOR EACH ROW and enabled, and every other trigger on the two tables is
--   unchanged; 121 writes no row.
--
-- PHASES: phase 1 BEFORE 121, phase 2 AFTER 121. EVERY SCENARIO RUNS IN EVERY PHASE. A phase-1
-- mismatch is INCONCLUSIVE (the premise is wrong), never PASS; a phase-2 mismatch is FAIL.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch.
--   3. READ THE ERROR MESSAGE. That is where the result is.
--
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT. <<<
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- READ THE FIRST LINE:
--     "SAFE TO APPLY 121."       -> and only this.
--     "DO NOT APPLY 121 YET."    -> INCONCLUSIVE or NO SUBJECT.
--     "DO NOT APPLY 121."        -> an assertion FAILED, or the test is broken.
-- Rows read PASS, FAIL, INCONCLUSIVE, NOT DISCRIMINATING (same expectation in both phases, reported
-- as PASS with that note) or NO SUBJECT (reported as INCONCLUSIVE, never PASS).
--
-- EXPECTED COUNT: 60 scenarios + 7 self-checks + M = 68 assertions.
--
-- INCONCLUSIVE BY DESIGN: NONE. Every scenario has a subject on production as of 2026-11-06 (a
-- partnership whose vendor organization has a member outside the lead organization, a project of
-- that lead organization, and a third organization). If one is missing the rows that need it read
-- NO SUBJECT and the headline reads "DO NOT APPLY 121 YET."; that is not a 121 fault, read the
-- SUBJECT line.
--
-- NOT DISCRIMINATING BY DESIGN (same expectation before and after 121, reported as PASS with that
-- note): B1-B4, B6, B9 (the vendor's own cycle), I1, I2 (plain vendor inserts), I9 (079's insert
-- policy refuses both times), A1-A6 (the agency), G1, G2 (the service role), N1-N4 (anon), R1, R2,
-- R9 (legitimate reviews), R10 (114 refuses the vendor both times).
--
-- =====================================================================
-- THE SUBJECTS
-- =====================================================================
-- vendor : a member of a partnership's VENDOR ORGANIZATION (partnerships.vendor_org_id, ov) who is
--          not a member of its lead organization (o1), preferring a partnership that already holds a
--          bid. ps1 is that partnership.
-- m1     : a member of o1 who is not a member of ov, preferring the fewest memberships. The agency.
-- p1     : a project of o1. Copied twice into throwaway projects (ptmp, ptmp2) for the reviews.
-- oo     : a third organization: neither o1 nor ov, and neither actor belongs to it.
-- svc    : SET LOCAL ROLE service_role, no sub claim (auth.uid() NULL). The trusted path.
-- anon   : SET LOCAL ROLE anon.
-- Throwaway rows, fixed ids, created by each scenario's SETUP as the table owner (the trusted path):
--   inb, inb2  partner_rfp_inbox rows of o1 claimed for ov;
--   bid        ov's bid on inb, in the status the scenario names;
--   asg, asgx  project_assignments of ps1 on ptmp and on ptmp2;
--   xbid       a bid of ov with lead organization oo; ybid a bid of o1 by oo; zbid a bid of o1 with
--              no vendor (a guest bid before attach); rev a review of (ptmp, ps1) naming asg and bid.
-- IT IMPERSONATES AND PROVES IT DID: request.jwt.claims + SET LOCAL ROLE, then auth.uid() and
-- current_user are read back; a mismatch raises LG098 (TEST FAULT, INCONCLUSIVE).
-- ISOLATION: every scenario runs in its own BEGIN ... EXCEPTION block ending in LG097. A fingerprint
-- of every partner_rfp_responses and delivery_reviews row, and of the partner_rfp_inbox,
-- project_assignments and projects ids, is compared after each.
--
-- RESULT CODES: OK:<value> (the scenario's one text value: the bid's status after the write, or a
-- row count), MISSING (42P01 / 42703 / 42883), E:<sqlstate> (refused with that code).
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled, not executed):
--   * The SQL Editor role may SET ROLE service_role and anon (118's and 120's tests did).
--   * The review setups copy p1 into two throwaway projects (jsonb_populate_record, as 118's D7 did)
--     and insert two project_assignments with only id, project_id and partnership_id. A trigger or
--     NOT NULL column on project_assignments this repository does not show would make that setup a
--     TEST FAULT (INCONCLUSIVE), never a PASS.
--   * A BEFORE ROW trigger fires before the RLS WITH CHECK, so a guard refusal on a vendor insert
--     reads 42501 from the guard, and a policy refusal reads 42501 from RLS: the same code.
-- =====================================================================


BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 67;
  c_phases       CONSTANT integer := 2;
  c_by_design    CONSTANT text[]  := ARRAY[]::text[];
  v_o1           uuid;
  v_ov           uuid;
  v_ps1          uuid;
  v_uv           uuid;
  v_u1           uuid;
  v_p1           uuid;
  v_oo           uuid;
  v_inb          uuid := gen_random_uuid();
  v_inb2         uuid := gen_random_uuid();
  v_bid          uuid := gen_random_uuid();
  v_ptmp         uuid := gen_random_uuid();
  v_ptmp2        uuid := gen_random_uuid();
  v_asg          uuid := gen_random_uuid();
  v_asgx         uuid := gen_random_uuid();
  v_xbid         uuid := gen_random_uuid();
  v_ybid         uuid := gen_random_uuid();
  v_zbid         uuid := gen_random_uuid();
  v_rev          uuid := gen_random_uuid();
  v_txt          text;
  v_actor        text;
  v_uid          uuid;
  v_ph           integer;
  v_i            integer;
  v_k            integer;
  v_idx          integer;
  v_parts        text[];
  v_need         text;
  v_nosubj       boolean;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_cnt_before   bigint;
  v_cnt_after    bigint;
  v_pol_before   text;
  v_pol_after    text;
  v_polx_before  text;
  v_polx_after   text;
  v_acl_before   text;
  v_acl_after    text;
  v_rows_before  text;
  v_rows_after   text;
  v_trg_before   text;
  v_trg_after    text;
  v_ok           boolean;
  v_detail       text;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_inconc_dsg   integer := 0;
  v_dsg_ids      text := '';
  v_ran          integer := 0;
  v_logged       integer := 0;
  v_lines        text := '';
  v_ba           text := '';
  v_headline     text;
  v_verdict_text text;
  v_report       text;
  v_apply_err    text[] := ARRAY[]::text[];
  v_cls          text;
  v_exp          text;
  v_st           text;
  v_n            integer;
  v_same         boolean;
  v_all_nosubj   boolean;

  -- Isolation fingerprint, both phases.
  v_fp_sql       CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.partner_rfp_responses x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.delivery_reviews x), ''))
           || md5(coalesce((SELECT string_agg(x.id::text, ',' ORDER BY x.id) FROM public.partner_rfp_inbox x), ''))
           || md5(coalesce((SELECT string_agg(x.id::text, ',' ORDER BY x.id) FROM public.project_assignments x), ''))
           || md5(coalesce((SELECT string_agg(x.id::text, ',' ORDER BY x.id) FROM public.projects x), ''))$f$;
  -- Every row of the two guarded tables, with counts: 121 must write none.
  v_rows_sql     CONSTANT text :=
    $f$SELECT (SELECT count(*) FROM public.partner_rfp_responses)::text || ' bids, '
           || (SELECT count(*) FROM public.delivery_reviews)::text || ' reviews, '
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.partner_rfp_responses x), ''))
           || md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.delivery_reviews x), ''))$f$;
  -- Every policy in public except the one 121 alters.
  v_pol_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                      E'\n' ORDER BY tablename, policyname), ''))
       FROM pg_policies WHERE schemaname = 'public'
         AND NOT (tablename = 'delivery_reviews' AND policyname = 'Agencies manage own delivery reviews')$f$;
  -- The altered policy's command, roles and USING (its WITH CHECK is what changes).
  v_polx_sql     CONSTANT text :=
    $f$SELECT coalesce(string_agg(cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, ''), ';'), 'MISSING')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
         AND policyname = 'Agencies manage own delivery reviews'$f$;
  -- Every table, column and function ACL in public except the new function.
  v_acl_sql      CONSTANT text :=
    $f$SELECT md5(coalesce((SELECT string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), E'\n' ORDER BY c.relname)
                             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')), ''))
           || md5(coalesce((SELECT string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, E'\n' ORDER BY c.relname, a.attname)
                             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped), ''))
           || md5(coalesce((SELECT string_agg(p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, ''), E'\n' ORDER BY p.oid::regprocedure::text)
                             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname <> 'partner_rfp_responses_vendor_write_guard'), ''))$f$;
  -- Every trigger on the two tables except 121's, with its function body.
  v_trg_sql      CONSTANT text :=
    $f$SELECT md5(coalesce(string_agg(c.relname || ':' || t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype::text || ':'
                                      || p.oid::regprocedure::text || ':' || md5(p.prosrc), E'\n' ORDER BY c.relname, t.tgname), ''))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid IN ('public.partner_rfp_responses'::regclass, 'public.delivery_reviews'::regclass) AND NOT t.tgisinternal
         AND t.tgname <> 'partner_rfp_responses_vendor_write_guard'$f$;

  -- format() arguments everywhere:
  --   %1$L o1  %2$L ov  %3$L inb  %4$L bid  %5$L oo  %6$L inb2  %7$L p1  %8$L ps1  %9$L ptmp
  --   %10$L ptmp2  %11$L asg  %12$L asgx  %13$L xbid  %14$L ybid  %15$L zbid  %16$L rev
  s_inb   CONSTANT text := $s$INSERT INTO public.partner_rfp_inbox (id, lead_org_id, vendor_org_id, scope_item_id, scope_item_name, claimed_at) VALUES (%3$L, %1$L, %2$L, 'LG121-1', 'LG121 test row', now());$s$;
  s_inb2  CONSTANT text := $s$INSERT INTO public.partner_rfp_inbox (id, lead_org_id, vendor_org_id, scope_item_id, scope_item_name, claimed_at) VALUES (%6$L, %1$L, %2$L, 'LG121-2', 'LG121 second test row', now());$s$;
  s_bid   CONSTANT text := $s$INSERT INTO public.partner_rfp_responses (id, inbox_item_id, vendor_org_id, lead_org_id, proposal_text, partner_display_name, status) VALUES (%4$L, %3$L, %2$L, %1$L, 'LG121 bid', 'LG121 vendor', '@S@');$s$;
  s_ptmp  CONSTANT text := $s$INSERT INTO public.projects SELECT (jsonb_populate_record(NULL::public.projects, to_jsonb(p) || jsonb_build_object('id', %9$L::uuid, 'name', 'LG121 throwaway project'))).* FROM public.projects p WHERE p.id = %7$L; INSERT INTO public.projects SELECT (jsonb_populate_record(NULL::public.projects, to_jsonb(p) || jsonb_build_object('id', %10$L::uuid, 'name', 'LG121 throwaway project 2'))).* FROM public.projects p WHERE p.id = %7$L;$s$;
  s_asg   CONSTANT text := $s$INSERT INTO public.project_assignments (id, project_id, partnership_id) VALUES (%11$L, %9$L, %8$L), (%12$L, %10$L, %8$L);$s$;
  s_xbid  CONSTANT text := $s$INSERT INTO public.partner_rfp_responses (id, vendor_org_id, lead_org_id, proposal_text, partner_display_name, status) VALUES (%13$L, %2$L, %5$L, 'LG121 other lead', 'LG121', 'submitted');$s$;
  s_ybid  CONSTANT text := $s$INSERT INTO public.partner_rfp_responses (id, vendor_org_id, lead_org_id, proposal_text, partner_display_name, status) VALUES (%14$L, %5$L, %1$L, 'LG121 other vendor', 'LG121', 'submitted');$s$;
  s_zbid  CONSTANT text := $s$INSERT INTO public.partner_rfp_responses (id, vendor_org_id, lead_org_id, proposal_text, partner_display_name, status) VALUES (%15$L, NULL, %1$L, 'LG121 guest', 'LG121', 'submitted');$s$;
  s_rev   CONSTANT text := $s$INSERT INTO public.delivery_reviews (id, project_id, partnership_id, org_id, assignment_id, response_id, status) VALUES (%16$L, %9$L, %8$L, %1$L, %11$L, %4$L, 'draft');$s$;

  -- Scenario SQL shapes. Each returns ONE text value.
  q_uh    CONSTANT text := $q$WITH u AS (UPDATE public.partner_rfp_responses SET $q$;
  q_ut    CONSTANT text := $q$ WHERE id = %4$L RETURNING status) SELECT coalesce(string_agg(status, ','), 'NONE') FROM u$q$;
  q_ct    CONSTANT text := $q$ WHERE id = %4$L RETURNING 1) SELECT count(*)::text FROM u$q$;
  q_ih    CONSTANT text := $q$WITH i AS (INSERT INTO public.partner_rfp_responses (id, inbox_item_id, vendor_org_id, lead_org_id, proposal_text, partner_display_name, status$q$;
  q_iv    CONSTANT text := $q$) VALUES (%4$L, %3$L, %2$L, %1$L, 'LG121 vendor insert', 'LG121 vendor', $q$;
  q_it    CONSTANT text := $q$) RETURNING status) SELECT coalesce(string_agg(status, ','), 'NONE') FROM i$q$;
  q_rh    CONSTANT text := $q$WITH i AS (INSERT INTO public.delivery_reviews (project_id, partnership_id, org_id, assignment_id, response_id, status) VALUES (%9$L, %8$L, $q$;
  q_rt    CONSTANT text := $q$, 'draft') RETURNING 1) SELECT count(*)::text FROM i$q$;
  q_vh    CONSTANT text := $q$WITH u AS (UPDATE public.delivery_reviews SET $q$;
  q_vt    CONSTANT text := $q$ WHERE id = %16$L RETURNING 1) SELECT count(*)::text FROM u$q$;

  -- One row per scenario: id, label, actor, needs, setup, sql, expected BEFORE, expected AFTER.
  -- ' OR ' separates accepted values.
  sc        text[];
  r_cls     text[];
  s_rv      text;
BEGIN
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  ---------------------------------------------------------------------
  -- SUBJECTS. NO SUBJECT IS REPORTED, NEVER PASSED.
  ---------------------------------------------------------------------
  SELECT vm.user_id, vm.org_id, ps.id, ps.lead_org_id
    INTO v_uv, v_ov, v_ps1, v_o1
  FROM public.partnerships ps
  JOIN public.org_members vm ON vm.org_id = ps.vendor_org_id
  WHERE ps.vendor_org_id IS NOT NULL AND ps.vendor_org_id <> ps.lead_org_id
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = ps.lead_org_id
                  AND NOT EXISTS (SELECT 1 FROM public.org_members y WHERE y.user_id = m.user_id AND y.org_id = ps.vendor_org_id))
    AND EXISTS (SELECT 1 FROM public.projects pr WHERE pr.org_id = ps.lead_org_id)
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = vm.user_id AND x.org_id = ps.lead_org_id)
  ORDER BY (EXISTS (SELECT 1 FROM public.partner_rfp_responses r
                    WHERE r.lead_org_id = ps.lead_org_id AND r.vendor_org_id = ps.vendor_org_id)) DESC,
           ps.id, vm.user_id
  LIMIT 1;

  IF v_o1 IS NOT NULL THEN
    SELECT m.user_id INTO v_u1
      FROM public.org_members m
     WHERE m.org_id = v_o1
       AND NOT EXISTS (SELECT 1 FROM public.org_members y WHERE y.user_id = m.user_id AND y.org_id = v_ov)
     ORDER BY (SELECT count(*) FROM public.org_members z WHERE z.user_id = m.user_id), m.user_id
     LIMIT 1;
    SELECT pr.id INTO v_p1 FROM public.projects pr WHERE pr.org_id = v_o1 ORDER BY pr.id LIMIT 1;
    SELECT o.id INTO v_oo
      FROM public.organizations o
     WHERE o.id <> v_o1 AND o.id <> v_ov
       AND NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = o.id AND m.user_id IN (v_uv, v_u1))
     ORDER BY o.id
     LIMIT 1;
  END IF;

  ---------------------------------------------------------------------
  -- THE SCENARIOS.
  ---------------------------------------------------------------------
  s_rv := s_ptmp || s_asg || s_inb || replace(s_bid, '@S@', 'awarded');

  sc := ARRAY[
    -- B. Vendor content edits, ruling S1.
    ARRAY['B1', 'B1  vendor edits content on a draft', 'vendor', '', s_inb || replace(s_bid, '@S@', 'draft'),
          q_uh || $v$proposal_text = 'LG121 edit', updated_at = now()$v$ || q_ut, 'OK:draft', 'OK:draft'],
    ARRAY['B2', 'B2  vendor edits content on a submitted bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$proposal_text = 'LG121 edit', budget_proposal = '1000 USD', updated_at = now()$v$ || q_ut, 'OK:submitted', 'OK:submitted'],
    ARRAY['B3', 'B3  vendor saves a submitted bid back to draft', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$proposal_text = 'LG121 edit', status = 'draft'$v$ || q_ut, 'OK:draft', 'OK:draft'],
    ARRAY['B4', 'B4  vendor submits a draft', 'vendor', '', s_inb || replace(s_bid, '@S@', 'draft'),
          q_uh || $v$proposal_text = 'LG121 edit', status = 'submitted'$v$ || q_ut, 'OK:submitted', 'OK:submitted'],
    ARRAY['B5', 'B5  shortlisted + vendor autosave draft: status kept', 'vendor', '', s_inb || replace(s_bid, '@S@', 'shortlisted'),
          q_uh || $v$proposal_text = 'LG121 edit', status = 'draft'$v$ || q_ut, 'OK:draft', 'OK:shortlisted'],
    ARRAY['B6', 'B6  shortlisted + vendor content only: status kept', 'vendor', '', s_inb || replace(s_bid, '@S@', 'shortlisted'),
          q_uh || $v$proposal_text = 'LG121 edit', updated_at = now()$v$ || q_ut, 'OK:shortlisted', 'OK:shortlisted'],
    ARRAY['B7', 'B7  shortlisted + vendor resubmits: status kept', 'vendor', '', s_inb || replace(s_bid, '@S@', 'shortlisted'),
          q_uh || $v$proposal_text = 'LG121 edit', status = 'submitted'$v$ || q_ut, 'OK:submitted', 'OK:shortlisted'],
    ARRAY['B8', 'B8  meeting_requested + vendor draft: status kept', 'vendor', '', s_inb || replace(s_bid, '@S@', 'meeting_requested'),
          q_uh || $v$proposal_text = 'LG121 edit', status = 'draft'$v$ || q_ut, 'OK:draft', 'OK:meeting_requested'],
    ARRAY['B9', 'B9  changes requested + vendor resubmits: submitted', 'vendor', '', s_inb || replace(s_bid, '@S@', 'under_review'),
          q_uh || $v$proposal_text = 'LG121 edit', status = 'submitted'$v$ || q_ut, 'OK:submitted', 'OK:submitted'],
    ARRAY['B10', 'B10 changes requested + vendor draft: kept', 'vendor', '', s_inb || replace(s_bid, '@S@', 'under_review'),
          q_uh || $v$proposal_text = 'LG121 edit', status = 'draft'$v$ || q_ut, 'OK:draft', 'OK:under_review'],
    -- T. A vendor never sets an agency-set or final status.
    ARRAY['T1', 'T1  vendor sets awarded on a submitted bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'awarded'$v$ || q_ut, 'OK:awarded', 'E:42501'],
    ARRAY['T2', 'T2  vendor sets shortlisted on a submitted bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'shortlisted'$v$ || q_ut, 'OK:shortlisted', 'E:42501'],
    ARRAY['T3', 'T3  vendor sets declined on a submitted bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'declined'$v$ || q_ut, 'OK:declined', 'E:42501'],
    ARRAY['T4', 'T4  vendor sets awarded on a shortlisted bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'shortlisted'),
          q_uh || $v$status = 'awarded'$v$ || q_ut, 'OK:awarded', 'E:42501'],
    ARRAY['T5', 'T5  vendor sets meeting_requested on a draft', 'vendor', '', s_inb || replace(s_bid, '@S@', 'draft'),
          q_uh || $v$status = 'meeting_requested'$v$ || q_ut, 'OK:meeting_requested', 'E:42501'],
    ARRAY['T6', 'T6  vendor sets under_review on a submitted bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'under_review'$v$ || q_ut, 'OK:under_review', 'E:42501'],
    -- L. Link columns and the stamps fixed once inserted.
    ARRAY['L1', 'L1  vendor repoints lead_org_id to another org', 'vendor', 'oo', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$lead_org_id = %5$L$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['L2', 'L2  vendor repoints inbox_item_id', 'vendor', '', s_inb || s_inb2 || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$inbox_item_id = %6$L$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['L3', 'L3  vendor clears inbox_item_id', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$inbox_item_id = NULL$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['L4', 'L4  vendor sets submitted_at', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$submitted_at = now()$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['L5', 'L5  vendor rewrites created_at', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$created_at = '2000-01-01T00:00:00Z'$v$ || q_ct, 'OK:1', 'E:42501'],
    -- F. Agency-owned columns.
    ARRAY['F1', 'F1  vendor rewrites agency_feedback', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$agency_feedback = 'LG121 forged'$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['F2', 'F2  vendor sets feedback_updated_at', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$feedback_updated_at = now()$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['F3', 'F3  vendor sets shortlisted_at (069)', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$shortlisted_at = now()$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['F4', 'F4  vendor sets declined_at (069)', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$declined_at = now()$v$ || q_ct, 'OK:1', 'E:42501'],
    ARRAY['F5', 'F5  vendor sets meeting_requested_at (069)', 'vendor', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$meeting_requested_at = now()$v$ || q_ct, 'OK:1', 'E:42501'],
    -- Z. Final bids.
    ARRAY['Z1', 'Z1  vendor edits an awarded bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'awarded'),
          q_uh || $v$proposal_text = 'LG121 edit'$v$ || q_ut, 'OK:awarded', 'E:42501'],
    ARRAY['Z2', 'Z2  vendor edits a declined bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'declined'),
          q_uh || $v$proposal_text = 'LG121 edit'$v$ || q_ut, 'OK:declined', 'E:42501'],
    ARRAY['Z3', 'Z3  vendor resubmits an awarded bid', 'vendor', '', s_inb || replace(s_bid, '@S@', 'awarded'),
          q_uh || $v$status = 'submitted'$v$ || q_ut, 'OK:submitted', 'E:42501'],
    -- I. Vendor inserts.
    ARRAY['I1', 'I1  vendor inserts a draft', 'vendor', '', s_inb,
          q_ih || q_iv || $v$'draft'$v$ || q_it, 'OK:draft', 'OK:draft'],
    ARRAY['I2', 'I2  vendor inserts a submitted bid', 'vendor', '', s_inb,
          q_ih || q_iv || $v$'submitted'$v$ || q_it, 'OK:submitted', 'OK:submitted'],
    ARRAY['I3', 'I3  vendor inserts status awarded', 'vendor', '', s_inb,
          q_ih || q_iv || $v$'awarded'$v$ || q_it, 'OK:awarded', 'E:42501'],
    ARRAY['I4', 'I4  vendor inserts status shortlisted', 'vendor', '', s_inb,
          q_ih || q_iv || $v$'shortlisted'$v$ || q_it, 'OK:shortlisted', 'E:42501'],
    ARRAY['I5', 'I5  vendor inserts with agency_feedback', 'vendor', '', s_inb,
          q_ih || ', agency_feedback' || q_iv || $v$'draft', 'LG121 forged'$v$ || q_it, 'OK:draft', 'E:42501'],
    ARRAY['I6', 'I6  vendor inserts with shortlisted_at', 'vendor', '', s_inb,
          q_ih || ', shortlisted_at' || q_iv || $v$'draft', now()$v$ || q_it, 'OK:draft', 'E:42501'],
    ARRAY['I7', 'I7  vendor inserts with submitted_at', 'vendor', '', s_inb,
          q_ih || ', submitted_at' || q_iv || $v$'submitted', now()$v$ || q_it, 'OK:submitted', 'E:42501'],
    ARRAY['I8', 'I8  vendor inserts with an old created_at', 'vendor', '', s_inb,
          q_ih || ', created_at' || q_iv || $v$'draft', '2000-01-01T00:00:00Z'$v$ || q_it, 'OK:draft', 'E:42501'],
    ARRAY['I9', 'I9  vendor inserts with another lead_org_id', 'vendor', 'oo', s_inb,
          $v$WITH i AS (INSERT INTO public.partner_rfp_responses (id, inbox_item_id, vendor_org_id, lead_org_id, proposal_text, status) VALUES (%4$L, %3$L, %2$L, %5$L, 'LG121', 'draft') RETURNING status) SELECT coalesce(string_agg(status, ','), 'NONE') FROM i$v$,
          'E:42501', 'E:42501'],
    -- A. The agency, unaffected.
    ARRAY['A1', 'A1  agency shortlists, stamps shortlisted_at', 'm1', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'shortlisted', shortlisted_at = now(), updated_at = now()$v$ || q_ut, 'OK:shortlisted', 'OK:shortlisted'],
    ARRAY['A2', 'A2  agency requests changes with feedback', 'm1', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'under_review', agency_feedback = 'LG121 feedback', feedback_updated_at = now()$v$ || q_ut, 'OK:under_review', 'OK:under_review'],
    ARRAY['A3', 'A3  agency awards a shortlisted bid', 'm1', '', s_inb || replace(s_bid, '@S@', 'shortlisted'),
          q_uh || $v$status = 'awarded'$v$ || q_ut, 'OK:awarded', 'OK:awarded'],
    ARRAY['A4', 'A4  agency declines, stamps declined_at', 'm1', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'declined', declined_at = now(), agency_feedback = 'Decline reason: LG121'$v$ || q_ut, 'OK:declined', 'OK:declined'],
    ARRAY['A5', 'A5  agency requests a meeting, stamps it', 'm1', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'meeting_requested', meeting_requested_at = now()$v$ || q_ut, 'OK:meeting_requested', 'OK:meeting_requested'],
    ARRAY['A6', 'A6  agency relinks inbox_item_id (route :479)', 'm1', '', s_inb || s_inb2 || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$inbox_item_id = %6$L$v$ || q_ct, 'OK:1', 'OK:1'],
    -- G. The service role (guest route, magic-token attach), unaffected.
    ARRAY['G1', 'G1  service role resubmits a shortlisted bid', 'svc', '', s_inb || replace(s_bid, '@S@', 'shortlisted'),
          q_uh || $v$proposal_text = 'LG121 guest edit', status = 'submitted', submitted_at = now()$v$ || q_ut, 'OK:submitted', 'OK:submitted'],
    ARRAY['G2', 'G2  service role relinks vendor and inbox', 'svc', '', s_inb || s_inb2 || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$vendor_org_id = %2$L, inbox_item_id = %6$L$v$ || q_ct, 'OK:1', 'OK:1'],
    -- N. anon.
    ARRAY['N1', 'N1  anon updates a bid', 'anon', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          q_uh || $v$status = 'awarded'$v$ || q_ct, 'OK:0 OR E:42501', 'OK:0 OR E:42501'],
    ARRAY['N2', 'N2  anon inserts a bid', 'anon', '', s_inb,
          q_ih || q_iv || $v$'draft'$v$ || q_it, 'E:42501', 'E:42501'],
    ARRAY['N3', 'N3  anon reads a bid', 'anon', '', s_inb || replace(s_bid, '@S@', 'submitted'),
          $v$SELECT count(*)::text FROM public.partner_rfp_responses WHERE id = %4$L$v$, 'OK:0 OR E:42501', 'OK:0 OR E:42501'],
    ARRAY['N4', 'N4  anon inserts a review', 'anon', '', s_rv,
          q_rh || $v$%1$L, %11$L, %4$L$v$ || q_rt, 'E:42501', 'E:42501'],
    -- R. Delivery reviews, ruling (b).
    ARRAY['R1', 'R1  agency review: own bid and assignment', 'm1', '', s_rv,
          q_rh || $v$%1$L, %11$L, %4$L$v$ || q_rt, 'OK:1', 'OK:1'],
    ARRAY['R2', 'R2  agency review: no bid, no assignment', 'm1', '', s_rv,
          q_rh || $v$%1$L, NULL, NULL$v$ || q_rt, 'OK:1', 'OK:1'],
    ARRAY['R3', 'R3  agency review: bid of another lead org', 'm1', 'oo', s_rv || s_xbid,
          q_rh || $v$%1$L, %11$L, %13$L$v$ || q_rt, 'OK:1', 'E:42501'],
    ARRAY['R4', 'R4  agency review: own bid by another vendor', 'm1', 'oo', s_rv || s_ybid,
          q_rh || $v$%1$L, %11$L, %14$L$v$ || q_rt, 'OK:1', 'E:42501'],
    ARRAY['R5', 'R5  agency review: own bid with no vendor', 'm1', '', s_rv || s_zbid,
          q_rh || $v$%1$L, %11$L, %15$L$v$ || q_rt, 'OK:1', 'E:42501'],
    ARRAY['R6', 'R6  agency review: assignment of another project', 'm1', '', s_rv,
          q_rh || $v$%1$L, %12$L, %4$L$v$ || q_rt, 'OK:1', 'E:42501'],
    ARRAY['R7', 'R7  agency repoints a review to a foreign bid', 'm1', 'oo', s_rv || s_xbid || s_rev,
          q_vh || $v$response_id = %13$L$v$ || q_vt, 'OK:1', 'E:42501'],
    ARRAY['R8', 'R8  agency repoints a review to a foreign assignment', 'm1', '', s_rv || s_rev,
          q_vh || $v$assignment_id = %12$L$v$ || q_vt, 'OK:1', 'E:42501'],
    ARRAY['R9', 'R9  agency completes a matching review', 'm1', '', s_rv || s_rev,
          q_vh || $v$status = 'complete', updated_at = now()$v$ || q_vt, 'OK:1', 'OK:1'],
    ARRAY['R10', 'R10 vendor inserts a review', 'vendor', '', s_rv,
          $v$WITH i AS (INSERT INTO public.delivery_reviews (project_id, partnership_id, org_id, assignment_id, response_id, status) VALUES (%9$L, %8$L, %2$L, %11$L, %4$L, 'draft') RETURNING 1) SELECT count(*)::text FROM i$v$,
          'E:42501', 'E:42501']
  ];

  v_n := array_length(sc, 1);
  IF v_n <> 60 OR array_length(sc, 2) <> 8 THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: % scenarios of % fields, expected 60 of 8', v_n, array_length(sc, 2);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[v_n * c_phases]);

  EXECUTE $c$SELECT count(*) FROM pg_policies WHERE schemaname = 'public'$c$ INTO v_cnt_before;
  EXECUTE v_pol_sql  INTO v_pol_before;
  EXECUTE v_polx_sql INTO v_polx_before;
  EXECUTE v_acl_sql  INTO v_acl_before;
  EXECUTE v_trg_sql  INTO v_trg_before;

  ---------------------------------------------------------------------
  -- THE LOOP. EVERY SCENARIO RUNS IN EVERY PHASE; 121 is executed between phases.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. c_phases LOOP

    EXECUTE v_fp_sql INTO v_fp0;

    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_i - 1) * c_phases + v_ph;
      v_actor := sc[v_i][3];
      v_uid := CASE v_actor WHEN 'm1' THEN v_u1 WHEN 'vendor' THEN v_uv ELSE NULL END;

      v_nosubj := v_o1 IS NULL OR v_p1 IS NULL OR v_ps1 IS NULL
               OR (v_actor IN ('m1', 'vendor') AND v_uid IS NULL);
      FOREACH v_need IN ARRAY string_to_array(sc[v_i][4], ',') LOOP
        IF v_need = 'oo' AND v_oo IS NULL THEN
          v_nosubj := true;
        END IF;
      END LOOP;

      IF v_nosubj THEN
        r_cls[v_idx] := 'NOSUBJECT';
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          -- SETUP, as the owner. A missing object is MISSING; anything else is a TEST FAULT.
          IF sc[v_i][5] <> '' THEN
            BEGIN
              EXECUTE format(sc[v_i][5], v_o1, v_ov, v_inb, v_bid, v_oo, v_inb2, v_p1, v_ps1, v_ptmp,
                             v_ptmp2, v_asg, v_asgx, v_xbid, v_ybid, v_zbid, v_rev);
            EXCEPTION WHEN OTHERS THEN
              IF SQLSTATE IN ('42P01', '42703', '42883') THEN
                RAISE EXCEPTION 'setup: object missing' USING ERRCODE = 'LG096';
              ELSE
                RAISE EXCEPTION 'setup failed (%): %', SQLSTATE, left(SQLERRM, 140) USING ERRCODE = 'LG098';
              END IF;
            END;
          END IF;

          -- IMPERSONATION, proved.
          BEGIN
            IF v_actor = 'anon' THEN
              SET LOCAL ROLE anon;
              IF current_user <> 'anon' OR auth.uid() IS NOT NULL THEN
                RAISE EXCEPTION 'impersonation mismatch (anon): current_user is %, uid %', current_user, auth.uid();
              END IF;
            ELSIF v_actor = 'svc' THEN
              PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
              SET LOCAL ROLE service_role;
              IF current_user <> 'service_role' OR auth.uid() IS NOT NULL THEN
                RAISE EXCEPTION 'impersonation mismatch (svc): current_user is %, uid %', current_user, auth.uid();
              END IF;
            ELSE
              PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
              PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
              SET LOCAL ROLE authenticated;
              IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_uid THEN
                RAISE EXCEPTION 'impersonation mismatch (%): auth.uid() is %, expected %', v_actor, auth.uid(), v_uid;
              END IF;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'impersonation failed (%): %', SQLSTATE, left(SQLERRM, 140) USING ERRCODE = 'LG098';
          END;

          v_parts := string_to_array(
            format(sc[v_i][6], v_o1, v_ov, v_inb, v_bid, v_oo, v_inb2, v_p1, v_ps1, v_ptmp,
                   v_ptmp2, v_asg, v_asgx, v_xbid, v_ybid, v_zbid, v_rev),
            '|NEXT|');
          FOR v_k IN 1 .. array_length(v_parts, 1) - 1 LOOP
            EXECUTE v_parts[v_k];
          END LOOP;
          EXECUTE v_parts[array_length(v_parts, 1)] INTO v_txt;
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);

          r_cls[v_idx] := 'OK:' || coalesce(v_txt, 'NULL');
          RAISE EXCEPTION 'scenario % complete: undoing it', sc[v_i][1] USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN
            NULL;
          WHEN OTHERS THEN
            r_cls[v_idx] := CASE
              WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
              WHEN SQLSTATE IN ('LG096', '42P01', '42703', '42883') THEN 'MISSING'
              ELSE 'E:' || SQLSTATE
            END;
        END;
      END IF;

      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      EXECUTE v_fp_sql INTO v_fp;
      v_iso_runs := v_iso_runs + 1;
      IF v_fp IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc[v_i][1] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;

    -- The migration code, executed between phases, in this transaction, as the owner.
    IF v_ph = 1 THEN
      RESET ROLE;
      PERFORM set_config('request.jwt.claims',    '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      EXECUTE v_rows_sql INTO v_rows_before;
      BEGIN
        EXECUTE $m121$
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
        $m121$;
      EXCEPTION WHEN OTHERS THEN
        v_apply_err := v_apply_err || ('121 raised ' || SQLSTATE || ': ' || left(SQLERRM, 300));
      END;
      EXECUTE v_rows_sql INTO v_rows_after;
    END IF;
  END LOOP;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  EXECUTE $c$SELECT count(*) FROM pg_policies WHERE schemaname = 'public'$c$ INTO v_cnt_after;
  EXECUTE v_pol_sql  INTO v_pol_after;
  EXECUTE v_polx_sql INTO v_polx_after;
  EXECUTE v_acl_sql  INTO v_acl_after;
  EXECUTE v_trg_sql  INTO v_trg_after;

  ---------------------------------------------------------------------
  -- JUDGEMENT, exactly 118's: phase 1 mismatch INCONCLUSIVE, phase 2 mismatch FAIL.
  -- An expectation may list several accepted values separated by ' OR '.
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    v_ran := v_ran + 1;
    v_logged := v_logged + 1;
    v_ba := v_ba || '  ' || sc[v_i][2] || E'\n';
    v_st := 'PASS';
    v_detail := '';
    v_same := true;
    v_all_nosubj := true;
    FOR v_k IN 1 .. c_phases LOOP
      v_idx := (v_i - 1) * c_phases + v_k;
      v_cls := r_cls[v_idx];
      v_exp := sc[v_i][6 + v_k];
      IF v_exp IS DISTINCT FROM sc[v_i][7] THEN v_same := false; END IF;
      IF v_cls <> 'NOSUBJECT' THEN v_all_nosubj := false; END IF;
      v_ba := v_ba || format(E'      phase %s : %s   (expected %s)\n', v_k, v_cls, v_exp);
      IF v_cls LIKE 'FAULT%' OR v_cls = 'NOSUBJECT' OR v_cls = 'NOT RUN' THEN
        IF v_st = 'PASS' THEN v_st := 'INCONCLUSIVE'; END IF;
        v_detail := v_detail || format(' [phase %s: %s]', v_k, CASE WHEN v_cls = 'NOSUBJECT' THEN 'NO SUBJECT' ELSE v_cls END);
      ELSIF NOT (v_cls = ANY (string_to_array(v_exp, ' OR '))) THEN
        IF v_k = 1 THEN
          IF v_st = 'PASS' THEN v_st := 'INCONCLUSIVE'; END IF;
          v_detail := v_detail || format(' [BEFORE state is not what the test assumes: got %s, expected %s]', v_cls, v_exp);
        ELSE
          v_st := 'FAIL';
          v_detail := v_detail || format(' [phase %s: got %s, expected %s]', v_k, v_cls, v_exp);
        END IF;
      END IF;
    END LOOP;
    IF v_st = 'PASS' AND v_same THEN v_detail := v_detail || ' (NOT DISCRIMINATING: same expectation in every phase)'; END IF;
    IF v_st = 'INCONCLUSIVE' AND v_all_nosubj AND sc[v_i][1] = ANY (c_by_design) THEN
      v_inconc_dsg := v_inconc_dsg + 1;
      v_dsg_ids := v_dsg_ids || CASE WHEN v_dsg_ids = '' THEN '' ELSE ', ' END || sc[v_i][1];
    END IF;
    IF v_st = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_st = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1; END IF;
    v_lines := v_lines || E'\n  ' || rpad(sc[v_i][2], 66) || rpad(v_st, 14) || v_detail;
  END LOOP;

  -- S1. The public policy count is 161 before and after.
  v_ok := v_cnt_before = 161 AND v_cnt_after = 161;
  v_detail := format('(before %s ; after %s ; expected 161 and 161)', v_cnt_before, v_cnt_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S1  public policy count 161 before and after', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S1  public policy count 161 before and after', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S2. No policy other than the one altered changed.
  v_ok := v_pol_before IS NOT DISTINCT FROM v_pol_after;
  v_detail := format('(before %s ; after %s)', v_pol_before, v_pol_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no other policy changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S2  no other policy changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S3. The altered policy keeps its command, roles and USING; its WITH CHECK names ruling (b).
  SELECT v_polx_before IS NOT DISTINCT FROM v_polx_after
         AND v_polx_after LIKE 'ALL|authenticated|%'
         AND bool_and(with_check LIKE '%response_id%' AND with_check LIKE '%vendor_org_id%'
                      AND with_check LIKE '%assignment_id%' AND with_check LIKE '%project_assignments%'
                      AND with_check LIKE '%projects%' AND with_check LIKE '%lead_org_id%'
                      AND with_check LIKE '%current_user_org_ids%')
         AND count(*) = 1
    INTO v_ok
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
    AND policyname = 'Agencies manage own delivery reviews';
  v_ok := coalesce(v_ok, false);
  v_detail := format('(command, roles, USING before %s ; after %s)', v_polx_before, v_polx_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S3  review policy: ALL, same USING, check adds bid and assignment', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S3  review policy: ALL, same USING, check adds bid and assignment', 66) || rpad('FAIL', 14) || v_detail || ' (read 121''s V3)'; END IF;

  -- S4. No table, column or function grant changed outside the new function.
  v_ok := v_acl_before IS NOT DISTINCT FROM v_acl_after;
  v_detail := format('(before %s ; after %s)', v_acl_before, v_acl_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S4  no grant outside the new function changed', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S4  no grant outside the new function changed', 66) || rpad('FAIL', 14) || v_detail; END IF;

  -- S5. The guard function: SECURITY INVOKER, search_path pinned, no EXECUTE for anon,
  --     authenticated or PUBLIC.
  SELECT NOT p.prosecdef
         AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    INTO v_ok
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'partner_rfp_responses_vendor_write_guard' AND p.pronargs = 0;
  v_ok := coalesce(v_ok, false);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S5  guard: invoker, pinned; anon, authenticated, PUBLIC no EXECUTE', 66) || rpad('PASS', 14);
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S5  guard: invoker, pinned; anon, authenticated, PUBLIC no EXECUTE', 66) || rpad('FAIL', 14) || '(read 121''s V2)'; END IF;

  -- S6. The trigger: enabled, BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype 23), on
  --     partner_rfp_responses, calling the guard; every other trigger on the two tables unchanged.
  SELECT count(*) = 1
         AND bool_and(t.tgenabled::text = 'O' AND t.tgtype = 23 AND p.proname = 'partner_rfp_responses_vendor_write_guard')
    INTO v_ok
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass AND NOT t.tgisinternal
    AND t.tgname = 'partner_rfp_responses_vendor_write_guard';
  v_ok := coalesce(v_ok, false) AND v_trg_before IS NOT DISTINCT FROM v_trg_after;
  v_detail := format('(other triggers before %s ; after %s)', v_trg_before, v_trg_after);
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S6  trigger BEFORE INS/UPD row, enabled; others unchanged', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S6  trigger BEFORE INS/UPD row, enabled; others unchanged', 66) || rpad('FAIL', 14) || v_detail || ' (read 121''s V1)'; END IF;

  -- S7. 121 writes no row of either table.
  v_ok := v_rows_before IS NOT NULL AND v_rows_before IS NOT DISTINCT FROM v_rows_after;
  v_detail := format('(before %s ; after %s)', coalesce(v_rows_before, 'unread'), coalesce(v_rows_after, 'unread'));
  v_ran := v_ran + 1; v_logged := v_logged + 1;
  IF v_ok THEN v_pass := v_pass + 1; v_lines := v_lines || E'\n  ' || rpad('S7  bids and reviews unchanged by the migration', 66) || rpad('PASS', 14) || v_detail;
  ELSE v_fail := v_fail + 1; v_lines := v_lines || E'\n  ' || rpad('S7  bids and reviews unchanged by the migration', 66) || rpad('FAIL', 14) || v_detail; END IF;

  ---------------------------------------------------------------------
  -- VERDICT + REPORT. Self-checks outrank everything.
  ---------------------------------------------------------------------
  IF array_length(v_apply_err, 1) IS NOT NULL THEN
    v_fail := v_fail + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 66) || rpad('FAIL', 14) || array_to_string(v_apply_err, ' | ');
  ELSE
    v_pass := v_pass + 1;
    v_lines := v_lines || E'\n  ' || rpad('M   the migration code ran without error', 66) || rpad('PASS', 14) || '(the inlined migration executed to the end)';
  END IF;
  v_ran := v_ran + 1; v_logged := v_logged + 1;

  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected + 1 OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 121.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected + 1, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected + 1 THEN
    v_verdict_text := 'SAFE TO APPLY 121.';
    v_headline := format('SAFE TO APPLY 121.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised (none is INCONCLUSIVE by design). Settle it before applying.';
    v_headline := format('DO NOT APPLY 121 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 121 does what it claims.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 121.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s: 60 scenarios + 7 self-checks + M)\n', v_ran, c_expected + 1)
    || format(E'PASS            : %s\n', v_pass)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0; none by design; NO SUBJECT counts here)\n', v_inconc)
    || format(E'isolation check : %s scenario run(s) compared to the pre-phase fingerprint of partner_rfp_responses, delivery_reviews, partner_rfp_inbox, project_assignments, projects: %s\n',
              v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'policies        : %s public before, %s after (expected 161 and 161)\n', v_cnt_before, v_cnt_after)
    || format(E'SUBJECT         : lead org %s, project %s, agency member %s; vendor %s of org %s on partnership %s; third org %s\n',
              coalesce(v_o1::text, 'NONE'), coalesce(v_p1::text, 'NONE'), coalesce(v_u1::text, 'NONE'),
              coalesce(v_uv::text, 'NONE'), coalesce(v_ov::text, 'NONE'), coalesce(v_ps1::text, 'NONE'),
              coalesce(v_oo::text, 'NONE'))
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nEVERY SCENARIO, IN EVERY PHASE\n  phase 1 = BEFORE 121\n  phase 2 = AFTER 121\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

-- THE BACKSTOP. Not reached on the expected path (the DO block ends in RAISE EXCEPTION).
ROLLBACK;
