-- =====================================================================
-- 107 DOWN: removes public.partnership_private_reliability and restores the legacy columns.
--
-- AUTHORED 2026-10-08 on branch fix/107-reliability-split. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: THIS FILE COPIES THE TABLE BACK INTO partnerships.reliability_summary AND
--       reliability_summary_generated_at BEFORE IT DROPS THE TABLE, so no cached summary is lost (including
--       ones written after 107, and all of them if 108 had already nulled the columns). THE COST: the
--       legacy columns are populated again, so A VENDOR CAN READ THE AGENCY'S AI PERFORMANCE NARRATIVE AGAIN.
--       That is today's state, which is what a rollback means. If 108 was applied, this restores what 108 removed.
--   [ ] The deployed code falls back to the legacy columns when the table is absent, so rolling the table
--       back under live code is safe. Roll back in the order: this file, then the code.
--
-- BEGIN is line 27 and COMMIT is line 69.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm the table still exists
-- (107's P2 query should return ONE row).
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partnership_private_reliability';       -- zero rows
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'partnership_private_reliability_guard';   -- zero rows
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.partnership_private_reliability') IS NULL THEN
    RAISE EXCEPTION '107 down refuses: public.partnership_private_reliability does not exist (already rolled back?).'
      USING ERRCODE = 'LG107';
  END IF;
END
$guard$;

-- Copy back every table row whose legacy copy differs or was nulled by 108.
UPDATE public.partnerships p
   SET reliability_summary              = n.reliability_summary,
       reliability_summary_generated_at = n.reliability_summary_generated_at
  FROM public.partnership_private_reliability n
 WHERE n.partnership_id = p.id
   AND (p.reliability_summary IS DISTINCT FROM n.reliability_summary
        OR p.reliability_summary_generated_at IS DISTINCT FROM n.reliability_summary_generated_at);

DO $verify$
DECLARE
  v_missing bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.partnership_private_reliability n
  LEFT JOIN public.partnerships p ON p.id = n.partnership_id
  WHERE p.reliability_summary IS DISTINCT FROM n.reliability_summary
     OR p.reliability_summary_generated_at IS DISTINCT FROM n.reliability_summary_generated_at;

  IF v_missing <> 0 THEN
    RAISE EXCEPTION '107 down: % row(s) did not copy back into partnerships. Nothing was dropped.', v_missing
      USING ERRCODE = 'LG107';
  END IF;
END
$verify$;

DROP TABLE public.partnership_private_reliability;
DROP FUNCTION public.partnership_private_reliability_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
