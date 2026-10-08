-- =====================================================================
-- 103: THE BUDGET CORE. CHART OF ACCOUNTS (AGENCY TEMPLATE AND PER-PROJECT
--      COPY), BUDGET LINES, AND THE CATEGORY MERGE HISTORY.
--
-- AUTHORED 2026-10-08 on branch feat/client-required-and-spine. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. PARSE-CHECKED ONLY. DO NOT APPLY WITHOUT A GREEN
-- PRE-APPLY RUN OF supabase/migrations/103_preapply_test.sql AND GREG'S
-- SAY-SO.
--
--   CREATE TABLE public.budget_template_categories   (the agency's template)
--   CREATE TABLE public.budget_project_categories    (a project's own copy)
--   CREATE TABLE public.budget_lines                 (a project's budget lines)
--   CREATE TABLE public.budget_category_merges       (append-only merge record)
--   CREATE public.budget_category_merges_guard()      -> trigger function
--   CREATE TRIGGER budget_category_merges_guard
--   CREATE 14 POLICIES, ALL TO authenticated, ALL AGENCY-SCOPED.
--   NO POLICY FOR ANY VENDOR, ON ANY OF THE FOUR TABLES. See below.
--
-- ADDITIVE ONLY. It writes no row, alters no existing table, drops nothing and
-- touches no existing policy, grant, trigger or function. NEW TABLES DEFINE
-- THEIR OWN POLICIES AND THAT IS NOT A WIDENING OF ANY EXISTING ACCESS
-- PREDICATE: no row existed in any of these tables before this file, so no
-- principal gains access to anything that was previously reachable.
--
-- THE FULL FILENAME IS 103_budget_core.sql. Its rollback sibling is
-- 103_budget_core_down.sql. DO NOT GLOB: a `103_*.sql` glob matches both, and
-- this repository has applied a down file by mistake that way once.
--
-- NO FEATURE CODE CALLS ANY OBJECT HERE. 00 Budgeting is still non-navigable.
-- Applying this before or after any deploy changes nothing the product does.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] 079 is applied (P1 returns a row for current_user_org_ids()).
--   [ ] NONE of the four tables exists (P2 returns zero rows). The transaction
--       below ENFORCES this and raises LG103 if one does.
--   [ ] The pre-apply test has been run in the SQL Editor and its first line
--       reads "SAFE TO APPLY 103.". Any INCONCLUSIVE is work to do, not noise.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--   [ ] THIS IS 103, NOT 104. 104 (source documents and the ledger) depends on
--       THIS file and must be applied AFTER it. Applying 104 first fails
--       fast: its transaction raises LG104 if these tables are absent.
--
-- =====================================================================
-- WHAT THE RULINGS DETERMINE, AND WHAT THIS FILE WILL NOT GUESS
-- =====================================================================
--
-- Source: docs/ligament-00-budgeting-spec.md sections 2 and 3, and
-- docs/client-required-and-spine-report.md (phase 4), which carries the
-- column-by-column account. In brief:
--
--   DETERMINED, so built:
--     * A chart of accounts owned by an AGENCY (the template) and a chart owned
--       by a PROJECT, created as a COPY of it. Two tables, no pointer between
--       them: a project category row carries no reference to the template row
--       it was copied from, because a pointer would let editing the template
--       change a closed project (spec 2f, "COPY-ON-CREATE IS LOAD-BEARING").
--     * Every category carries a fee-or-cost flag (2b). NOT NULL with NO
--       DEFAULT: margin is only computable because of it, and a default would
--       misclassify silently.
--     * Merge is allowed and CAPTURES HISTORY (2f). A merged-away category row
--       is never deleted; budget_category_merges records the merge and is
--       append-only.
--     * Nothing with money against it is silently deleted (2f). Every foreign
--       key that protects money is NO ACTION: deleting the parent fails at the
--       end of the statement instead of cascading.
--     * A budget line belongs to a PROJECT (spec section 4 step 1) and files
--       under that project's chart.
--
--   NOT DETERMINED, so NOT BUILT (each is a question in the report):
--     * Committed, Actual and Paid are NOT columns on budget_lines. Ruling 2c
--       says Committed is sourced from awarded bids and purchase orders and
--       Actual from the ledger, "so neither is free text". Whether the four
--       states are stored columns or derived is open question 2. Adding three
--       stored numbers here would answer it, and is the option the spec
--       itself warns about ("four numbers that can disagree with the ledger
--       beneath them, and the disagreement is invisible"). The line stores its
--       ESTIMATE, the one state with no other source.
--     * Nothing links a budget line to an RFP, a scope item, a bid or an
--       award. The spec determines that an RFP-facing line is a released
--       artifact DISTINCT from the master line (2d, 2e) and that an awarded bid
--       becomes Committed on "the originating budget line" (section 4 step 5),
--       but not the join (open question 4). No column on any table here points
--       at an RFP or a bid, and none on partner_rfp_responses points here.
--     * No budget version, baseline or approval (open question 3).
--     * No currency, account code, ordering, notes, owner, "merged by" or
--       "promoted from" column. None is ruled.
--
-- =====================================================================
-- WHY THERE IS NO VENDOR POLICY OF ANY KIND ON ANY OF THESE TABLES
-- =====================================================================
--
-- Ruling 2e: "A vendor sees ONLY what the lead agency accepted from external
-- line items indicated for that RFP, or manual input. NO view into the master
-- budget, ever." RLS in this product is ROW level and a permitted reader reads
-- the WHOLE ROW (085's header says so about itself). A vendor policy on
-- budget_lines would therefore expose the estimate, the category and the
-- fee-or-cost flag of every row it admitted, and the flag is exactly the
-- margin the agency does not show a vendor. There is no column-level control
-- to lean on. So the only boundary that holds is the absence of a vendor
-- policy. What a vendor may see travels through the RFP payload that already
-- exists (rfp_magic_tokens.budget_categories, partner_rfp_responses.
-- budget_lines, migration 072), a released artifact written by the agency, not
-- a view onto these rows.
--
-- EVERY POLICY HERE IS KEYED ON current_user_org_ids() OF THE ROW'S OWN
-- ORGANIZATION (directly, or through projects.org_id). It is deliberately NOT
-- keyed on project_assignments or partnerships, so a vendor who can read a
-- project row through "projects_partner_select_assigned" gains nothing here:
-- the sub-select filters projects on org_id IN (my organizations), and an
-- assigned vendor's own organization is not the project's. The pre-apply
-- test asserts this with a vendor who CAN read the project.
--
-- =====================================================================
-- THE POLICIES (14)
-- =====================================================================
--
--   budget_template_categories   SELECT, INSERT, UPDATE, DELETE   by org_id
--   budget_project_categories    SELECT, INSERT, UPDATE, DELETE   by project
--   budget_lines                 SELECT, INSERT, UPDATE, DELETE   by project
--   budget_category_merges       SELECT, INSERT ONLY              by project
--
-- Every member of the organization may do all of these. The pre-apply test's
-- mandatory case is "an agency member reads and writes their own budget"; an
-- owner/admin split is not ruled. budget_category_merges has NO UPDATE and NO
-- DELETE policy: history is append-only, and a missing policy is how 097 and
-- this repository express that.
--
-- DELETE on a category or line is allowed because the foreign keys, not the
-- policy, protect money: a category named by a merge, a line, or (104) a ledger
-- entry cannot be deleted, and the failure is a loud 23503.
--
-- =====================================================================
-- EQUAL-OR-NARROWER
-- =====================================================================
--
-- BASELINE = production before this file: none of these four tables exists, so
-- every principal can reach zero rows of them. After this file: an authenticated
-- member of an organization can reach that organization's rows and no others;
-- anon and a vendor-only session reach zero rows, which EQUALS the baseline.
-- The only principals whose reach grows are agency members, and only over rows
-- that did not exist. No existing table, policy, grant, function or trigger is
-- changed; the pre-apply test asserts the fingerprint of every pre-existing
-- policy is identical before and after.
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Run P1 to P4 below in the SQL Editor. Record the answers.
--      STOP on any mismatch with EXPECTED.
--   2. Paste supabase/migrations/103_preapply_test.sql and run it ONCE. The
--      result is a red error box; its first line must read "SAFE TO APPLY
--      103.". Anything else: do not continue. Read the whole report.
--   3. DRY RUN: replace the final COMMIT; (line numbers at the foot of this
--      header) with ROLLBACK; and run the file. Prove it rolled back: P2 must
--      still return zero rows. "Success. No rows returned" is what the editor
--      says for a dry run, a real apply and a query pasted into the wrong tab.
--      It is not evidence.
--   4. Restore COMMIT; and run the file for real.
--   5. Run V1 to V6. They must return EXACTLY the EXPECTED values.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md.
--   7. Then, and only then, 104.
--   Rollback: supabase/migrations/103_budget_core_down.sql (refuses if any
--   table holds a row).
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY. RUN AND WRITE DOWN THE ANSWERS.
-- =====================================================================
--
-- P1. THE HELPER THE POLICIES DEPEND ON.
--
--   SELECT p.proname, p.prosecdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'current_user_org_ids';
--
--   EXPECTED: one row, prosecdef = true.
--
-- P2. NONE OF THE FOUR TABLES EXISTS.
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('budget_template_categories', 'budget_project_categories',
--                       'budget_lines', 'budget_category_merges');
--
--   EXPECTED: zero rows.
--
-- P3. THE POLICY TOTAL AND A FINGERPRINT OF EVERY POLICY THAT EXISTS NOW.
--
--   SELECT count(*) AS n_policies,
--          md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' ||
--                         coalesce(qual, '') || '|' || coalesce(with_check, ''),
--                         E'\n' ORDER BY tablename, policyname)) AS fingerprint
--   FROM pg_policies WHERE schemaname = 'public';
--
--   WRITE DOWN BOTH. (The 2026-10-08 figure was 123 after 100; 093 and 102 have
--   moved since, so the number is a capture and not an expectation.)
--
-- P4. projects AND organizations HAVE THE COLUMNS THE POLICIES NAME.
--
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND ((table_name = 'projects' AND column_name IN ('id', 'org_id'))
--       OR (table_name = 'organizations' AND column_name = 'id'));
--
--   EXPECTED: three rows.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. FOUR TABLES, ROW LEVEL SECURITY ON.
--
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('budget_template_categories', 'budget_project_categories',
--                       'budget_lines', 'budget_category_merges')
--   ORDER BY c.relname;
--
--   EXPECTED: four rows, relrowsecurity = true on every one.
--
-- V2. FOURTEEN POLICIES, ALL authenticated, NONE MENTIONING A VENDOR.
--
--   SELECT tablename, cmd, roles::text FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('budget_template_categories', 'budget_project_categories',
--                       'budget_lines', 'budget_category_merges')
--   ORDER BY tablename, cmd;
--
--   EXPECTED: 14 rows; roles = {authenticated} on all; budget_category_merges
--   has SELECT and INSERT only; the other three have SELECT, INSERT, UPDATE,
--   DELETE.
--
--   SELECT count(*) AS vendor_mentions FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('budget_template_categories', 'budget_project_categories',
--                       'budget_lines', 'budget_category_merges')
--     AND (coalesce(qual, '') || coalesce(with_check, '')) ~* '(vendor|partnership|assign)';
--
--   EXPECTED: 0.
--
-- V3. NO PRE-EXISTING POLICY MOVED. Re-run P3.
--
--   EXPECTED: n_policies = (the P3 figure) + 14, and the fingerprint computed
--   with `AND tablename NOT IN (the four tables)` appended equals the P3
--   fingerprint exactly.
--
-- V4. anon HAS NO PRIVILEGE ON ANY OF THEM.
--
--   SELECT t, has_table_privilege('anon', 'public.' || t, 'SELECT') AS anon_select,
--             has_table_privilege('authenticated', 'public.' || t, 'SELECT') AS auth_select
--   FROM unnest(ARRAY['budget_template_categories', 'budget_project_categories',
--                     'budget_lines', 'budget_category_merges']) AS t;
--
--   EXPECTED: anon_select = false and auth_select = true on all four. An
--   auth_select of false means the default ACL did not grant the table to
--   authenticated and every agency member will see 42501; stop and read.
--
-- V5. NO MONEY FOREIGN KEY CASCADES.
--
--   SELECT conrelid::regclass AS tbl, conname, confdeltype
--   FROM pg_constraint
--   WHERE contype = 'f'
--     AND conrelid::regclass::text IN ('budget_lines', 'budget_category_merges')
--   ORDER BY 1, 2;
--
--   EXPECTED: confdeltype = 'a' (NO ACTION) on every budget_lines foreign key;
--   on budget_category_merges 'a' for the two category keys and 'c' (CASCADE)
--   for project_id only.
--
-- V6. THE TRIGGER, AND ITS FUNCTION IS CALLABLE BY NOBODY.
--
--   SELECT tgname, tgenabled, (tgtype & 2) = 2 AS before_event, (tgtype & 4) = 4 AS on_insert
--   FROM pg_trigger WHERE tgrelid = 'public.budget_category_merges'::regclass AND NOT tgisinternal;
--
--   EXPECTED: one row, budget_category_merges_guard, tgenabled = 'O', both true.
--
--   SELECT has_function_privilege('anon', 'public.budget_category_merges_guard()', 'EXECUTE') AS anon_x,
--          has_function_privilege('authenticated', 'public.budget_category_merges_guard()', 'EXECUTE') AS auth_x;
--
--   EXPECTED: false, false.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 288 and COMMIT is at line 634.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION. The stop-gate above is
--    advice; this is enforcement. Any failure aborts everything.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '103 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG103';
  END IF;

  IF to_regclass('public.projects') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '103 refuses to apply: public.projects or public.organizations does not exist.'
      USING ERRCODE = 'LG103';
  END IF;

  IF to_regclass('public.budget_template_categories') IS NOT NULL
     OR to_regclass('public.budget_project_categories') IS NOT NULL
     OR to_regclass('public.budget_lines') IS NOT NULL
     OR to_regclass('public.budget_category_merges') IS NOT NULL THEN
    RAISE EXCEPTION '103 refuses to apply: one of its tables already exists. Plain CREATE TABLE is used on purpose; a drifted table must not be skipped silently.'
      USING ERRCODE = 'LG103';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE AGENCY TEMPLATE. The house standard every project starts from.
--    Owned by an organization. Holds no money, so deleting an organization
--    may take its template with it.
-- ---------------------------------------------------------------------
CREATE TABLE public.budget_template_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  fee_or_cost text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT budget_template_categories_name_present
    CHECK (btrim(name) <> ''),
  CONSTRAINT budget_template_categories_fee_or_cost_check
    CHECK (fee_or_cost IN ('fee', 'cost'))
);

COMMENT ON TABLE public.budget_template_categories IS
  'An agency''s house-standard chart of accounts: the categories every new project''s chart is '
  'COPIED from (ruling 2f). Copy-on-create, not a pointer: budget_project_categories carries no '
  'reference to a row here, so editing or deleting a template category changes no project. '
  'Agency-scoped; no vendor policy exists or may be added (ruling 2e).';

COMMENT ON COLUMN public.budget_template_categories.fee_or_cost IS
  'fee or cost (ruling 2b). NOT NULL with no default on purpose: margin is only computable '
  'because every category carries this flag, and a default would misclassify silently. '
  'A fee is what the agency earns; a cost is what it passes through or spends.';

CREATE INDEX budget_template_categories_org_idx
  ON public.budget_template_categories (org_id);


-- ---------------------------------------------------------------------
-- 2. A PROJECT'S OWN CHART. A copy, never a pointer.
--    UNIQUE (project_id, id) exists ONLY so budget_lines and
--    budget_category_merges can use a composite foreign key that forces a
--    category to belong to the same project as the row that names it.
-- ---------------------------------------------------------------------
CREATE TABLE public.budget_project_categories (
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
);

COMMENT ON TABLE public.budget_project_categories IS
  'A project''s chart of accounts, created as a COPY of the agency template and then owned by '
  'the project (ruling 2f). It starts equal to the template and diverges freely; nothing here '
  'points back at a template row. A category that has been merged away is NEVER deleted: it is '
  'named by a budget_category_merges row, which is what makes a ledger entry''s original '
  'category resolvable after the merge. Categories may be added at any time.';

-- A name may repeat: a merged-away category keeps its name, and the user may add a new category
-- of the same name later. Uniqueness of live names is a UI concern, not a constraint, because
-- "live" is a derived state (no merge row names the category as its source).


-- ---------------------------------------------------------------------
-- 3. BUDGET LINES. The project side only.
--
-- NO FOREIGN KEY THAT PROTECTS MONEY CASCADES. project_id is plain NO ACTION:
-- deleting a project that has budget lines fails at the end of the statement
-- (23503) instead of silently deleting estimates. The composite key does the
-- same for the category and also forces the category to be this project's.
-- ---------------------------------------------------------------------
CREATE TABLE public.budget_lines (
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
);

COMMENT ON TABLE public.budget_lines IS
  'The master budget, one row per line, belonging to a PROJECT. The master budget is the working '
  'artifact the agency owns (ruling 2a), never a mirror of a spreadsheet. Agency-scoped; NO '
  'vendor policy exists or may be added: a vendor never sees the master budget (ruling 2e), and '
  'what a vendor sees travels in the RFP payload, which is a released artifact distinct from '
  'this row. THIS TABLE HOLDS THE ESTIMATE ONLY. Committed, Actual and Paid (ruling 2c) are not '
  'columns: each has a source elsewhere (awards and purchase orders, the ledger, payments) and '
  'whether they are stored or derived is open question 2 in docs/ligament-00-budgeting-spec.md. '
  'Nothing here links to an RFP, a bid or an award: that join is open question 4.';

COMMENT ON COLUMN public.budget_lines.estimate IS
  'What the line was budgeted at (ruling 2c, state one of four). numeric(14,2), the precision '
  'scripts/037-client-cash-flow.sql uses for money. NOT NULL with no default, and not constrained '
  'to be non-negative: a discount line is a real budget line. The currency is NOT recorded; see '
  'the report.';

CREATE INDEX budget_lines_project_category_idx
  ON public.budget_lines (project_id, category_id);


-- ---------------------------------------------------------------------
-- 4. THE MERGE RECORD. Append-only.
--
-- Merge is allowed and must capture history (ruling 2f). Renaming is a merge
-- into a new name and carries the same record. The merged-away category row is
-- kept; this table says it was merged and into what. UNIQUE (from_category_id):
-- a category is merged away at most once. A chain A -> B -> C is two rows.
--
-- WHERE THE HISTORY LIVES IS AN OPEN QUESTION (5). This is the "separate merge
-- record" option. The OTHER half, a ledger entry remembering its original
-- category, is in 104 because ledger_entries is.
-- ---------------------------------------------------------------------
CREATE TABLE public.budget_category_merges (
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
);

COMMENT ON TABLE public.budget_category_merges IS
  'Append-only record that one category of a project was merged into another (ruling 2f). The '
  'merged-away category row is kept so a ledger entry''s original category still resolves. No '
  'UPDATE and no DELETE policy exists, so history cannot be rewritten by an agency member. A '
  'category appears as from_category_id at most once and never as an into_category_id once it '
  'has been merged away (budget_category_merges_guard), so the chain has no cycle.';

CREATE INDEX budget_category_merges_into_idx
  ON public.budget_category_merges (into_category_id);

CREATE INDEX budget_category_merges_project_idx
  ON public.budget_category_merges (project_id);


-- ---------------------------------------------------------------------
-- 5. THE CYCLE GUARD. A category that has been merged away may not receive a
--    merge. Without it A -> B then B -> A would be accepted and "which
--    category is this entry in now" would never terminate.
--
-- SECURITY INVOKER on purpose: it reads budget_category_merges as the caller,
-- and the caller's SELECT policy admits every merge in their own project,
-- which is every row the check can need. The advisory lock serializes merges
-- within one project so two concurrent A -> B and B -> A cannot both pass the
-- check. It only raises; it never assigns to NEW.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.budget_category_merges_guard()
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
$$;

CREATE TRIGGER budget_category_merges_guard
  BEFORE INSERT ON public.budget_category_merges
  FOR EACH ROW
  EXECUTE FUNCTION public.budget_category_merges_guard();

REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.budget_category_merges_guard() FROM authenticated;


-- ---------------------------------------------------------------------
-- 6. PRIVILEGES. anon gets nothing, by name. A stock Supabase project grants
--    new tables to anon through the default ACL, and row level security below
--    would still hide every row, but a money table does not rely on one layer.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.budget_template_categories FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_template_categories FROM anon;
REVOKE ALL ON TABLE public.budget_project_categories  FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_project_categories  FROM anon;
REVOKE ALL ON TABLE public.budget_lines               FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_lines               FROM anon;
REVOKE ALL ON TABLE public.budget_category_merges     FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_category_merges     FROM anon;


-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY. FOURTEEN POLICIES, EVERY ONE TO authenticated AND
--    EVERY ONE KEYED ON THE ROW'S OWN ORGANIZATION. NO VENDOR POLICY.
--
-- ENABLE first. A table created without this is readable by every
-- authenticated caller in the project.
--
-- The project-scoped predicate is 097's:
--   project_id IN (SELECT pr.id FROM projects pr
--                  WHERE pr.org_id IN (SELECT current_user_org_ids()))
-- The outer org_id filter is what keeps an assigned vendor out: that vendor can
-- read the project row, but its organization is not the project's.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_template_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_project_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_category_merges     ENABLE ROW LEVEL SECURITY;

-- ---- budget_template_categories: by the row's own org_id ----
CREATE POLICY "budget_template_categories_org_select"
  ON public.budget_template_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "budget_template_categories_org_insert"
  ON public.budget_template_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "budget_template_categories_org_update"
  ON public.budget_template_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "budget_template_categories_org_delete"
  ON public.budget_template_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

-- ---- budget_project_categories: by the project's organization ----
CREATE POLICY "budget_project_categories_org_select"
  ON public.budget_project_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "budget_project_categories_org_insert"
  ON public.budget_project_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "budget_project_categories_org_update"
  ON public.budget_project_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "budget_project_categories_org_delete"
  ON public.budget_project_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

-- ---- budget_lines: by the project's organization ----
CREATE POLICY "budget_lines_org_select"
  ON public.budget_lines AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "budget_lines_org_insert"
  ON public.budget_lines AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "budget_lines_org_update"
  ON public.budget_lines AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "budget_lines_org_delete"
  ON public.budget_lines AS PERMISSIVE FOR DELETE TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

-- ---- budget_category_merges: SELECT and INSERT ONLY. APPEND-ONLY. ----
CREATE POLICY "budget_category_merges_org_select"
  ON public.budget_category_merges AS PERMISSIVE FOR SELECT TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "budget_category_merges_org_insert"
  ON public.budget_category_merges AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

-- NO UPDATE POLICY AND NO DELETE POLICY on budget_category_merges. Not an omission.

COMMIT;
