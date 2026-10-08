-- =====================================================================
-- 108: NULL partnerships.reliability_summary AND reliability_summary_generated_at.
--      THIS IS THE FILE THAT CLOSES THE LEAK.
--
-- AUTHORED 2026-10-08 on branch fix/107-reliability-split. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. READ, NOT PARSED. DO NOT APPLY WITHOUT A GREEN
-- PRE-APPLY RUN OF supabase/migrations/108_preapply_test.sql AND GREG'S SAY-SO.
-- DEPENDS ON 107: APPLY 107 FIRST, DEPLOY THE CODE, WATCH IT, THEN THIS.
--
--   UPDATE public.partnerships SET reliability_summary = NULL, reliability_summary_generated_at = NULL
--    WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
--
-- THAT IS THE WHOLE CHANGE. THE COLUMNS ARE NOT DROPPED. A drop is irreversible and the backfill is unproven
-- until 107's table is live and being read from. Nulling is reversible from the table (the down file copies
-- it back). BOTH COLUMNS TOGETHER, ALWAYS: the route compares the timestamp with the newest review to decide
-- whether the text is stale, so nulling one and not the other would leave a timestamp with no text (the
-- route would regenerate) or text with no timestamp (the route would treat it as stale). 073 STEP 4 did the
-- same thing for the same reason.
--
-- >>> UNTIL THIS FILE RUNS, A VENDOR CAN READ THE AGENCY'S AI PERFORMANCE NARRATIVE ABOUT THEM, <<<
-- >>> INCLUDING THE CONTENT OF REVIEWS THE AGENCY NEVER SHARED, THROUGH POSTGREST. <<<
--
-- THE FULL FILENAME IS 108_partnership_reliability_null.sql. Its rollback sibling is
-- 108_partnership_reliability_null_down.sql. DO NOT GLOB.
--
-- >>> NOBODY MAY WRITE THE LEGACY COLUMNS BETWEEN 107's BACKFILL AND THIS FILE. The only legitimate writer after <<<
-- >>> 107 is the app, and it writes the table. A legacy value NEWER than its table row makes this file refuse (LG108). <<<
--
-- =====================================================================
-- STOP-GATE.
-- =====================================================================
--
--   [ ] 107 IS APPLIED AND VERIFIED (107's V1 to V6 returned their expected values).
--   [ ] THE CODE THAT READS THE TABLE HAS BEEN LIVE FOR A WHILE and a vendor's Performance History was
--       opened on production. After this file the legacy columns are empty, so any code still reading them
--       sees NULL (and regenerates, which costs one AI call).
--   [ ] The pre-flight below is clean (P1 = 0 unaccounted). Enforced inside the transaction with LG108.
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO APPLY 108.".
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P2 again shows the old count).
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run, then run P2. EXPECTED: with_cache unchanged.
--
-- =====================================================================
-- DRIFT. WHAT THE PRE-FLIGHT REFUSES, AND WHY IT IS NOT 106's STRICT EQUALITY.
-- =====================================================================
--
-- 106 refuses on ANY difference between the legacy value and the table row. That is correct on the day 105
-- commits and wrong a day later: the first time an agency edits a note through the new code, the table
-- changes, the legacy column does not, and 106 refuses over a difference that is the system working.
--
-- This file asks a narrower question: is there a legacy value that the table does NOT already account for?
-- A legacy pair is ACCOUNTED FOR when a table row exists AND EITHER
--   (a) it is identical (both columns), OR
--   (b) the table row's timestamp is strictly later than the legacy timestamp (a summary regenerated after
--       the backfill: the table is newer, the legacy copy is the stale one).
-- Anything else is UNACCOUNTED: no table row at all, or a legacy value that is newer than, or cannot be
-- ordered against, its table row. That is an old instance of the app writing the legacy column after 107,
-- and nulling it would destroy a value the table never received. (This is a regenerable cache, so the loss
-- would cost one AI call, not data; the guard is kept because a silent write to the unsafe place is itself
-- the signal that something old is still running.)
-- To resolve an UNACCOUNTED row: read it, then copy the legacy pair over the table row by hand, or accept the
-- loss and set the legacy pair NULL for that row.
--
-- =====================================================================
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY.
-- =====================================================================
--
-- P1. UNACCOUNTED LEGACY VALUES. EXPECTED: 0.
--
--   SELECT count(*) AS unaccounted FROM public.partnerships p
--   LEFT JOIN public.partnership_private_reliability n ON n.partnership_id = p.id
--   WHERE (p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL)
--     AND NOT (n.partnership_id IS NOT NULL
--              AND ((n.reliability_summary IS NOT DISTINCT FROM p.reliability_summary
--                    AND n.reliability_summary_generated_at IS NOT DISTINCT FROM p.reliability_summary_generated_at)
--                   OR (p.reliability_summary_generated_at IS NOT NULL
--                       AND n.reliability_summary_generated_at IS NOT NULL
--                       AND n.reliability_summary_generated_at > p.reliability_summary_generated_at)));
--
-- P2. HOW MANY ROWS THIS WILL EMPTY. WRITE IT DOWN.
--
--   SELECT count(*) AS with_cache FROM public.partnerships
--   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. THE COLUMNS ARE EMPTY, STILL PRESENT.
--
--   SELECT count(*) FILTER (WHERE reliability_summary IS NOT NULL) AS text_left,
--          count(*) FILTER (WHERE reliability_summary_generated_at IS NOT NULL) AS stamps_left,
--          count(*) AS total
--   FROM public.partnerships;
--   EXPECTED: text_left = 0, stamps_left = 0, total unchanged.
--
-- V2. THE CACHE IS INTACT IN THE TABLE.
--
--   SELECT count(*) FROM public.partnership_private_reliability;
--   EXPECTED: not less than before this file ran.
--
-- V3. A VENDOR READING partnerships GETS NO SUMMARY. Run in the SQL Editor impersonating a vendor user (the
--   pre-apply test does this for you):
--     select reliability_summary, reliability_summary_generated_at from partnerships;  -- EXPECTED: NULL, NULL on every row.
--
-- V4. NO POLICY, GRANT OR TRIGGER ON partnerships MOVED. Compare 107's P4 and V6.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 111 and COMMIT is at line 159.

