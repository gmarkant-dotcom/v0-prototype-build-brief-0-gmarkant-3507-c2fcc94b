-- =====================================================================
-- 104 PRE-APPLY TEST. ONE PASTE. APPLIES 104, WRITES, THEN ROLLS BACK.
--
-- AUTHORED 2026-10-08 on feat/client-required-and-spine. PARSE-CHECKED ONLY.
-- NOT RUN. GENERATED FROM 104_budget_ledger.sql (and, when 103 is absent,
-- 103_budget_core.sql): the DDL this file applies is the migrations' own,
-- statement by statement, so the test and the migrations cannot drift.
--
-- WHY THIS FILE EXISTS. 104 carries the ONLY vendor-facing policy in the budget
-- schema. A policy that admits too much leaks the agency's receipts to vendors;
-- one that admits too little hides a vendor's own record of its billing from
-- it, which the ruling forbids. Both raise nothing at apply time. This file
-- writes first, inside a transaction that rolls back.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--   1. Paste THIS ENTIRE FILE into one Supabase SQL Editor tab.
--   2. Run it ONCE, as one statement batch. Do NOT run it in pieces.
--   3. READ THE ERROR MESSAGE. That is where the result is.
--
-- >>> THIS FILE ENDS IN AN ERROR. THE ERROR IS THE RESULT. <<<
-- >>> "Success. No rows returned" MEANS THE RUN DID NOT WORK. <<<
--
-- The DO block finishes with RAISE EXCEPTION carrying the whole report. It defines
-- NO function in pg_temp and creates NO temp table (the SQL Editor answers 3F000
-- to both, which is why migration 101's test could never run).
--
-- READ THE FIRST LINE:
--     "SAFE TO APPLY 104."       -> and only this.
--     "DO NOT APPLY 104 YET."    -> INCONCLUSIVE. A NO SUBJECT on the clause (i)
--                                   pair (I1, I2) is exactly this: that
--                                   assertion is the one most likely to be
--                                   missing and the one that matters most.
--     "DO NOT APPLY 104."        -> a scenario FAILED, or the test is broken.
--
-- 103 DOES NOT HAVE TO BE APPLIED FOR THIS TEST. If it is absent the test applies
-- it first, inside the same rolled-back transaction (the report says which). 104
-- ITSELF REFUSES TO APPLY WITHOUT 103: apply 103 first, for real.
--
-- =====================================================================
-- WHAT IT PROVES (the mandatory assertions are marked)
-- =====================================================================
--   * [R1]  a vendor CAN read a document it uploaded
--   * [R2]  a vendor CAN read an agency document with the toggle ON
--   * [R3]  a vendor CANNOT read one with the toggle OFF
--   * [T1]  a vendor CAN STILL read its OWN document AFTER TERMINATION (and after removal, T4)
--   * [T2]  a vendor CANNOT read an agency document AFTER TERMINATION (and after removal, T5)
--   * [I1]  A VENDOR CANNOT READ A TOGGLE-ON DOCUMENT BELONGING TO A PARTNERSHIP IT
--           IS NOT PART OF. This tests clause (i). I2 does the same for another
--           vendor's own document.
--   * [L1,L2] a vendor CANNOT read any ledger entry, including one extracted from its own invoice
--   * [G2,G4] an agency COLLEAGUE can read every document and every entry in the organization
--   * suspension is NOT an ending (SU1, SU2); a pending invitation can read a toggle-on document (SU3)
--   * the toggle works in both directions (TG1, TG2); archiving hides nothing (AR1)
--   * a vendor cannot write anything (W1 to W7); an agency member cannot forge vendor
--     authorship (G6), relabel it (G9), detach a document (G10), or file one under a
--     stranger's partnership (G7)
--   * an entry's original category is set on insert and never rewritten (G16 to G19);
--     credits are negative (G20); cross-project filing is refused (G22, G23)
--   * no DELETE policy exists (G13, G14, W3, W7)
--   * nothing in another agency is reachable (X1 to X8)
--
-- =====================================================================
-- IT IMPERSONATES, AND PROVES IT DID
-- =====================================================================
-- Each scenario sets request.jwt.claims and request.jwt.claim.sub, then SET LOCAL ROLE
-- authenticated, then READS auth.uid() BACK and raises LG098 if it is not the intended user;
-- LG098 is INCONCLUSIVE ("TEST FAULT"), never a pass.
--
-- A ZERO IS ONLY EVIDENCE IF THE ROW IS THERE. Every "cannot read" / "cannot write" scenario is
-- run twice: as the OWNER (bypasses row level security; must see / do it) and as the ACTOR. If the
-- owner cannot, the verdict is INCONCLUSIVE ("NOT DISCRIMINATING"), never a pass.
--
-- PARTNERSHIP STATUS is moved by the test AS THE OWNER (auth.uid() NULL, so 087, 093 and 102 do not
-- refuse it) inside the scenario's own nested block, and undone with it. A fingerprint of the two
-- tables, the budget tables and every partnership row is recomputed after EACH scenario; any
-- difference ends the run with "THE TEST ITSELF IS BROKEN".
--
-- SUBJECTS (read-only apart from the rolled-back seed): an organization with a project, a member,
-- and a partnership whose vendor organization has a member outside it (the vendor, ps1); a colleague
-- in the same organization; a SECOND partnership of a DIFFERENT vendor (ps2, for clause (i)); a
-- partnership of a different lead organization (ps3, for the stranger test); and a second agency.
-- A SUBJECT THAT CANNOT BE FOUND IS REPORTED AS NO SUBJECT, NEVER PASSED.
--
-- UNVERIFIED UNTIL THE FIRST RUN (recalled from the PostgreSQL documentation, not executed):
--   * EXECUTE of each statement, then use of the new tables in the same transaction.
--   * RLS WITH CHECK is evaluated before NOT NULL / CHECK constraints and BEFORE-trigger errors
--     for rows the caller may not write: the X and G6 scenarios expect 42501, not 23514.
--   * A BEFORE ROW trigger that assigns NEW.original_category_id runs before the NOT NULL check, so
--     an insert that omits the column succeeds (G18).
--   * Updating partnerships.status as the owner passes the partnerships triggers (their
--     auth.uid() IS NULL exits). P2 in migration 102 lists any trigger this does not account for.
--
-- THE NUMBER OF ASSERTIONS is c_expected below (75 = 64 scenarios + 11
-- structural). Change it with the scenario list.
-- =====================================================================

BEGIN;

DO $test$
DECLARE
  c_expected     CONSTANT integer := 75;
  v_ids          text[];
  v_actor_keys   text[]  := ARRAY[]::text[];
  v_actor_uids   uuid[]  := ARRAY[]::uuid[];
  v_have         jsonb   := '{}'::jsonb;
  v_uid          uuid;
  v_val          integer;
  v_actor        text;
  v_i            integer;
  v_ph           integer;
  v_idx          integer;
  v_n            integer;
  v_s            integer;
  v_k            text;
  v_stmt         text;
  v_missing      text;
  v_fp0          text;
  v_fp           text;
  v_iso_runs     integer := 0;
  v_iso_bad      integer := 0;
  v_iso_note     text := '';
  v_present      boolean;
  v_partial      boolean;
  v_pass         integer := 0;
  v_fail         integer := 0;
  v_inconc       integer := 0;
  v_ran          integer := 0;
  v_logged       integer := 0;
  v_lines        text := '';
  v_ba           text := '';
  v_info         text := '';
  v_headline     text;
  v_verdict_text text;
  v_report       text;
  v_ok           boolean;
  v_detail       text;
  v_verdict      text;
  v_note         text;
  v_exp          text;
  v_expn         integer;
  v_tc           text;
  v_ac           text;
  v_twin_ok      boolean;
  v_o1 uuid; v_p1 uuid; v_o2 uuid; v_p2 uuid; v_ps1 uuid; v_ps2 uuid; v_pj2 uuid; v_ps3 uuid;
  v_u1 uuid; v_u1b uuid; v_u2 uuid; v_uv uuid; v_ov uuid;
  v_a integer; v_b integer; v_c integer; v_d integer; v_t text; v_c_t text;
  v_103_present boolean;
  v_tables text[]    := ARRAY['source_documents', 'ledger_entries'];
  v_tables103 text[] := ARRAY['budget_template_categories', 'budget_project_categories', 'budget_lines', 'budget_category_merges'];
  v_excl text[]; v_added integer;
  v_pol_before text; v_pol_after text; v_pol_cnt_before integer;

  sc_id     text[];
  sc_label  text[];
  sc_actor  text[];
  sc_need   text[];
  sc_setup  text[];
  sc_sql    text[];
  sc_chk    text[];
  sc_expect text[];
  sc_twin   boolean[];
  seed_sql  text[];
  seed_need text[];
  r_cls     text[];
  r_val     integer[];
BEGIN
  ---------------------------------------------------------------------
  -- SUBJECT. NO SUBJECT IS REPORTED, NEVER PASSED.
  ---------------------------------------------------------------------
  SELECT vm.user_id, ps.vendor_org_id, ps.id, ps.lead_org_id
    INTO v_uv, v_ov, v_ps1, v_o1
  FROM public.partnerships ps
  JOIN public.org_members vm ON vm.org_id = ps.vendor_org_id
  WHERE ps.vendor_org_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = ps.lead_org_id)
    AND EXISTS (SELECT 1 FROM public.projects pr WHERE pr.org_id = ps.lead_org_id)
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.user_id = vm.user_id AND x.org_id = ps.lead_org_id)
  ORDER BY ((SELECT count(*) FROM public.org_members m2 WHERE m2.org_id = ps.lead_org_id) >= 2) DESC,
           (EXISTS (SELECT 1 FROM public.project_assignments pa WHERE pa.partnership_id = ps.id)) DESC,
           ps.id, vm.user_id
  LIMIT 1;

  IF v_ps1 IS NULL THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 104 YET.  NO SUBJECT: no partnership has a vendor organization with a member outside a lead organization that has a project and a member. Nothing was tested. This is not a pass.\n=====================================================\n';
  END IF;

  SELECT pr.id INTO v_p1 FROM public.projects pr WHERE pr.org_id = v_o1 ORDER BY pr.id LIMIT 1;

  SELECT m.user_id INTO v_u1 FROM public.org_members m WHERE m.org_id = v_o1
  ORDER BY (m.role = 'owner') DESC, m.user_id LIMIT 1;

  SELECT m.user_id INTO v_u1b FROM public.org_members m WHERE m.org_id = v_o1 AND m.user_id <> v_u1
  ORDER BY m.user_id LIMIT 1;

  -- CLAUSE (i): a second partnership, of a DIFFERENT vendor organization the vendor user is not in,
  -- whose lead organization has a project to hang a document on. Prefer one on the same lead.
  SELECT ps.id, pr.id
    INTO v_ps2, v_pj2
  FROM public.partnerships ps
  JOIN public.projects pr ON pr.org_id = ps.lead_org_id
  WHERE ps.vendor_org_id IS NOT NULL
    AND ps.id <> v_ps1
    AND ps.vendor_org_id <> v_ov
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.org_id = ps.vendor_org_id AND x.user_id = v_uv)
  ORDER BY (ps.lead_org_id = v_o1) DESC, ps.id, pr.id
  LIMIT 1;

  -- A partnership of a lead organization other than v_o1, to prove an agency cannot file its own
  -- document under a stranger's partnership.
  SELECT ps.id INTO v_ps3 FROM public.partnerships ps
  WHERE ps.lead_org_id <> v_o1
  ORDER BY ps.id LIMIT 1;

  SELECT pr.org_id, pr.id
    INTO v_o2, v_p2
  FROM public.projects pr
  WHERE pr.org_id <> v_o1
    AND EXISTS (SELECT 1 FROM public.org_members m
                WHERE m.org_id = pr.org_id AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_o1))
    AND NOT EXISTS (SELECT 1 FROM public.org_members x WHERE x.org_id = pr.org_id AND x.user_id IN (v_u1, v_uv))
  ORDER BY pr.id
  LIMIT 1;

  IF v_o2 IS NOT NULL THEN
    SELECT m.user_id INTO v_u2 FROM public.org_members m
    WHERE m.org_id = v_o2 AND m.user_id NOT IN (SELECT user_id FROM public.org_members WHERE org_id = v_o1)
    ORDER BY m.user_id LIMIT 1;
  END IF;

  v_ids := ARRAY[v_o1::text, v_p1::text, v_o2::text, v_p2::text, v_ps1::text, v_ps2::text, v_pj2::text, v_ps3::text,
                 gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                 gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                 gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                 gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                 gen_random_uuid()::text, gen_random_uuid()::text];
  v_actor_keys := ARRAY['m1', 'm1b', 'm2', 'vendor'];
  v_actor_uids := ARRAY[v_u1, v_u1b, v_u2, v_uv];
  v_have := jsonb_build_object('m1', v_u1 IS NOT NULL, 'm1b', v_u1b IS NOT NULL,
                               'm2', v_u2 IS NOT NULL AND v_o2 IS NOT NULL,
                               'vendor', v_uv IS NOT NULL, 'o2', v_o2 IS NOT NULL,
                               'ps2', v_ps2 IS NOT NULL, 'ps3', v_ps3 IS NOT NULL);

  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'owner state not clean at start: auth.uid() is %', auth.uid() USING ERRCODE = 'LG098';
  END IF;

  ---------------------------------------------------------------------
  -- THE SCENARIOS. Parallel arrays; position i describes scenario i.
  -- sc_sql returns ONE integer. %N$L placeholders are the subject and
  -- seed ids (v_ids). sc_expect: N:k exact, G:k at least, E:code an
  -- error with that SQLSTATE, I informational (not counted).
  -- sc_twin: also run it as the OWNER first; an expected zero or an
  -- expected 42501 is only evidence if the owner can see / write the row.
  ---------------------------------------------------------------------
  sc_id := ARRAY['K1', 'K2', 'K3', 'R1', 'R2', 'R3', 'R4', 'R5', 'SU1', 'SU2', 'SU3', 'T1', 'T2', 'T3', 'T4', 'T5', 'TG1', 'TG2', 'AR1', 'I1', 'I2', 'I3', 'I4', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'L1', 'L2', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'AR2', 'G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G19', 'G20', 'G21', 'G22', 'G23', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8'];
  sc_label := ARRAY[
    $q$K1 control: owner sees the four project documents$q$,
    $q$K2 control: owner sees the three ledger entries$q$,
    $q$K3 control: the vendor is the vendor side of ps1$q$,
    $q$R1  vendor reads a document it provided$q$,
    $q$R2  vendor reads an agency document, toggle ON$q$,
    $q$R3  vendor CANNOT read an agency document, toggle OFF$q$,
    $q$R4  vendor CANNOT read a document with no partnership$q$,
    $q$R5  of four documents the vendor reads exactly two$q$,
    $q$SU1 SUSPENDED: vendor still reads the toggle-on document$q$,
    $q$SU2 SUSPENDED: vendor still reads its own document$q$,
    $q$SU3 PENDING: vendor reads the toggle-on document$q$,
    $q$T1  TERMINATED: vendor STILL reads its own document$q$,
    $q$T2  TERMINATED: vendor CANNOT read the toggle-on document$q$,
    $q$T3  TERMINATED: of four documents the vendor reads one$q$,
    $q$T4  REMOVED: vendor STILL reads its own document$q$,
    $q$T5  REMOVED: vendor CANNOT read the toggle-on document$q$,
    $q$TG1 toggle turned OFF: vendor loses the document$q$,
    $q$TG2 toggle turned ON: vendor gains the document$q$,
    $q$AR1 an ARCHIVED toggle-on document stays readable$q$,
    $q$I1  vendor CANNOT read a toggle-on doc of ANOTHER partnership$q$,
    $q$I2  vendor CANNOT read ANOTHER vendor's own document$q$,
    $q$I3  control: owner sees both foreign documents$q$,
    $q$I4  of own plus foreign documents the vendor reads two$q$,
    $q$W1  vendor inserts a document$q$,
    $q$W2  vendor flips a document's toggle$q$,
    $q$W3  vendor deletes its own document$q$,
    $q$W4  vendor archives its own document$q$,
    $q$W5  vendor inserts a ledger entry$q$,
    $q$W6  vendor updates a ledger entry$q$,
    $q$W7  vendor deletes a ledger entry$q$,
    $q$L1  vendor CANNOT read an entry from its OWN invoice$q$,
    $q$L2  vendor CANNOT read any ledger entry$q$,
    $q$G1  member reads every document$q$,
    $q$G2  COLLEAGUE reads every document$q$,
    $q$G3  member reads every ledger entry$q$,
    $q$G4  COLLEAGUE reads every ledger entry$q$,
    $q$G5  member files an agency document for ps1$q$,
    $q$G6  member FORGES a vendor-provided document$q$,
    $q$G7  member files a document under a stranger's partnership$q$,
    $q$G8  toggle on a document with no partnership$q$,
    $q$G9  member relabels a vendor-provided document 'agency'$q$,
    $q$G10 member detaches a document from its partnership$q$,
    $q$G11 member SHARES an unshared document (NULL to ps1)$q$,
    $q$G12 member turns a document's toggle on$q$,
    $q$AR2 member archives a document$q$,
    $q$G13 member deletes a document (no DELETE policy)$q$,
    $q$G14 member deletes a ledger entry (no DELETE policy)$q$,
    $q$G15 colleague corrects an entry's amount$q$,
    $q$G16 member rewrites an entry's original category$q$,
    $q$G17 re-filing an entry keeps its original category$q$,
    $q$G18 a new entry's original category is set from its category$q$,
    $q$G19 an entry whose original differs from its category$q$,
    $q$G20 a CREDIT: a negative amount is accepted$q$,
    $q$G21 entry on a line of the same project$q$,
    $q$G22 entry filed under another project's document$q$,
    $q$G23 entry filed under another project's category$q$,
    $q$X1  other agency's document: read$q$,
    $q$X2  other agency's ledger entry: read$q$,
    $q$X3  insert a document on the other project$q$,
    $q$X4  insert an entry on the other project$q$,
    $q$X5  other agency's document: update$q$,
    $q$X6  control: the other agency reads its own document$q$,
    $q$X7  the other agency CANNOT read the first's document$q$,
    $q$X8  the other agency CANNOT read the first's entry$q$];
  sc_actor := ARRAY['owner', 'owner', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'owner', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'm1', 'm1b', 'm1', 'm1b', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1b', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm2', 'm2', 'm2'];
  sc_need := ARRAY['', '', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor,ps2', 'vendor,ps2', 'ps2', 'vendor,ps2', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'm1', 'm1b', 'm1', 'm1b', 'm1', 'm1', 'm1,ps3', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1b', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm1,o2', 'm2,o2', 'm2,o2', 'm2,o2'];
  sc_setup := ARRAY[
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$UPDATE public.partnerships SET status = 'suspended' WHERE id = %5$L$q$,
    $q$UPDATE public.partnerships SET status = 'suspended' WHERE id = %5$L$q$,
    $q$UPDATE public.partnerships SET status = 'pending' WHERE id = %5$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated' WHERE id = %5$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated' WHERE id = %5$L$q$,
    $q$UPDATE public.partnerships SET status = 'terminated' WHERE id = %5$L$q$,
    $q$UPDATE public.partnerships SET status = 'removed' WHERE id = %5$L$q$,
    $q$UPDATE public.partnerships SET status = 'removed' WHERE id = %5$L$q$,
    $q$UPDATE public.source_documents SET visible_to_vendor = false WHERE id = %13$L$q$,
    $q$UPDATE public.source_documents SET visible_to_vendor = true WHERE id = %12$L$q$,
    $q$UPDATE public.source_documents SET archived_at = now() WHERE id = %13$L$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$DELETE FROM public.ledger_entries WHERE id = %20$L$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$];
  sc_sql := ARRAY[
    $q$SELECT count(*)::int FROM public.source_documents WHERE id IN (%12$L, %13$L, %14$L, %15$L)$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id IN (%19$L, %20$L, %21$L)$q$,
    $q$SELECT count(*)::int FROM public.partnerships WHERE id = %5$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %14$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %12$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %15$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id IN (%12$L, %13$L, %14$L, %15$L)$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %14$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %14$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id IN (%12$L, %13$L, %14$L, %15$L)$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %14$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %12$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %13$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %17$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %18$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id IN (%17$L, %18$L)$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id IN (%13$L, %17$L, %18$L, %14$L)$q$,
    $q$WITH x AS (INSERT INTO public.source_documents (project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%2$L, %5$L, 'vendor', false, 'new.pdf', 'test/new.pdf') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET visible_to_vendor = true WHERE id = %12$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.source_documents WHERE id = %14$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET archived_at = now() WHERE id = %14$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (project_id, source_document_id, category_id, amount) VALUES (%2$L, %12$L, %9$L, 9.99) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.ledger_entries SET amount = 1 WHERE id = %20$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.ledger_entries WHERE id = %20$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id = %20$L$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id IN (%19$L, %20$L, %21$L)$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id IN (%12$L, %13$L, %14$L, %15$L)$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id IN (%12$L, %13$L, %14$L, %15$L)$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id IN (%19$L, %20$L, %21$L)$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id IN (%19$L, %20$L, %21$L)$q$,
    $q$WITH x AS (INSERT INTO public.source_documents (project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%2$L, %5$L, 'agency', false, 'new.pdf', 'test/new.pdf') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.source_documents (project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%2$L, %5$L, 'vendor', false, 'new.pdf', 'test/new.pdf') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.source_documents (project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%2$L, %8$L, 'agency', false, 'new.pdf', 'test/new.pdf') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET visible_to_vendor = true WHERE id = %15$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET uploader_side = 'agency' WHERE id = %14$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET partnership_id = NULL, visible_to_vendor = false WHERE id = %13$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET partnership_id = %5$L WHERE id = %15$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET visible_to_vendor = true WHERE id = %12$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET archived_at = now() WHERE id = %12$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.source_documents WHERE id = %16$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (DELETE FROM public.ledger_entries WHERE id = %19$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.ledger_entries SET amount = 26.50 WHERE id = %19$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.ledger_entries SET original_category_id = %10$L WHERE id = %19$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.ledger_entries SET category_id = %10$L WHERE id = %19$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (id, project_id, source_document_id, category_id, amount) VALUES (%23$L, %2$L, %12$L, %10$L, 12.00) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (project_id, source_document_id, category_id, amount, original_category_id) VALUES (%2$L, %12$L, %10$L, 9.99, %9$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (project_id, source_document_id, category_id, amount) VALUES (%2$L, %12$L, %9$L, -42.50) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (project_id, source_document_id, category_id, amount, budget_line_id) VALUES (%2$L, %12$L, %9$L, 9.99, %11$L) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (project_id, source_document_id, category_id, amount) VALUES (%2$L, %25$L, %9$L, 9.99) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (project_id, source_document_id, category_id, amount) VALUES (%2$L, %12$L, %24$L, 9.99) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %25$L$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id = %26$L$q$,
    $q$WITH x AS (INSERT INTO public.source_documents (project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%4$L, NULL, 'agency', false, 'new.pdf', 'test/new.pdf') RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (INSERT INTO public.ledger_entries (project_id, source_document_id, category_id, amount) VALUES (%4$L, %25$L, %24$L, 9.99) RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$WITH x AS (UPDATE public.source_documents SET archived_at = now() WHERE id = %25$L RETURNING 1) SELECT count(*)::int FROM x$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %25$L$q$,
    $q$SELECT count(*)::int FROM public.source_documents WHERE id = %12$L$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id = %19$L$q$];
  sc_chk := ARRAY[
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id = %19$L AND category_id = %10$L AND original_category_id = %9$L$q$,
    $q$SELECT count(*)::int FROM public.ledger_entries WHERE id = %23$L AND category_id = %10$L AND original_category_id = %10$L$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$,
    $q$$q$];
  sc_expect := ARRAY['N:4', 'N:3', 'N:1', 'N:1', 'N:1', 'N:0', 'N:0', 'N:2', 'N:1', 'N:1', 'N:1', 'N:1', 'N:0', 'N:1', 'N:1', 'N:0', 'N:0', 'N:1', 'N:1', 'N:0', 'N:0', 'N:2', 'N:2', 'E:42501', 'N:0', 'N:0', 'N:0', 'E:42501', 'N:0', 'N:0', 'N:0', 'N:0', 'N:4', 'N:4', 'N:3', 'N:3', 'N:1', 'E:42501', 'E:23514', 'E:23514', 'E:23514', 'E:23514', 'N:1', 'N:1', 'N:1', 'N:0', 'N:0', 'N:1', 'E:23514', 'N:1', 'N:1', 'E:23514', 'N:1', 'N:1', 'E:23503', 'E:23503', 'N:0', 'N:0', 'E:42501', 'E:42501', 'N:0', 'N:1', 'N:0', 'N:0'];
  sc_twin := ARRAY[false, false, false, false, false, true, true, false, false, false, false, false, true, false, false, true, true, false, false, true, true, false, false, true, true, true, true, true, true, true, true, true, false, false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false, false, false, false, false, false, false, false, true, true, true, true, true, false, true, true]::boolean[];
  seed_sql := ARRAY[
    $q$UPDATE public.partnerships SET status = 'active' WHERE id = %5$L~|~INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%9$L, %2$L, 'C1', 'cost'), (%10$L, %2$L, 'C2', 'fee')~|~INSERT INTO public.budget_lines (id, project_id, category_id, name, estimate) VALUES (%11$L, %2$L, %9$L, 'L1', 100.00)~|~INSERT INTO public.source_documents (id, project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%12$L, %2$L, %5$L, 'agency', false, 'da.pdf', 'test/da'), (%13$L, %2$L, %5$L, 'agency', true, 'db.pdf', 'test/db'), (%14$L, %2$L, %5$L, 'vendor', false, 'dv.pdf', 'test/dv'), (%15$L, %2$L, NULL, 'agency', false, 'dn.pdf', 'test/dn'), (%16$L, %2$L, NULL, 'agency', false, 'dz.pdf', 'test/dz')~|~INSERT INTO public.ledger_entries (id, project_id, source_document_id, category_id, amount) VALUES (%19$L, %2$L, %12$L, %9$L, 25.00), (%20$L, %2$L, %14$L, %9$L, -10.00), (%21$L, %2$L, %15$L, %10$L, 5.00)$q$,
    $q$INSERT INTO public.source_documents (id, project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%17$L, %7$L, %6$L, 'agency', true, 'dfo.pdf', 'test/dfo'), (%18$L, %7$L, %6$L, 'vendor', false, 'dfv.pdf', 'test/dfv')$q$,
    $q$INSERT INTO public.budget_project_categories (id, project_id, name, fee_or_cost) VALUES (%24$L, %4$L, 'CX', 'cost')~|~INSERT INTO public.source_documents (id, project_id, partnership_id, uploader_side, visible_to_vendor, file_name, blob_path) VALUES (%25$L, %4$L, NULL, 'agency', false, 'dx.pdf', 'test/dx')~|~INSERT INTO public.ledger_entries (id, project_id, source_document_id, category_id, amount) VALUES (%26$L, %4$L, %25$L, %24$L, 7.00)$q$];
  seed_need := ARRAY['', 'ps2', 'o2'];

  v_n := array_length(sc_id, 1);
  IF v_n <> 64 OR array_length(sc_label, 1) <> v_n OR array_length(sc_actor, 1) <> v_n
     OR array_length(sc_need, 1) <> v_n OR array_length(sc_setup, 1) <> v_n
     OR array_length(sc_sql, 1) <> v_n OR array_length(sc_chk, 1) <> v_n
     OR array_length(sc_expect, 1) <> v_n OR array_length(sc_twin, 1) <> v_n THEN
    RAISE EXCEPTION 'THE TEST ITSELF IS BROKEN: the scenario arrays disagree in length (id %, label %, actor %, need %, setup %, sql %, chk %, expect %, twin %)',
      array_length(sc_id, 1), array_length(sc_label, 1), array_length(sc_actor, 1), array_length(sc_need, 1),
      array_length(sc_setup, 1), array_length(sc_sql, 1), array_length(sc_chk, 1), array_length(sc_expect, 1),
      array_length(sc_twin, 1);
  END IF;

  r_cls := array_fill('NOT RUN'::text, ARRAY[2 * v_n]);
  r_val := array_fill(NULL::integer,   ARRAY[2 * v_n]);

  ---------------------------------------------------------------------
  -- STATE BEFORE ANYTHING IS APPLIED.
  ---------------------------------------------------------------------
  SELECT count(*) INTO v_a FROM unnest(v_tables) AS t WHERE to_regclass('public.' || t) IS NOT NULL;
  SELECT count(*) INTO v_b FROM unnest(v_tables103) AS t WHERE to_regclass('public.' || t) IS NOT NULL;
  v_present     := (v_a = 2);
  v_103_present := (v_b = 4);
  v_partial     := (v_a = 1) OR (v_b BETWEEN 1 AND 3) OR (v_present AND NOT v_103_present);

  IF v_103_present THEN
    v_excl := v_tables;
    v_added := 7;
  ELSE
    v_excl := v_tables || v_tables103;
    v_added := 21;
  END IF;

  SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                 E'\n' ORDER BY tablename, policyname), ''))
    INTO v_pol_before
  FROM pg_policies WHERE schemaname = 'public' AND NOT (tablename = ANY (v_excl));
  SELECT count(*) INTO v_pol_cnt_before FROM pg_policies WHERE schemaname = 'public';

  IF v_partial THEN
    RAISE EXCEPTION E'\n=====================================================\nDO NOT APPLY 104 YET.  PARTIAL STATE: some but not all of the 104 objects already exist. Nothing was tested. Find out why before anything is applied.\n=====================================================\n';
  END IF;

  IF NOT v_present THEN
    -- 104 ITSELF, statement by statement, TAKEN FROM THE MIGRATION FILE BY A SCRIPT. The
    -- migration's own fail-closed pre-flight DO block is not repeated: the checks above report
    -- the same facts instead of raising.
        IF NOT v_103_present THEN
          -- 103 is NOT applied: apply it here, inside this rolled-back transaction, so 104 has what it
          -- depends on. Taken statement by statement from 103_budget_core.sql.
          EXECUTE $t103_00$CREATE TABLE public.budget_template_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  fee_or_cost text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_template_categories_name_present
    CHECK (btrim(name) <> ''),
  CONSTRAINT budget_template_categories_fee_or_cost_check
    CHECK (fee_or_cost IN ('fee', 'cost'))
)$t103_00$;

          EXECUTE $t103_01$COMMENT ON TABLE public.budget_template_categories IS
  'An agency''s house-standard chart of accounts: the categories every new project''s chart is '
  'COPIED from (ruling 2f). Copy-on-create, not a pointer: budget_project_categories carries no '
  'reference to a row here, so editing or deleting a template category changes no project. '
  'Agency-scoped; no vendor policy exists or may be added (ruling 2e).'$t103_01$;

          EXECUTE $t103_02$COMMENT ON COLUMN public.budget_template_categories.fee_or_cost IS
  'fee or cost (ruling 2b). NOT NULL with no default on purpose: margin is only computable '
  'because every category carries this flag, and a default would misclassify silently. '
  'A fee is what the agency earns; a cost is what it passes through or spends.'$t103_02$;

          EXECUTE $t103_03$CREATE INDEX budget_template_categories_org_idx
  ON public.budget_template_categories (org_id)$t103_03$;

          EXECUTE $t103_04$CREATE TABLE public.budget_project_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  fee_or_cost text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_project_categories_project_id_id_key
    UNIQUE (project_id, id),
  CONSTRAINT budget_project_categories_name_present
    CHECK (btrim(name) <> ''),
  CONSTRAINT budget_project_categories_fee_or_cost_check
    CHECK (fee_or_cost IN ('fee', 'cost'))
)$t103_04$;

          EXECUTE $t103_05$COMMENT ON TABLE public.budget_project_categories IS
  'A project''s chart of accounts, created as a COPY of the agency template and then owned by '
  'the project (ruling 2f). It starts equal to the template and diverges freely; nothing here '
  'points back at a template row. A category that has been merged away is NEVER deleted: it is '
  'named by a budget_category_merges row, which is what makes a ledger entry''s original '
  'category resolvable after the merge. Categories may be added at any time.'$t103_05$;

          EXECUTE $t103_06$CREATE TABLE public.budget_lines (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid          NOT NULL REFERENCES public.projects(id),
  category_id uuid          NOT NULL,
  name        text          NOT NULL,
  estimate    numeric(14,2) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT budget_lines_category_fkey
    FOREIGN KEY (project_id, category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT budget_lines_name_present
    CHECK (btrim(name) <> '')
)$t103_06$;

          EXECUTE $t103_07$COMMENT ON TABLE public.budget_lines IS
  'The master budget, one row per line, belonging to a PROJECT. The master budget is the working '
  'artifact the agency owns (ruling 2a), never a mirror of a spreadsheet. Agency-scoped; NO '
  'vendor policy exists or may be added: a vendor never sees the master budget (ruling 2e), and '
  'what a vendor sees travels in the RFP payload, which is a released artifact distinct from '
  'this row. THIS TABLE HOLDS THE ESTIMATE ONLY. Committed, Actual and Paid (ruling 2c) are not '
  'columns: each has a source elsewhere (awards and purchase orders, the ledger, payments) and '
  'whether they are stored or derived is open question 2 in docs/ligament-00-budgeting-spec.md. '
  'Nothing here links to an RFP, a bid or an award: that join is open question 4.'$t103_07$;

          EXECUTE $t103_08$COMMENT ON COLUMN public.budget_lines.estimate IS
  'What the line was budgeted at (ruling 2c, state one of four). numeric(14,2), the precision '
  'scripts/037-client-cash-flow.sql uses for money. NOT NULL with no default, and not constrained '
  'to be non-negative: a discount line is a real budget line. The currency is NOT recorded; see '
  'the report.'$t103_08$;

          EXECUTE $t103_09$CREATE INDEX budget_lines_project_category_idx
  ON public.budget_lines (project_id, category_id)$t103_09$;

          EXECUTE $t103_10$CREATE TABLE public.budget_category_merges (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_category_id uuid        NOT NULL,
  into_category_id uuid        NOT NULL,
  merged_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_category_merges_from_fkey
    FOREIGN KEY (project_id, from_category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT budget_category_merges_into_fkey
    FOREIGN KEY (project_id, into_category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT budget_category_merges_not_self
    CHECK (from_category_id <> into_category_id),
  CONSTRAINT budget_category_merges_from_once
    UNIQUE (from_category_id)
)$t103_10$;

          EXECUTE $t103_11$COMMENT ON TABLE public.budget_category_merges IS
  'Append-only record that one category of a project was merged into another (ruling 2f). The '
  'merged-away category row is kept so a ledger entry''s original category still resolves. No '
  'UPDATE and no DELETE policy exists, so history cannot be rewritten by an agency member. A '
  'category appears as from_category_id at most once and never as an into_category_id once it '
  'has been merged away (budget_category_merges_guard), so the chain has no cycle.'$t103_11$;

          EXECUTE $t103_12$CREATE INDEX budget_category_merges_into_idx
  ON public.budget_category_merges (into_category_id)$t103_12$;

          EXECUTE $t103_13$CREATE INDEX budget_category_merges_project_idx
  ON public.budget_category_merges (project_id)$t103_13$;

          EXECUTE $t103_14$CREATE FUNCTION public.budget_category_merges_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text, 103));

  IF EXISTS (
    SELECT 1 FROM public.budget_category_merges m
    WHERE m.from_category_id = NEW.into_category_id
  ) THEN
    RAISE EXCEPTION 'category % has itself been merged away and cannot receive a merge', NEW.into_category_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$$t103_14$;

          EXECUTE $t103_15$CREATE TRIGGER budget_category_merges_guard
  BEFORE INSERT ON public.budget_category_merges
  FOR EACH ROW
  EXECUTE FUNCTION public.budget_category_merges_guard()$t103_15$;

          EXECUTE $t103_16$REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM PUBLIC$t103_16$;

          EXECUTE $t103_17$REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM anon$t103_17$;

          EXECUTE $t103_18$REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM authenticated$t103_18$;

          EXECUTE $t103_19$REVOKE ALL ON TABLE public.budget_template_categories FROM PUBLIC$t103_19$;

          EXECUTE $t103_20$REVOKE ALL ON TABLE public.budget_template_categories FROM anon$t103_20$;

          EXECUTE $t103_21$REVOKE ALL ON TABLE public.budget_project_categories  FROM PUBLIC$t103_21$;

          EXECUTE $t103_22$REVOKE ALL ON TABLE public.budget_project_categories  FROM anon$t103_22$;

          EXECUTE $t103_23$REVOKE ALL ON TABLE public.budget_lines               FROM PUBLIC$t103_23$;

          EXECUTE $t103_24$REVOKE ALL ON TABLE public.budget_lines               FROM anon$t103_24$;

          EXECUTE $t103_25$REVOKE ALL ON TABLE public.budget_category_merges     FROM PUBLIC$t103_25$;

          EXECUTE $t103_26$REVOKE ALL ON TABLE public.budget_category_merges     FROM anon$t103_26$;

          EXECUTE $t103_27$ALTER TABLE public.budget_template_categories ENABLE ROW LEVEL SECURITY$t103_27$;

          EXECUTE $t103_28$ALTER TABLE public.budget_project_categories  ENABLE ROW LEVEL SECURITY$t103_28$;

          EXECUTE $t103_29$ALTER TABLE public.budget_lines               ENABLE ROW LEVEL SECURITY$t103_29$;

          EXECUTE $t103_30$ALTER TABLE public.budget_category_merges     ENABLE ROW LEVEL SECURITY$t103_30$;

          EXECUTE $t103_31$CREATE POLICY "budget_template_categories_org_select"
  ON public.budget_template_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))$t103_31$;

          EXECUTE $t103_32$CREATE POLICY "budget_template_categories_org_insert"
  ON public.budget_template_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()))$t103_32$;

          EXECUTE $t103_33$CREATE POLICY "budget_template_categories_org_update"
  ON public.budget_template_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()))$t103_33$;

          EXECUTE $t103_34$CREATE POLICY "budget_template_categories_org_delete"
  ON public.budget_template_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))$t103_34$;

          EXECUTE $t103_35$CREATE POLICY "budget_project_categories_org_select"
  ON public.budget_project_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_35$;

          EXECUTE $t103_36$CREATE POLICY "budget_project_categories_org_insert"
  ON public.budget_project_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_36$;

          EXECUTE $t103_37$CREATE POLICY "budget_project_categories_org_update"
  ON public.budget_project_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_37$;

          EXECUTE $t103_38$CREATE POLICY "budget_project_categories_org_delete"
  ON public.budget_project_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_38$;

          EXECUTE $t103_39$CREATE POLICY "budget_lines_org_select"
  ON public.budget_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_39$;

          EXECUTE $t103_40$CREATE POLICY "budget_lines_org_insert"
  ON public.budget_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_40$;

          EXECUTE $t103_41$CREATE POLICY "budget_lines_org_update"
  ON public.budget_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_41$;

          EXECUTE $t103_42$CREATE POLICY "budget_lines_org_delete"
  ON public.budget_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_42$;

          EXECUTE $t103_43$CREATE POLICY "budget_category_merges_org_select"
  ON public.budget_category_merges AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_43$;

          EXECUTE $t103_44$CREATE POLICY "budget_category_merges_org_insert"
  ON public.budget_category_merges AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t103_44$;
        END IF;

        -- 104 ITSELF, statement by statement, from 104_budget_ledger.sql.
        EXECUTE $t104_00$ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_project_id_id_key UNIQUE (project_id, id)$t104_00$;

        EXECUTE $t104_01$CREATE TABLE public.source_documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES public.projects(id),
  partnership_id    uuid        NULL     REFERENCES public.partnerships(id),
  uploader_side     text        NOT NULL,
  visible_to_vendor boolean     NOT NULL DEFAULT false,
  archived_at       timestamptz NULL,
  file_name         text        NOT NULL,
  blob_path         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_documents_project_id_id_key
    UNIQUE (project_id, id),
  CONSTRAINT source_documents_uploader_side_check
    CHECK (uploader_side IN ('agency', 'vendor')),
  -- A document the vendor provided belongs to that vendor's partnership from birth.
  CONSTRAINT source_documents_vendor_has_partnership
    CHECK (uploader_side <> 'vendor' OR partnership_id IS NOT NULL),
  -- The toggle is meaningless without a partnership to scope it to. A toggle that could be on
  -- with no partnership would read as shared and be visible to nobody.
  CONSTRAINT source_documents_toggle_needs_partnership
    CHECK (NOT visible_to_vendor OR partnership_id IS NOT NULL),
  CONSTRAINT source_documents_file_name_present
    CHECK (btrim(file_name) <> ''),
  CONSTRAINT source_documents_blob_path_present
    CHECK (btrim(blob_path) <> '')
)$t104_01$;

        EXECUTE $t104_02$COMMENT ON TABLE public.source_documents IS
  'A receipt, invoice or statement filed against a project: the FILE, not the spend. One document '
  'produces many ledger_entries (spec finding 1). Owned by the lead agency that owns the project. '
  'A vendor reads a row ONLY through source_documents_vendor_select: when the row belongs to a '
  'partnership the vendor is the vendor side of, AND (the vendor uploaded it, which is permanent '
  'and survives termination, OR the lead agency turned the per-document toggle on and the '
  'partnership has not ended). uploader_side, project_id and (once set) partnership_id are '
  'immutable, so the permanent right cannot be revoked by an UPDATE. No DELETE policy: nothing is '
  'destroyed. The row is not the file: the bytes live in the private Blob store and whatever serves '
  'them must resolve this row under the caller''s own session first.'$t104_02$;

        EXECUTE $t104_03$COMMENT ON COLUMN public.source_documents.uploader_side IS
  'Who PROVIDED the document: agency or vendor. Added by migration 104 to express authorship, which '
  'the vendor policy''s permanent branch needs. A vendor-provided document is written by trusted '
  'server code, never by an agency member (the agency INSERT policy admits only agency) and never '
  'by a vendor session (no vendor INSERT policy). Immutable after insert.'$t104_03$;

        EXECUTE $t104_04$COMMENT ON COLUMN public.source_documents.visible_to_vendor IS
  'The per-document toggle (ruling R1): the lead agency turns it on for THIS document. Default off. '
  'It only has effect together with partnership_id, which says WHICH vendor, and it stops having '
  'effect when the partnership ends. It does not affect a document the vendor itself provided.'$t104_04$;

        EXECUTE $t104_05$COMMENT ON COLUMN public.source_documents.archived_at IS
  'The archive STATE (ruling R5). NULL means not archived. No control exists to set it. Nothing '
  'is destroyed when a project closes; archiving is a deliberate agency action and not a delete.'$t104_05$;

        EXECUTE $t104_06$COMMENT ON COLUMN public.source_documents.blob_path IS
  'Where the file lives in the PRIVATE Vercel Blob store. Row visibility does not protect the '
  'file: the serving route must read this row as the caller first.'$t104_06$;

        EXECUTE $t104_07$CREATE INDEX source_documents_partnership_idx
  ON public.source_documents (partnership_id)
  WHERE partnership_id IS NOT NULL$t104_07$;

        EXECUTE $t104_08$CREATE INDEX source_documents_project_idx
  ON public.source_documents (project_id)$t104_08$;

        EXECUTE $t104_09$CREATE TABLE public.ledger_entries (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid          NOT NULL REFERENCES public.projects(id),
  source_document_id   uuid          NOT NULL,
  category_id          uuid          NOT NULL,
  original_category_id uuid          NOT NULL,
  budget_line_id       uuid          NULL,
  amount               numeric(14,2) NOT NULL,
  payee_name           text          NULL,
  entry_date           date          NULL,
  category_confidence  numeric       NULL,
  category_reasoning   text          NULL,
  created_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_source_document_fkey
    FOREIGN KEY (project_id, source_document_id)
    REFERENCES public.source_documents (project_id, id),
  CONSTRAINT ledger_entries_category_fkey
    FOREIGN KEY (project_id, category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  CONSTRAINT ledger_entries_original_category_fkey
    FOREIGN KEY (project_id, original_category_id)
    REFERENCES public.budget_project_categories (project_id, id),
  -- MATCH SIMPLE: a NULL budget_line_id (not yet on a line) is not checked.
  CONSTRAINT ledger_entries_budget_line_fkey
    FOREIGN KEY (project_id, budget_line_id)
    REFERENCES public.budget_lines (project_id, id)
)$t104_09$;

        EXECUTE $t104_10$COMMENT ON TABLE public.ledger_entries IS
  'The agency''s ACTUAL SPEND: one row per receipt or invoice line, extracted from a source_document '
  '(one document, many entries). Signed: a credit is negative and reduces the actual on its line. '
  'Agency-only. NO vendor policy exists or may be added: an entry extracted from a vendor''s own '
  'invoice is the agency''s record of what it spent, not the vendor''s record of what it billed '
  '(the vendor''s record is the invoice, a source_document it can always read). Every colleague in '
  'the organization may read every entry. No DELETE policy.'$t104_10$;

        EXECUTE $t104_11$COMMENT ON COLUMN public.ledger_entries.original_category_id IS
  'The category this entry was FIRST filed under. Set from category_id on insert by '
  'ledger_entries_guard() and immutable afterwards. When two categories are merged '
  '(budget_category_merges) category_id moves and this does not, so last month''s export and this '
  'month''s can be reconciled (ruling 2f).'$t104_11$;

        EXECUTE $t104_12$COMMENT ON COLUMN public.ledger_entries.amount IS
  'SIGNED (ruling 5d). Positive spends, negative credits. numeric(14,2). No currency is recorded.'$t104_12$;

        EXECUTE $t104_13$COMMENT ON COLUMN public.ledger_entries.budget_line_id IS
  'The budget line this entry counts against ("the actual on its line"). NULL until reconciled. '
  'The reconciliation model beyond this one link, and partial refunds against a reconciled entry, '
  'are open questions (spec questions 4 and 6).'$t104_13$;

        EXECUTE $t104_14$COMMENT ON COLUMN public.ledger_entries.payee_name IS
  'Who was paid. The spec''s "vendor" in "vendor plus date plus amount" (finding 4), named payee_name '
  'here so it is not read as a partner vendor. Nullable: extraction may not read it.'$t104_14$;

        EXECUTE $t104_15$COMMENT ON COLUMN public.ledger_entries.category_reasoning IS
  'The model''s stated reasoning for the category, stored per entry (finding 3). It cannot be '
  'recovered later without re-running extraction.'$t104_15$;

        EXECUTE $t104_16$CREATE INDEX ledger_entries_document_idx
  ON public.ledger_entries (source_document_id)$t104_16$;

        EXECUTE $t104_17$CREATE INDEX ledger_entries_project_category_idx
  ON public.ledger_entries (project_id, category_id)$t104_17$;

        EXECUTE $t104_18$CREATE INDEX ledger_entries_budget_line_idx
  ON public.ledger_entries (budget_line_id)
  WHERE budget_line_id IS NOT NULL$t104_18$;

        EXECUTE $t104_19$CREATE FUNCTION public.source_documents_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead_org uuid;
  v_project_org uuid;
BEGIN
  IF NEW.partnership_id IS NOT NULL THEN
    SELECT ps.lead_org_id INTO v_lead_org FROM public.partnerships ps WHERE ps.id = NEW.partnership_id;
    SELECT pr.org_id INTO v_project_org FROM public.projects pr WHERE pr.id = NEW.project_id;
    IF v_lead_org IS NULL OR v_project_org IS NULL OR v_lead_org <> v_project_org THEN
      RAISE EXCEPTION 'source_documents: partnership % does not belong to the organization that owns project %',
        NEW.partnership_id, NEW.project_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.uploader_side IS DISTINCT FROM OLD.uploader_side THEN
      RAISE EXCEPTION 'source_documents.project_id and uploader_side are immutable (the vendor''s right to a document it provided cannot be revoked by an update)'
        USING ERRCODE = '23514';
    END IF;
    IF OLD.partnership_id IS NOT NULL AND NEW.partnership_id IS DISTINCT FROM OLD.partnership_id THEN
      RAISE EXCEPTION 'source_documents.partnership_id cannot be changed once set'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$$t104_19$;

        EXECUTE $t104_20$CREATE TRIGGER source_documents_guard
  BEFORE INSERT OR UPDATE ON public.source_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.source_documents_guard()$t104_20$;

        EXECUTE $t104_21$REVOKE EXECUTE ON FUNCTION public.source_documents_guard() FROM PUBLIC$t104_21$;

        EXECUTE $t104_22$REVOKE EXECUTE ON FUNCTION public.source_documents_guard() FROM anon$t104_22$;

        EXECUTE $t104_23$REVOKE EXECUTE ON FUNCTION public.source_documents_guard() FROM authenticated$t104_23$;

        EXECUTE $t104_24$CREATE FUNCTION public.ledger_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.original_category_id IS NULL THEN
      NEW.original_category_id := NEW.category_id;
    ELSIF NEW.original_category_id <> NEW.category_id THEN
      RAISE EXCEPTION 'ledger_entries: an entry is originally filed under the category it is created in (original %, category %)',
        NEW.original_category_id, NEW.category_id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.original_category_id IS DISTINCT FROM OLD.original_category_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id THEN
      RAISE EXCEPTION 'ledger_entries.original_category_id, project_id and source_document_id are immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$$t104_24$;

        EXECUTE $t104_25$CREATE TRIGGER ledger_entries_guard
  BEFORE INSERT OR UPDATE ON public.ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_entries_guard()$t104_25$;

        EXECUTE $t104_26$REVOKE EXECUTE ON FUNCTION public.ledger_entries_guard() FROM PUBLIC$t104_26$;

        EXECUTE $t104_27$REVOKE EXECUTE ON FUNCTION public.ledger_entries_guard() FROM anon$t104_27$;

        EXECUTE $t104_28$REVOKE EXECUTE ON FUNCTION public.ledger_entries_guard() FROM authenticated$t104_28$;

        EXECUTE $t104_29$REVOKE ALL ON TABLE public.source_documents FROM PUBLIC$t104_29$;

        EXECUTE $t104_30$REVOKE ALL ON TABLE public.source_documents FROM anon$t104_30$;

        EXECUTE $t104_31$REVOKE ALL ON TABLE public.ledger_entries   FROM PUBLIC$t104_31$;

        EXECUTE $t104_32$REVOKE ALL ON TABLE public.ledger_entries   FROM anon$t104_32$;

        EXECUTE $t104_33$ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY$t104_33$;

        EXECUTE $t104_34$ALTER TABLE public.ledger_entries   ENABLE ROW LEVEL SECURITY$t104_34$;

        EXECUTE $t104_35$CREATE POLICY "source_documents_org_select"
  ON public.source_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t104_35$;

        EXECUTE $t104_36$CREATE POLICY "source_documents_org_insert"
  ON public.source_documents AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    uploader_side = 'agency'
    AND project_id IN (
      SELECT pr.id FROM public.projects pr
      WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t104_36$;

        EXECUTE $t104_37$CREATE POLICY "source_documents_org_update"
  ON public.source_documents AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t104_37$;

        EXECUTE $t104_38$CREATE POLICY "source_documents_vendor_select"
  ON public.source_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    partnership_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.partnerships ps
      WHERE ps.id = source_documents.partnership_id
        AND ps.vendor_org_id IN (SELECT public.current_user_org_ids())
        AND (
          source_documents.uploader_side = 'vendor'
          OR (source_documents.visible_to_vendor
              AND ps.status NOT IN ('terminated', 'removed'))
        )
    )
  )$t104_38$;

        EXECUTE $t104_39$CREATE POLICY "ledger_entries_org_select"
  ON public.ledger_entries AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t104_39$;

        EXECUTE $t104_40$CREATE POLICY "ledger_entries_org_insert"
  ON public.ledger_entries AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t104_40$;

        EXECUTE $t104_41$CREATE POLICY "ledger_entries_org_update"
  ON public.ledger_entries AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))$t104_41$;

  END IF;

  v_fp0 := (md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.source_documents x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.ledger_entries x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_project_categories x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_lines x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '')));

  ---------------------------------------------------------------------
  -- THE LOOP. PHASE 1 = AS THE OWNER (only where sc_twin). PHASE 2 = AS THE ACTOR.
  -- Every scenario runs in its own nested block and ends in LG097, which that block's own
  -- handler swallows, undoing the seed, the setup, the role switch and the claims.
  ---------------------------------------------------------------------
  FOR v_ph IN 1 .. 2 LOOP
    FOR v_i IN 1 .. v_n LOOP
      v_idx := (v_ph - 1) * v_n + v_i;
      IF v_ph = 1 AND NOT sc_twin[v_i] THEN
        CONTINUE;
      END IF;
      v_actor := CASE WHEN v_ph = 1 THEN 'owner' ELSE sc_actor[v_i] END;

      v_missing := NULL;
      IF sc_need[v_i] <> '' THEN
        FOREACH v_k IN ARRAY string_to_array(sc_need[v_i], ',') LOOP
          IF NOT coalesce((v_have ->> v_k)::boolean, false) THEN
            v_missing := coalesce(v_missing || ',', '') || v_k;
          END IF;
        END LOOP;
      END IF;

      IF v_missing IS NOT NULL THEN
        r_cls[v_idx] := 'NOSUBJECT:' || v_missing;
      ELSE
        BEGIN
          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);
          IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'owner state not clean: auth.uid() is %, expected NULL', auth.uid() USING ERRCODE = 'LG098';
          END IF;

          -- Seed and setup run as the OWNER (no end-user session). Undone with the scenario.
          FOR v_s IN 1 .. array_length(seed_sql, 1) LOOP
            IF seed_need[v_s] = '' OR coalesce((v_have ->> seed_need[v_s])::boolean, false) THEN
              FOREACH v_stmt IN ARRAY string_to_array(seed_sql[v_s], '~|~') LOOP
                EXECUTE format(v_stmt, VARIADIC v_ids);
              END LOOP;
            END IF;
          END LOOP;
          IF sc_setup[v_i] <> '' THEN
            FOREACH v_stmt IN ARRAY string_to_array(sc_setup[v_i], '~|~') LOOP
              EXECUTE format(v_stmt, VARIADIC v_ids);
            END LOOP;
          END IF;

          IF v_actor <> 'owner' THEN
            v_uid := v_actor_uids[array_position(v_actor_keys, v_actor)];
            IF v_uid IS NULL THEN
              RAISE EXCEPTION 'no subject user for actor %', v_actor USING ERRCODE = 'LG098';
            END IF;
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
            PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
            SET LOCAL ROLE authenticated;
            -- THE CONTROL THAT PROVES IMPERSONATION TOOK. A mismatch is a TEST FAULT, never a verdict.
            IF auth.uid() IS DISTINCT FROM v_uid THEN
              RAISE EXCEPTION 'impersonation mismatch (%): auth.uid() is %, expected %', v_actor, auth.uid(), v_uid USING ERRCODE = 'LG098';
            END IF;
          END IF;

          EXECUTE format(sc_sql[v_i], VARIADIC v_ids) INTO v_val;
          IF sc_chk[v_i] <> '' THEN
            EXECUTE format(sc_chk[v_i], VARIADIC v_ids) INTO v_val;
          END IF;

          RESET ROLE;
          PERFORM set_config('request.jwt.claims',    '', true);
          PERFORM set_config('request.jwt.claim.sub', '', true);

          r_cls[v_idx] := 'DONE';
          r_val[v_idx] := v_val;
          RAISE EXCEPTION 'scenario % complete: undoing its writes', sc_id[v_i] USING ERRCODE = 'LG097';
        EXCEPTION
          WHEN sqlstate 'LG097' THEN
            NULL;
          WHEN OTHERS THEN
            r_cls[v_idx] := CASE
              WHEN SQLSTATE = 'LG098' THEN 'FAULT:LG098 ' || left(SQLERRM, 140)
              ELSE 'ERR:' || SQLSTATE || ' ' || left(SQLERRM, 140)
            END;
        END;
      END IF;

      v_fp := (md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.source_documents x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.ledger_entries x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_project_categories x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.budget_lines x), '') || '#' || coalesce((SELECT string_agg(x::text, '|' ORDER BY x.id) FROM public.partnerships x), '')));
      v_iso_runs := v_iso_runs + 1;
      IF v_fp IS DISTINCT FROM v_fp0 THEN
        v_iso_bad  := v_iso_bad + 1;
        v_iso_note := v_iso_note || ' ' || sc_id[v_i] || '/phase ' || v_ph || ';';
      END IF;
    END LOOP;
  END LOOP;

  RESET ROLE;

  ---------------------------------------------------------------------
  -- JUDGEMENT. One verdict per counted scenario, then the structural lines.
  ---------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    v_exp := sc_expect[v_i];
    v_tc := CASE
      WHEN NOT sc_twin[v_i] THEN '(not run)'
      WHEN r_cls[v_i] = 'DONE' THEN format('value %s', r_val[v_i])
      ELSE r_cls[v_i] END;
    v_ac := CASE WHEN r_cls[v_n + v_i] = 'DONE' THEN format('value %s', r_val[v_n + v_i]) ELSE r_cls[v_n + v_i] END;

    IF v_exp = 'I' THEN
      v_info := v_info || format(E'  %s : %s\n', sc_label[v_i], v_ac);
      CONTINUE;
    END IF;

    v_ran := v_ran + 1;
    v_ba := v_ba || format(E'  %s\n      OWNER : %s\n      ACTOR : %s\n', sc_label[v_i], v_tc, v_ac);
    v_twin_ok := (NOT sc_twin[v_i]) OR (r_cls[v_i] = 'DONE' AND coalesce(r_val[v_i], 0) >= 1);

    IF r_cls[v_n + v_i] LIKE 'NOSUBJECT%' OR r_cls[v_i] LIKE 'NOSUBJECT%' THEN
      v_verdict := 'INCONCLUSIVE';
      v_note := format('NO SUBJECT (%s). Not exercised. This is not a pass.', r_cls[v_n + v_i]);
    ELSIF r_cls[v_n + v_i] LIKE 'FAULT%' OR r_cls[v_i] LIKE 'FAULT%' THEN
      v_verdict := 'INCONCLUSIVE';
      v_note := format('TEST FAULT, impersonation did not take (OWNER: %s; ACTOR: %s). Says nothing about 104.', v_tc, v_ac);
    ELSIF v_exp LIKE 'N:%' THEN
      v_expn := substring(v_exp from 3)::integer;
      IF r_cls[v_n + v_i] = 'DONE' AND r_val[v_n + v_i] = v_expn THEN
        IF v_twin_ok THEN
          v_verdict := 'PASS';  v_note := format('(%s)', v_ac);
        ELSE
          v_verdict := 'INCONCLUSIVE';
          v_note := format('NOT DISCRIMINATING. The actor saw %s but the OWNER saw %s, so the row it should have seen is not there.', v_expn, v_tc);
        END IF;
      ELSIF r_cls[v_n + v_i] = 'DONE' THEN
        v_verdict := 'FAIL';  v_note := format('expected %s, got %s.', v_expn, r_val[v_n + v_i]);
      ELSE
        v_verdict := 'FAIL';  v_note := format('expected %s, got %s.', v_expn, r_cls[v_n + v_i]);
      END IF;
    ELSIF v_exp LIKE 'G:%' THEN
      v_expn := substring(v_exp from 3)::integer;
      IF r_cls[v_n + v_i] = 'DONE' AND r_val[v_n + v_i] >= v_expn THEN
        v_verdict := 'PASS';  v_note := format('(%s)', v_ac);
      ELSE
        v_verdict := 'FAIL';  v_note := format('expected at least %s, got %s.', v_expn, v_ac);
      END IF;
    ELSIF v_exp LIKE 'E:%' THEN
      IF r_cls[v_n + v_i] LIKE 'ERR:' || substring(v_exp from 3) || '%' THEN
        IF v_twin_ok THEN
          v_verdict := 'PASS';  v_note := format('(refused %s)', substring(v_exp from 3));
        ELSE
          v_verdict := 'INCONCLUSIVE';
          v_note := format('NOT DISCRIMINATING. The actor was refused, but the OWNER could not do it either (%s), so the refusal cannot be credited to the policy.', v_tc);
        END IF;
      ELSIF r_cls[v_n + v_i] = 'DONE' THEN
        v_verdict := 'FAIL';  v_note := format('ADMITTED. Expected %s, but the statement succeeded (%s). THE BOUNDARY IS OPEN.', substring(v_exp from 3), v_ac);
      ELSE
        v_verdict := 'FAIL';  v_note := format('expected %s, got %s.', substring(v_exp from 3), r_cls[v_n + v_i]);
      END IF;
    ELSE
      v_verdict := 'FAIL';  v_note := 'THE TEST ITSELF IS BROKEN: unknown expectation ' || v_exp;
    END IF;

    v_logged := v_logged + 1;
    v_lines := v_lines || E'\n  ' || rpad(sc_label[v_i], 56) || rpad(v_verdict, 14) || v_note;
    IF v_verdict = 'PASS' THEN v_pass := v_pass + 1;
    ELSIF v_verdict = 'FAIL' THEN v_fail := v_fail + 1;
    ELSE v_inconc := v_inconc + 1;
    END IF;
  END LOOP;

  ---------------------------------------------------------------------
  -- STRUCTURAL ASSERTIONS. Read from the catalog after the DDL is in.
  ---------------------------------------------------------------------
  -- S1. both tables exist, row level security on
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*), count(*) FILTER (WHERE c.relrowsecurity) INTO v_a, v_b
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (v_tables);
    v_ok := (v_a = 2 AND v_b = 2);
    v_detail := format('(tables %s, row level security on %s; expected 2 and 2)', v_a, v_b);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S1  both tables exist, row level security on', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S1  both tables exist, row level security on', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S1  both tables exist, row level security on', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S2. seven policies, all authenticated, right commands
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*), count(*) FILTER (WHERE roles <> ARRAY['authenticated']::name[]) INTO v_a, v_b
    FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (v_tables);
    SELECT string_agg(tablename || ':' || cmds, ' ' ORDER BY tablename) INTO v_t
    FROM (SELECT tablename, string_agg(cmd, ',' ORDER BY cmd) AS cmds
          FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (v_tables) GROUP BY tablename) q;
    v_ok := (v_a = 7 AND v_b = 0 AND v_t = 'ledger_entries:INSERT,SELECT,UPDATE source_documents:INSERT,SELECT,SELECT,UPDATE');
    v_detail := format('(%s policies, %s not to authenticated only; %s)', v_a, v_b, v_t);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S2  seven policies, all authenticated, right commands', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S2  seven policies, all authenticated, right commands', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S2  seven policies, all authenticated, right commands', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S3. exactly one policy in the budget schema is vendor-facing
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*), min(policyname) INTO v_a, v_t FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('budget_template_categories', 'budget_project_categories', 'budget_lines', 'budget_category_merges', 'source_documents', 'ledger_entries')
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(vendor_org_id|partnership)';
    v_ok := (v_a = 1 AND v_t = 'source_documents_vendor_select');
    v_detail := format('(%s policies mention a vendor or partnership: %s; expected exactly source_documents_vendor_select)', v_a, v_t);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S3  exactly one policy in the budget schema is vendor-facing', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S3  exactly one policy in the budget schema is vendor-facing', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S3  exactly one policy in the budget schema is vendor-facing', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S4. the vendor policy carries all three parts
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT qual INTO v_t FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'source_documents' AND policyname = 'source_documents_vendor_select';
    v_ok := (v_t IS NOT NULL
             AND v_t ~ 'partnership_id'
             AND v_t ~ 'vendor_org_id'
             AND v_t ~ 'current_user_org_ids'
             AND v_t ~ 'uploader_side'
             AND v_t ~ 'visible_to_vendor'
             AND v_t ~ 'terminated'
             AND v_t ~ 'removed'
             AND v_t !~ 'suspended');
    v_detail := format('(predicate: %s)', left(coalesce(v_t, 'MISSING'), 400));
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S4  the vendor policy carries all three parts', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S4  the vendor policy carries all three parts', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S4  the vendor policy carries all three parts', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S5. no DELETE policy on either table
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY (v_tables) AND cmd IN ('DELETE', 'ALL');
    v_ok := (v_a = 0);
    v_detail := format('(%s DELETE or ALL policies; expected 0)', v_a);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S5  no DELETE policy on either table', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S5  no DELETE policy on either table', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S5  no DELETE policy on either table', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S6. anon has no privilege, authenticated has table access
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM unnest(v_tables) AS t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
    WHERE has_table_privilege('anon', 'public.' || t, p);
    SELECT count(*) INTO v_b FROM unnest(v_tables) AS t, unnest(ARRAY['SELECT', 'INSERT']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || t, p);
    v_ok := (v_a = 0 AND v_b = 4);
    v_detail := format('(anon privileges %s, expected 0; authenticated SELECT/INSERT grants %s, expected 4)', v_a, v_b);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S6  anon has no privilege, authenticated has table access', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S6  anon has no privilege, authenticated has table access', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S6  anon has no privilege, authenticated has table access', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S7. both tables hold exactly the intended columns
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_t
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'source_documents';
    SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_c_t
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ledger_entries';
    v_ok := (v_t = 'archived_at,blob_path,created_at,file_name,id,partnership_id,project_id,uploader_side,visible_to_vendor'
             AND v_c_t = 'amount,budget_line_id,category_confidence,category_id,category_reasoning,created_at,entry_date,id,original_category_id,payee_name,project_id,source_document_id');
    v_detail := format('(source_documents: %s | ledger_entries: %s)', v_t, v_c_t);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S7  both tables hold exactly the intended columns', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S7  both tables hold exactly the intended columns', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S7  both tables hold exactly the intended columns', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S8. no foreign key on either table cascades
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*), count(*) FILTER (WHERE confdeltype <> 'a') INTO v_a, v_b
    FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('public.source_documents'::regclass, 'public.ledger_entries'::regclass);
    v_ok := (v_a = 7 AND v_b = 0);
    v_detail := format('(%s foreign keys, %s not NO ACTION; expected 7 and 0: source_documents 2, ledger_entries 5)', v_a, v_b);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S8  no foreign key on either table cascades', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S8  no foreign key on either table cascades', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S8  no foreign key on either table cascades', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S9. both guard triggers present; functions callable by nobody
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM pg_trigger
    WHERE tgrelid IN ('public.source_documents'::regclass, 'public.ledger_entries'::regclass) AND NOT tgisinternal
      AND tgname IN ('source_documents_guard', 'ledger_entries_guard') AND tgenabled = 'O'
      AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 4) = 4 AND (tgtype & 16) = 16;
    v_ok := (v_a = 2
             AND NOT has_function_privilege('anon', 'public.source_documents_guard()', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.source_documents_guard()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.ledger_entries_guard()', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.ledger_entries_guard()', 'EXECUTE'));
    v_detail := format('(trigger rows %s, expected 2; function EXECUTE for anon/authenticated must all be false)', v_a);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S9  both guard triggers present; functions callable by nobody', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S9  both guard triggers present; functions callable by nobody', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S9  both guard triggers present; functions callable by nobody', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S10. the provenance and toggle constraints exist
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    SELECT count(*) INTO v_a FROM pg_constraint
    WHERE conrelid = 'public.source_documents'::regclass
      AND conname IN ('source_documents_uploader_side_check', 'source_documents_vendor_has_partnership', 'source_documents_toggle_needs_partnership');
    v_ok := (v_a = 3);
    v_detail := format('(%s of 3 provenance and toggle constraints present)', v_a);
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S10 the provenance and toggle constraints exist', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S10 the provenance and toggle constraints exist', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S10 the provenance and toggle constraints exist', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;

  -- S11. no pre-existing policy changed
  v_ran := v_ran + 1;
  v_logged := v_logged + 1;
  BEGIN
    IF v_present THEN
      v_ok := NULL;
      v_detail := 'the objects already existed before this run, so the policy delta cannot be measured here. Re-run P4 and V5 by hand.';
    ELSE
      SELECT md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                     E'\n' ORDER BY tablename, policyname), ''))
        INTO v_pol_after
      FROM pg_policies WHERE schemaname = 'public' AND NOT (tablename = ANY (v_excl));
      SELECT count(*) INTO v_a FROM pg_policies WHERE schemaname = 'public';
      v_ok := (v_pol_before IS NOT DISTINCT FROM v_pol_after AND v_a = v_pol_cnt_before + v_added);
      v_detail := format('(fingerprint of every other policy %s before and after; total %s -> %s, expected +%s)', v_pol_before, v_pol_cnt_before, v_a, v_added);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_detail := 'the check itself raised ' || SQLSTATE || ': ' || left(SQLERRM, 160);
  END;
  IF v_ok IS NULL THEN
    v_lines := v_lines || E'\n  ' || rpad('S11 no pre-existing policy changed', 56) || rpad('INCONCLUSIVE', 14) || v_detail;
    v_inconc := v_inconc + 1;
  ELSIF v_ok THEN
    v_lines := v_lines || E'\n  ' || rpad('S11 no pre-existing policy changed', 56) || rpad('PASS', 14) || v_detail;
    v_pass := v_pass + 1;
  ELSE
    v_lines := v_lines || E'\n  ' || rpad('S11 no pre-existing policy changed', 56) || rpad('FAIL', 14) || v_detail;
    v_fail := v_fail + 1;
  END IF;


  ---------------------------------------------------------------------
  -- VERDICT + REPORT. Self-checks outrank everything.
  ---------------------------------------------------------------------
  IF v_logged <> v_ran OR v_pass + v_fail + v_inconc <> v_logged OR v_ran <> c_expected OR v_iso_bad > 0 THEN
    v_verdict_text := 'THE TEST ITSELF IS BROKEN. No verdict below can be trusted, including a clean one.';
    v_headline := format('DO NOT APPLY 104.  THE TEST ITSELF IS BROKEN: ran=%s logged=%s pass=%s fail=%s inconclusive=%s (expected ran %s); isolation failures=%s%s.',
                         v_ran, v_logged, v_pass, v_fail, v_inconc, c_expected, v_iso_bad,
                         CASE WHEN v_iso_bad > 0 THEN ' [a scenario leaked into the next:' || v_iso_note || ']' ELSE '' END);
  ELSIF v_fail = 0 AND v_inconc = 0 AND v_pass = c_expected THEN
    v_verdict_text := 'SAFE TO APPLY 104.';
    v_headline := format('SAFE TO APPLY 104.  All %s assertions passed.', v_pass);
  ELSIF v_fail = 0 THEN
    v_verdict_text := 'nothing is BROKEN, but an assertion could not be exercised. Settle it before applying.';
    v_headline := format('DO NOT APPLY 104 YET.  %s assertion(s) INCONCLUSIVE - nothing FAILED, but the run does NOT show 104 does what it claims. It is not a green light.', v_inconc);
  ELSE
    v_verdict_text := 'DO NOT APPLY. Read every FAIL row below.';
    v_headline := format('DO NOT APPLY 104.  %s assertion(s) FAILED.', v_fail);
  END IF;

  v_report :=
       E'\n=====================================================\n'
    || v_headline || E'\n'
    || E'=====================================================\n'
    || format(E'assertions run  : %s   (expected %s)\n', v_ran, c_expected)
    || format(E'PASS            : %s   (expected %s)\n', v_pass, c_expected)
    || format(E'FAIL            : %s   (expected 0)\n', v_fail)
    || format(E'INCONCLUSIVE    : %s   (expected 0)\n', v_inconc)
    || format(E'verdicts logged : %s   (must equal assertions run: %s)\n', v_logged, CASE WHEN v_logged = v_ran THEN 'OK' ELSE 'MISMATCH' END)
    || format(E'isolation check : %s scenario run(s) each compared to the pre-loop fingerprint: %s\n', v_iso_runs, CASE WHEN v_iso_bad = 0 THEN 'OK' ELSE 'BROKEN' || v_iso_note END)
    || format(E'state at start  : 104 objects present before this test = %s (false means this test applied the DDL itself, inside the transaction that rolls back)\n', v_present)
    || format(E'103 present at start: %s (false means this test applied 103 first, inside the transaction that rolls back)\n', v_103_present)
    || format(E'SUBJECT          : vendor user %s (vendor org %s) on partnership %s of lead org %s, project %s; colleague %s; second partnership %s (project %s); stranger partnership %s; other agency member %s (org %s, project %s)\n',
              v_uv, v_ov, v_ps1, v_o1, v_p1, coalesce(v_u1b::text, 'NONE'), coalesce(v_ps2::text, 'NONE'), coalesce(v_pj2::text, 'NONE'),
              coalesce(v_ps3::text, 'NONE'), coalesce(v_u2::text, 'NONE'), coalesce(v_o2::text, 'NONE'), coalesce(v_p2::text, 'NONE'))
    || 'VERDICT         : ' || v_verdict_text || E'\n'
    || E'\nINFORMATIONAL (not counted)\n'
    || v_info
    || E'\nOWNER = the same statement as the table owner (proves the row is there / the write is possible);\nACTOR = as the impersonated end user.\n'
    || v_ba
    || E'-----------------------------------------------------'
    || v_lines
    || E'\n=====================================================\n'
    || E'This error IS the result. The transaction is rolled back with it.\n';

  RAISE EXCEPTION '%', v_report;
END
$test$;

-- THE BACKSTOP. IT STAYS. Not reached on the expected path (the DO block ends in
-- RAISE EXCEPTION and aborts the transaction). It is the net for a client that swallows
-- the error: the transaction would still hold the test's CREATE TABLEs.
ROLLBACK;
