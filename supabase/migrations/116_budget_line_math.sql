-- =====================================================================
-- 116: BUDGET LINE MATH. A PRODUCTION BUDGET LINE IS QUANTITY x UNIT RATE x MULTIPLIER.
--
-- AUTHORED 2026-10-14 on branch feat/budget-line-math (unattended run). NOT APPLIED. NOT RUN
-- AGAINST POSTGRES. NO SQL PARSER WAS AVAILABLE TO THE AUTHOR: THE OWNER'S PRE-APPLY TEST RUN IN
-- THE SQL EDITOR IS THE PARSE CHECK. DO NOT APPLY WITHOUT A GREEN RUN OF
-- supabase/migrations/116_preapply_test.sql AND GREG'S SAY-SO.
--
--   ALTER TABLE public.budget_lines ADD COLUMN quantity   numeric(12,3) NULL
--   ALTER TABLE public.budget_lines ADD COLUMN unit_rate  numeric(14,2) NULL
--   ALTER TABLE public.budget_lines ADD COLUMN multiplier numeric(12,3) NULL
--   ALTER TABLE public.budget_lines ADD COLUMN unit_label text          NULL
--   ADD 3 CHECK CONSTRAINTS (quantity > 0, multiplier > 0, unit_label trimmed 1 to 24 characters)
--   CREATE public.budget_lines_compute_estimate()  -> trigger function, SECURITY INVOKER, pinned
--   CREATE TRIGGER budget_lines_compute_estimate BEFORE INSERT OR UPDATE ON public.budget_lines
--   REVOKE EXECUTE ON THE FUNCTION FROM PUBLIC, anon, authenticated
--   NOTIFY pgrst 'reload schema'
--
-- UNCHANGED: every policy (R1's "budget_lines_org_delete" included), every grant, every existing
-- trigger and function, every existing row. ADDS NO POLICY. CHANGES NO GRANT. The four columns are
-- reachable exactly as the rest of the row is: 103's table-level grants and policies already cover
-- a column added later, so an agency member reads and writes them, and a vendor reads and writes
-- nothing (there is no vendor policy on budget_lines, and none is added).
--
-- THE FULL FILENAME IS 116_budget_line_math.sql. Its rollback sibling is
-- 116_budget_line_math_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- OWNER RULING 2026-10-12, AND WHERE EACH PART LIVES IN THIS FILE
-- =====================================================================
--
--  * Four NULLABLE columns on budget_lines: quantity numeric(12,3), unit_rate numeric(14,2),
--    multiplier numeric(12,3), unit_label text. Section 1.
--  * quantity and multiplier, when present, are > 0. unit_label, when present, is trimmed and 1 to
--    24 characters. unit_rate may be negative (a discount line) and may be 0. Section 2.
--  * WHEN unit_rate IS NOT NULL, a BEFORE INSERT OR UPDATE trigger sets
--      estimate = round(coalesce(quantity, 1) * unit_rate * coalesce(multiplier, 1), 2)
--    OVERWRITING any estimate the client sent. A result that does not fit numeric(14,2) raises
--    SQLSTATE 22003 with a message that says so; it is never clamped. Section 3.
--  * The trigger function is SECURITY INVOKER with search_path pinned; EXECUTE is revoked from
--    PUBLIC, anon and authenticated (a trigger fires without its caller holding EXECUTE, as 103's
--    budget_category_merges_guard already does in production). Section 3.
--  * WHEN unit_rate IS NULL the trigger returns the row untouched: estimate is a typed value
--    exactly as today. Clearing unit_rate therefore keeps the last computed estimate, which from
--    then on is typed. Existing rows are not modified: ADD COLUMN with no default rewrites nothing
--    and every existing row has unit_rate NULL.
--  * R1 is untouched. A computed line with a non-zero estimate cannot be deleted (the DELETE
--    policy's USING clause reads the stored estimate, which the trigger wrote); a computed line at
--    0 (unit_rate 0) can.
--
-- ROUNDING. Postgres round(numeric, 2) rounds half AWAY from zero (0.025 -> 0.03, -0.025 -> -0.03).
-- lib/budget/line-math.ts implements the same rule in integer arithmetic, so the server's and the
-- browser's preview agree with the trigger to the cent.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] The code on feat/budget-line-math is DEPLOYED. It reads and writes the four columns when
--       they exist and drops them on 42703 / PGRST204 when they do not, so it works on either side
--       of this file. The code on main before that branch never names them, so applying 116 under
--       it is also safe (lines without a rate behave exactly as today).
--   [ ] 103 is applied (P1 returns budget_lines). The transaction below ENFORCES this (LG116).
--   [ ] None of the four columns, the function or the trigger exists (P2). ENFORCED (LG116).
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 116.". It is also the parse check.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back (P2 still answers zero rows).
--
-- =====================================================================
-- APPLY SEQUENCE
-- =====================================================================
--   1. Run P1 and P2 below. Record the answers. STOP on any mismatch with EXPECTED.
--   2. Paste supabase/migrations/116_preapply_test.sql and run it ONCE. The result is a red error
--      box; its first line must read "SAFE TO APPLY 116.". Anything else: do not continue.
--   3. DRY RUN: replace the final COMMIT; (line number at the foot of this header) with ROLLBACK;
--      and run the file. Prove it rolled back: P2 must still return zero rows. "Success. No rows
--      returned" is what the editor says for a dry run, a real apply and a query pasted into the
--      wrong tab. It is not evidence.
--   4. Restore COMMIT; and run the file for real.
--   5. Run V1 to V5. They must return EXACTLY the EXPECTED values.
--   6. Update the migrations table in LIGAMENT_CONTEXT.md and the state of record.
--   Rollback: supabase/migrations/116_budget_line_math_down.sql (refuses while any line carries
--   math unless told otherwise; read its header).
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
-- P2. NOTHING OF 116 EXISTS YET.
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'budget_lines'
--     AND column_name IN ('quantity', 'unit_rate', 'multiplier', 'unit_label');
--   SELECT to_regprocedure('public.budget_lines_compute_estimate()');
--
--   EXPECTED: zero rows; then NULL.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. THE FOUR COLUMNS, NULLABLE, WITH THEIR TYPES.
--
--   SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull
--   FROM pg_attribute a
--   WHERE a.attrelid = 'public.budget_lines'::regclass
--     AND a.attname IN ('quantity', 'unit_rate', 'multiplier', 'unit_label') AND NOT a.attisdropped
--   ORDER BY a.attname;
--
--   EXPECTED: multiplier numeric(12,3) f; quantity numeric(12,3) f; unit_label text f;
--             unit_rate numeric(14,2) f.
--
-- V2. THE TRIGGER, BEFORE INSERT OR UPDATE, ROW LEVEL, ENABLED.
--
--   SELECT tgname, tgenabled, (tgtype & 1) = 1 AS row_level, (tgtype & 2) = 2 AS before_event,
--          (tgtype & 4) = 4 AS on_insert, (tgtype & 16) = 16 AS on_update
--   FROM pg_trigger WHERE tgrelid = 'public.budget_lines'::regclass AND NOT tgisinternal;
--
--   EXPECTED: one row, budget_lines_compute_estimate, O, t, t, t, t.
--
-- V3. THE FUNCTION: INVOKER, PINNED, EXECUTABLE BY NOBODY BUT ITS OWNER.
--
--   SELECT p.prosecdef, p.proconfig::text,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
--          EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
--                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_x
--   FROM pg_proc p WHERE p.oid = 'public.budget_lines_compute_estimate()'::regprocedure;
--
--   EXPECTED: false, {"search_path=public, pg_temp"}, false, false, false.
--
-- V4. THE THREE CHECKS.
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.budget_lines'::regclass AND contype = 'c'
--     AND conname IN ('budget_lines_quantity_positive', 'budget_lines_multiplier_positive',
--                     'budget_lines_unit_label_shape')
--   ORDER BY conname;
--
--   EXPECTED: three rows.
--
-- V5. NO EXISTING ROW WAS GIVEN MATH, AND THE POLICIES ON budget_lines ARE STILL THE FOUR OF 103.
--
--   SELECT count(*) FROM public.budget_lines
--   WHERE quantity IS NOT NULL OR unit_rate IS NOT NULL OR multiplier IS NOT NULL OR unit_label IS NOT NULL;
--   SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'budget_lines'
--   ORDER BY policyname;
--
--   EXPECTED: 0 immediately after the apply; then the four budget_lines_org_* policies (DELETE,
--   INSERT, SELECT, UPDATE), exactly as before.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 160 and COMMIT is at line 282.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_present text;
BEGIN
  IF to_regclass('public.budget_lines') IS NULL THEN
    RAISE EXCEPTION '116 refuses to apply: public.budget_lines does not exist. Apply 103 first.'
      USING ERRCODE = 'LG116';
  END IF;

  SELECT string_agg(a.attname::text, ', ' ORDER BY a.attname) INTO v_present
  FROM pg_attribute a
  WHERE a.attrelid = 'public.budget_lines'::regclass
    AND a.attname IN ('quantity', 'unit_rate', 'multiplier', 'unit_label')
    AND NOT a.attisdropped;
  IF v_present IS NOT NULL THEN
    RAISE EXCEPTION '116 refuses to apply: budget_lines already has %. Read the schema first; a drifted column must not be skipped silently.', v_present
      USING ERRCODE = 'LG116';
  END IF;

  IF to_regprocedure('public.budget_lines_compute_estimate()') IS NOT NULL THEN
    RAISE EXCEPTION '116 refuses to apply: public.budget_lines_compute_estimate() already exists.'
      USING ERRCODE = 'LG116';
  END IF;
END
$preflight$;


-- ---------------------------------------------------------------------
-- 1. THE FOUR COLUMNS. Nullable, no default: nothing is rewritten and every existing row reads
--    NULL in all four, which is "no math", which is today's behaviour.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines ADD COLUMN quantity   numeric(12,3) NULL;
ALTER TABLE public.budget_lines ADD COLUMN unit_rate  numeric(14,2) NULL;
ALTER TABLE public.budget_lines ADD COLUMN multiplier numeric(12,3) NULL;
ALTER TABLE public.budget_lines ADD COLUMN unit_label text          NULL;

COMMENT ON COLUMN public.budget_lines.quantity IS
  'Migration 116. How many units (3 decimals, > 0). NULL counts as 1 when unit_rate is set.';
COMMENT ON COLUMN public.budget_lines.unit_rate IS
  'Migration 116. Money per unit (numeric(14,2), may be negative for a discount line). WHEN SET, '
  'the trigger budget_lines_compute_estimate overwrites estimate with '
  'round(coalesce(quantity,1) * unit_rate * coalesce(multiplier,1), 2). NULL: estimate is typed.';
COMMENT ON COLUMN public.budget_lines.multiplier IS
  'Migration 116. A factor on quantity x rate (3 decimals, > 0), e.g. 1.5 for overtime or a fringe. '
  'NULL counts as 1 when unit_rate is set.';
COMMENT ON COLUMN public.budget_lines.unit_label IS
  'Migration 116. What one unit is ("day", "hour", "shoot day"): trimmed, 1 to 24 characters. '
  'Display only; it changes no number.';


-- ---------------------------------------------------------------------
-- 2. THE CHECKS. Each is written to pass on NULL explicitly.
-- ---------------------------------------------------------------------
ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_quantity_positive
  CHECK (quantity IS NULL OR quantity > 0);

ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_multiplier_positive
  CHECK (multiplier IS NULL OR multiplier > 0);

ALTER TABLE public.budget_lines
  ADD CONSTRAINT budget_lines_unit_label_shape
  CHECK (unit_label IS NULL OR (unit_label = btrim(unit_label) AND char_length(unit_label) BETWEEN 1 AND 24));


-- ---------------------------------------------------------------------
-- 3. THE COMPUTED ESTIMATE.
--
-- SECURITY INVOKER on purpose: it reads nothing and writes only NEW, so it needs no privilege of
-- its own. The product is formed in unconstrained numeric, so it cannot overflow before the check;
-- the check is applied AFTER rounding (999999999999.995 rounds to 1000000000000.00, which does not
-- fit). The error names the limit in words instead of leaving the bare "numeric field overflow"
-- the assignment would raise.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.budget_lines_compute_estimate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estimate numeric;
BEGIN
  IF NEW.unit_rate IS NULL THEN
    RETURN NEW;
  END IF;

  v_estimate := round(coalesce(NEW.quantity, 1) * NEW.unit_rate * coalesce(NEW.multiplier, 1), 2);

  IF abs(v_estimate) >= 1000000000000 THEN
    RAISE EXCEPTION 'budget line total % is too large: quantity x rate x multiplier must stay below 1,000,000,000,000.00 either way', v_estimate
      USING ERRCODE = '22003';
  END IF;

  NEW.estimate := v_estimate;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.budget_lines_compute_estimate() IS
  'Migration 116. BEFORE INSERT OR UPDATE on budget_lines. When unit_rate is set, estimate := '
  'round(coalesce(quantity,1) * unit_rate * coalesce(multiplier,1), 2), overwriting the client''s '
  'value; 22003 if that does not fit numeric(14,2). When unit_rate is NULL the row is untouched.';

CREATE TRIGGER budget_lines_compute_estimate
  BEFORE INSERT OR UPDATE ON public.budget_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.budget_lines_compute_estimate();

REVOKE EXECUTE ON FUNCTION public.budget_lines_compute_estimate() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.budget_lines_compute_estimate() FROM anon;
REVOKE EXECUTE ON FUNCTION public.budget_lines_compute_estimate() FROM authenticated;

-- PostgREST must see the columns at commit.
NOTIFY pgrst, 'reload schema';

COMMIT;
