-- =====================================================================
-- 117: BUDGET LINE KIND. A LINE MAY OVERRIDE ITS CATEGORY'S FEE OR COST.
--
-- AUTHORED 2026-10-14 on branch feat/budget-line-kind (unattended run). NOT APPLIED. NOT RUN
-- AGAINST POSTGRES. NO SQL PARSER WAS AVAILABLE TO THE AUTHOR: THE OWNER'S PRE-APPLY TEST RUN IN
-- THE SQL EDITOR IS THE PARSE CHECK. DO NOT APPLY WITHOUT A GREEN RUN OF
-- supabase/migrations/117_preapply_test.sql AND GREG'S SAY-SO.
--
--   ALTER TABLE public.budget_lines ADD COLUMN fee_or_cost text NULL
--   ADD CONSTRAINT budget_lines_fee_or_cost_check CHECK (fee_or_cost IS NULL OR fee_or_cost IN ('fee', 'cost'))
--   NOTIFY pgrst 'reload schema'
--
-- UNCHANGED: every policy, every grant, every trigger and function (116's
-- budget_lines_compute_estimate included), every existing row. ADDS NO POLICY. CHANGES NO GRANT.
-- This is exactly how 116 handled its four columns: 103's table-level grants (R7: authenticated
-- SELECT, INSERT, UPDATE, DELETE; service_role ALL; PUBLIC and anon nothing) and the four
-- budget_lines_org_* policies already cover a column added later, so an agency member reads and
-- writes it and a vendor reads and writes nothing (there is no vendor policy on budget_lines, and
-- none is added). No column-level grant exists on budget_lines and none is added.
--
-- THE FULL FILENAME IS 117_budget_line_kind.sql. Its rollback sibling is
-- 117_budget_line_kind_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- OWNER RULINGS 2026-10-14, AND WHERE EACH PART LIVES
-- =====================================================================
--
--  * R-K1 LINE-LEVEL KIND, INHERIT WITH OVERRIDE. Categories keep their fee/cost kind as the
--    default. Each line may override it. Effective kind = coalesce(line.fee_or_cost,
--    category.fee_or_cost). NULL means inherit. Section 1.
--  * The column has EXACTLY the category kind's type and allowed values: 103 declares
--    budget_project_categories.fee_or_cost and budget_template_categories.fee_or_cost as
--    text NOT NULL CHECK (fee_or_cost IN ('fee', 'cost')). Here it is the same text and the same
--    two values, nullable. Section 1 and 2.
--  * NO BACKFILL. Every existing line stays NULL, i.e. inherits, i.e. every number on every screen
--    is what it was. ADD COLUMN with no default rewrites nothing.
--  * Changing a category's kind (the app does it as a merge into a new category of the other kind,
--    which repoints budget_lines.category_id) moves inherited lines with it and leaves overridden
--    lines alone, because the override lives on the line. Nothing here enforces that; nothing has to.
--  * Nothing is computed in the database. Every total, margin and percentage by effective kind is
--    computed by lib/budget/summary-view.ts (R-K2: no line is ever computed from other lines).
--  * 116's trigger fires on every UPDATE of budget_lines, including one that changes only
--    fee_or_cost. It recomputes estimate from the unchanged quantity, unit_rate and multiplier, so
--    the estimate does not move. The pre-apply test proves it (K10, K11).
--
-- THE NAME. The column is called fee_or_cost, the same name as the category column it overrides,
-- so "effective kind" reads as coalesce(l.fee_or_cost, c.fee_or_cost).
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] The code on feat/budget-line-kind is DEPLOYED. It reads and writes fee_or_cost on
--       budget_lines when it exists and drops it on 42703 / PGRST204 when it does not (every line
--       inherits, the toggle is hidden), so it works on either side of this file. The code on main
--       before that branch never names the column, so applying 117 under it is also safe (every line
--       is NULL, which is inherit, which is what main computes).
--   [ ] 103 is applied (P1 returns budget_lines). The transaction below ENFORCES this (LG117).
--   [ ] budget_lines has no fee_or_cost column and no budget_lines_fee_or_cost_check (P2). ENFORCED.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 117.". It is also the parse check.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back (P2 still answers zero rows).
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Run P1 and P2 below. Record the answers. STOP on any mismatch with EXPECTED.
--   2. Paste supabase/migrations/117_preapply_test.sql and run it ONCE. The result is a red error
--      box; its first line must read "SAFE TO APPLY 117.". Anything else: do not continue.
--   3. DRY RUN: replace the final COMMIT; (line number at the foot of this header) with ROLLBACK;
--      and run the file. Prove it rolled back: P2 must still return zero rows. "Success. No rows
--      returned" is what the editor says for a dry run, a real apply and a query pasted into the
--      wrong tab. It is not evidence.
--   4. Restore COMMIT; and run the file for real.
--   5. Run V1 to V4. They must return EXACTLY the EXPECTED values.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md and the state of record.
--   Rollback: supabase/migrations/117_budget_line_kind_down.sql. IT DELETES EVERY OVERRIDE (read
--   its header).
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. READ-ONLY.
-- =====================================================================
--
-- P1. 103 IS APPLIED.
--
--   SELECT to_regclass('public.budget_lines');
--
--   EXPECTED: budget_lines.
--
-- P2. NOTHING OF 117 EXISTS YET.
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'budget_lines' AND column_name = 'fee_or_cost';
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.budget_lines'::regclass AND conname = 'budget_lines_fee_or_cost_check';
--
--   EXPECTED: zero rows; zero rows.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. THE COLUMN, NULLABLE, THE SAME TYPE AS THE CATEGORY'S.
--
--   SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull
--   FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
--   WHERE a.attrelid IN ('public.budget_lines'::regclass, 'public.budget_project_categories'::regclass)
--     AND a.attname = 'fee_or_cost' AND NOT a.attisdropped
--   ORDER BY c.relname;
--
--   EXPECTED: budget_lines fee_or_cost text f; budget_project_categories fee_or_cost text t.
--
-- V2. THE CHECK.
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.budget_lines'::regclass AND conname = 'budget_lines_fee_or_cost_check';
--
--   EXPECTED: one row, CHECK (((fee_or_cost IS NULL) OR (fee_or_cost = ANY (ARRAY['fee'::text, 'cost'::text]))))
--
-- V3. NO EXISTING ROW WAS GIVEN A KIND.
--
--   SELECT count(*) FROM public.budget_lines WHERE fee_or_cost IS NOT NULL;
--
--   EXPECTED: 0 immediately after the apply.
--
-- V4. THE POLICIES ON budget_lines ARE STILL THE FOUR OF 103, AND THE TRIGGER OF 116 IS STILL THERE.
--
--   SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'budget_lines'
--   ORDER BY policyname;
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.budget_lines'::regclass AND NOT tgisinternal;
--
--   EXPECTED: the four budget_lines_org_* policies (DELETE, INSERT, SELECT, UPDATE), exactly as
--   before; one trigger, budget_lines_compute_estimate, O.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 138 and COMMIT is at line 190.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION '117 refuses to apply: public.budget_lines does not exist. Apply 103 first.'
      USING ERRCODE = 'LG117';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.budget_lines'::regclass
               AND a.attname = 'fee_or_cost' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '117 refuses to apply: budget_lines already has fee_or_cost. Read the schema first; a drifted column must not be skipped silently.'
      USING ERRCODE = 'LG117';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.budget_lines'::regclass
               AND conname = 'budget_lines_fee_or_cost_check') THEN
    RAISE EXCEPTION '117 refuses to apply: budget_lines_fee_or_cost_check already exists.'
      USING ERRCODE = 'LG117';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE COLUMN. Nullable, no default: nothing is rewritten and every existing row reads NULL,
--    which is "inherit the category's kind", which is today's behaviour.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines ADD COLUMN fee_or_cost text NULL;

COMMENT ON COLUMN public.budget_lines.fee_or_cost IS
  'Migration 117 (R-K1). The line''s own fee or cost, overriding its category''s. NULL = inherit '
  'the category''s fee_or_cost. Effective kind = coalesce(budget_lines.fee_or_cost, '
  'budget_project_categories.fee_or_cost). Every total, margin and percentage sums by effective kind '
  'per line. Merging or re-flagging a category moves inherited lines with it; an override stays.';


-- ---------------------------------------------------------------------
-- 2. THE CHECK. The category's two values, written to pass on NULL explicitly.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_fee_or_cost_check
  CHECK (fee_or_cost IS NULL OR fee_or_cost IN ('fee', 'cost'));

-- PostgREST must see the column at commit.
NOTIFY pgrst, 'reload schema';

COMMIT;
