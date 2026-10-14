-- =====================================================================
-- 117 DOWN: removes the line kind. Drops the check and the fee_or_cost column on budget_lines.
--
-- >>> ROLLING BACK LOSES EVERY OVERRIDE. <<<
-- Every line that was marked fee or cost against its category's kind goes back to inheriting the
-- category's kind, and the record of which lines were overridden, and to what, is gone. Fee and cost
-- totals, margin and every percentage change accordingly. Estimates, actuals and every other column
-- are untouched.
--
-- AUTHORED 2026-10-14 on branch feat/budget-line-kind. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THE WARNING ABOVE. Export the budget CSV first (it carries Kind and Kind
--       source per line) if the overrides matter.
--   [ ] The deployed code keeps working: lib/server/budget/lines.ts and summary.ts drop fee_or_cost
--       from their select and payload on 42703 / PGRST204; every line then inherits and the toggle
--       is hidden.
--
-- REFUSAL. While any line still carries an override this file raises LG117 and changes nothing. To
-- drop it anyway, add this line directly AFTER "BEGIN;" (SET LOCAL only lasts inside the
-- transaction), and say so in the run log:
--     SET LOCAL ligament.allow_drop_line_kind = 'on';
--
-- BEGIN is line 33 and COMMIT is line 59.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm 117's V1 still returns two rows.
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'budget_lines' AND column_name = 'fee_or_cost';   -- zero rows
-- =====================================================================

BEGIN;

DO $down$
DECLARE
  v_overrides bigint;
BEGIN
  IF to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION '117 down refuses: public.budget_lines does not exist.' USING ERRCODE = 'LG117';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.budget_lines'::regclass
                  AND a.attname = 'fee_or_cost' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '117 down refuses: budget_lines has no fee_or_cost column, so 117 is not applied.' USING ERRCODE = 'LG117';
  END IF;
  EXECUTE 'SELECT count(*) FROM public.budget_lines WHERE fee_or_cost IS NOT NULL' INTO v_overrides;
  IF v_overrides > 0 AND coalesce(current_setting('ligament.allow_drop_line_kind', true), '') <> 'on' THEN
    RAISE EXCEPTION '117 down refuses: % line(s) override their category''s fee or cost. Dropping the column loses every override. Read the header.', v_overrides
      USING ERRCODE = 'LG117';
  END IF;
END
$down$;

ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_fee_or_cost_check;
ALTER TABLE public.budget_lines DROP COLUMN IF EXISTS fee_or_cost;

NOTIFY pgrst, 'reload schema';

COMMIT;