BEGIN;

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.partnership_private_reliability') IS NULL THEN
    RAISE EXCEPTION '108 refuses to apply: public.partnership_private_reliability does not exist. Apply 107 first.'
      USING ERRCODE = 'LG108';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.partnerships p
  LEFT JOIN public.partnership_private_reliability n ON n.partnership_id = p.id
  WHERE (p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL)
    AND NOT (n.partnership_id IS NOT NULL
             AND ((n.reliability_summary IS NOT DISTINCT FROM p.reliability_summary
                   AND n.reliability_summary_generated_at IS NOT DISTINCT FROM p.reliability_summary_generated_at)
                  OR (p.reliability_summary_generated_at IS NOT NULL
                      AND n.reliability_summary_generated_at IS NOT NULL
                      AND n.reliability_summary_generated_at > p.reliability_summary_generated_at)));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '108 refuses to apply: % partnership(s) hold a legacy reliability value that the private reliability table does not account for (no row, or the legacy value is newer than or unorderable against its row). Nulling the columns would destroy it. See the DRIFT section of this file.', v_unaccounted
      USING ERRCODE = 'LG108';
  END IF;
END
$preflight$;

UPDATE public.partnerships
   SET reliability_summary              = NULL,
       reliability_summary_generated_at = NULL
 WHERE reliability_summary IS NOT NULL
    OR reliability_summary_generated_at IS NOT NULL;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.partnerships
   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '108: % partnership(s) still hold a reliability value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG108';
  END IF;
END
$verify$;

COMMIT;
