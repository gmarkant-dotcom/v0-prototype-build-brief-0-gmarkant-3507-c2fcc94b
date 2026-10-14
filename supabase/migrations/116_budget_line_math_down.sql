-- =====================================================================
-- 116 DOWN: removes budget line math. Drops the trigger, its function, the three checks and the
-- four columns. Every estimate STAYS as stored: a computed line keeps its last computed estimate,
-- which becomes a typed value (the same thing clearing unit_rate does under 116).
--
-- AUTHORED 2026-10-14 on branch feat/budget-line-math. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: quantity, unit_rate, multiplier and unit_label are DELETED for every
--       line. The estimates are kept; the breakdown behind them is not. Export the budget CSV first
--       (it carries Qty, Rate, Multiplier and Unit) if the breakdown matters.
--   [ ] The deployed code keeps working: lib/server/budget/lines.ts drops the four columns from its
--       select and payload on 42703 / PGRST204 and behaves as before 116.
--
-- REFUSAL. While any line still carries math this file raises LG116 and changes nothing. To drop
-- it anyway, add this line directly AFTER "BEGIN;" (SET LOCAL only lasts inside the transaction),
-- and say so in the run log:
--     SET LOCAL ligament.allow_drop_line_math = 'on';
--
-- BEGIN is line 31 and COMMIT is line 68.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm 116's V1 still returns four rows.
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'budget_lines'
--      AND column_name IN ('quantity', 'unit_rate', 'multiplier', 'unit_label');   -- zero rows
--   SELECT to_regprocedure('public.budget_lines_compute_estimate()');               -- NULL
-- =====================================================================

BEGIN;

DO $down$
DECLARE
  v_with_math bigint;
BEGIN
  IF to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION '116 down refuses: public.budget_lines does not exist.' USING ERRCODE = 'LG116';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.budget_lines'::regclass
                  AND a.attname = 'unit_rate' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '116 down refuses: budget_lines has no unit_rate column, so 116 is not applied.' USING ERRCODE = 'LG116';
  END IF;
  EXECUTE 'SELECT count(*) FROM public.budget_lines
            WHERE quantity IS NOT NULL OR unit_rate IS NOT NULL OR multiplier IS NOT NULL OR unit_label IS NOT NULL'
    INTO v_with_math;
  IF v_with_math > 0 AND coalesce(current_setting('ligament.allow_drop_line_math', true), '') <> 'on' THEN
    RAISE EXCEPTION '116 down refuses: % line(s) carry quantity, rate, multiplier or unit. Read the header.', v_with_math
      USING ERRCODE = 'LG116';
  END IF;
END
$down$;

DROP TRIGGER IF EXISTS budget_lines_compute_estimate ON public.budget_lines;
DROP FUNCTION IF EXISTS public.budget_lines_compute_estimate();

ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_unit_label_shape;
ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_multiplier_positive;
ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_quantity_positive;

ALTER TABLE public.budget_lines DROP COLUMN IF EXISTS unit_label;
ALTER TABLE public.budget_lines DROP COLUMN IF EXISTS multiplier;
ALTER TABLE public.budget_lines DROP COLUMN IF EXISTS unit_rate;
ALTER TABLE public.budget_lines DROP COLUMN IF EXISTS quantity;

NOTIFY pgrst, 'reload schema';

COMMIT;
