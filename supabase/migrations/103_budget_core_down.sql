-- =====================================================================
-- 103 DOWN: removes the budget core created by 103_budget_core.sql.
--
-- AUTHORED 2026-10-08 on branch feat/client-required-and-spine. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] 104 is NOT applied. 104's tables reference these. Apply
--       104_budget_ledger_down.sql first if it was applied. This file raises
--       LG103 inside its transaction if any table that references these
--       exists, and the DROPs below do not use CASCADE, so they would also
--       fail loudly.
--   [ ] You have read the DATA GUARD below. THIS FILE REFUSES TO DROP A TABLE
--       THAT HOLDS ANY ROW. These are money tables: ruling 2f says nothing with
--       money against it is silently deleted, and a down file that drops a
--       budget on the way out is the silent deletion. If you truly mean it,
--       empty the tables yourself, on purpose, after exporting them.
--
-- BEGIN and COMMIT of the transaction below are the only executable lines that
-- begin with either word and end in a semicolon. BEGIN is line 33 and COMMIT is line 65.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm all four tables
-- still exist (103's P2 query should return FOUR rows, not zero).
--
-- VERIFY AFTER A REAL RUN (EXPECTED: zero rows):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('budget_template_categories', 'budget_project_categories',
--                       'budget_lines', 'budget_category_merges');
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'budget_category_merges_guard';  -- zero rows
-- =====================================================================

BEGIN;

DO $guard$
DECLARE
  v_n bigint;
BEGIN
  -- Nothing may reference these tables except 103's own objects.
  IF to_regclass('public.source_documents') IS NOT NULL OR to_regclass('public.ledger_entries') IS NOT NULL THEN
    RAISE EXCEPTION '103 down refuses: 104 objects (source_documents or ledger_entries) still exist. Apply 104''s down file first.'
      USING ERRCODE = 'LG103';
  END IF;

  -- DATA GUARD. Counted as the table owner, so row level security does not hide anything.
  SELECT (SELECT count(*) FROM public.budget_category_merges)
       + (SELECT count(*) FROM public.budget_lines)
       + (SELECT count(*) FROM public.budget_project_categories)
       + (SELECT count(*) FROM public.budget_template_categories)
    INTO v_n;

  IF v_n > 0 THEN
    RAISE EXCEPTION '103 down refuses: the budget tables hold % row(s). Export them and empty them deliberately; this file will not delete money.', v_n
      USING ERRCODE = 'LG103';
  END IF;
END
$guard$;

DROP TABLE public.budget_category_merges;
DROP FUNCTION public.budget_category_merges_guard();
DROP TABLE public.budget_lines;
DROP TABLE public.budget_project_categories;
DROP TABLE public.budget_template_categories;

COMMIT;
