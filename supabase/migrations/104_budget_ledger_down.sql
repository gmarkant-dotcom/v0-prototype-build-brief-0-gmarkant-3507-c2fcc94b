-- =====================================================================
-- 104 DOWN: removes the source documents and the ledger created by
-- 104_budget_ledger.sql.
--
-- AUTHORED 2026-10-08 on branch feat/client-required-and-spine. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] You have read the DATA GUARD below. THIS FILE REFUSES TO DROP A TABLE
--       THAT HOLDS ANY ROW. A ledger and the receipts behind it are the most
--       sensitive and least reproducible data in the product: an entry's reasoning
--       cannot be recovered without re-running extraction (spec finding 3), and a
--       vendor's own document would vanish from the vendor's view. If you truly
--       mean it, export both tables and empty them deliberately.
--   [ ] 103 is NOT being rolled back in the same breath. This file leaves 103 in
--       place and only removes the UNIQUE constraint 104 added to budget_lines.
--
-- BEGIN is line 31 and COMMIT is line 54.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm both tables still
-- exist (104's P2 query should return TWO rows).
--
-- VERIFY AFTER A REAL RUN (EXPECTED: zero rows from each):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname IN ('source_documents', 'ledger_entries');
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname IN ('source_documents_guard', 'ledger_entries_guard');
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.budget_lines'::regclass
--     AND conname = 'budget_lines_project_id_id_key';
-- =====================================================================

BEGIN;

DO $guard$
DECLARE
  v_n bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.ledger_entries)
       + (SELECT count(*) FROM public.source_documents)
    INTO v_n;

  IF v_n > 0 THEN
    RAISE EXCEPTION '104 down refuses: the ledger and source document tables hold % row(s). Export them and empty them deliberately; this file will not delete receipts or spend.', v_n
      USING ERRCODE = 'LG104';
  END IF;
END
$guard$;

DROP TABLE public.ledger_entries;
DROP FUNCTION public.ledger_entries_guard();
DROP TABLE public.source_documents;
DROP FUNCTION public.source_documents_guard();
ALTER TABLE public.budget_lines DROP CONSTRAINT budget_lines_project_id_id_key;

COMMIT;
