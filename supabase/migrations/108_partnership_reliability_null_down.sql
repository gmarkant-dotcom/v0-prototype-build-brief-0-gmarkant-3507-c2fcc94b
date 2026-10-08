-- =====================================================================
-- 108 DOWN: restores partnerships.reliability_summary and reliability_summary_generated_at from
--           public.partnership_private_reliability.
--
-- AUTHORED 2026-10-08 on branch fix/107-reliability-split. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: RESTORING THE COLUMNS RE-OPENS THE LEAK. A vendor can read the agency's AI
--       performance narrative about them again. This returns the database to its state between 107 and 108.
--   [ ] The table exists. It is the only copy of every summary written after 108, so this file refuses to run
--       without it. (The summary is a regenerable cache: if you would rather lose it than re-open the leak,
--       do not run this file; the route recomputes on the next request.)
--
-- BEGIN is line 22 and COMMIT is line 56.
--
-- DRY RUN: change COMMIT; to ROLLBACK;, run, then confirm 108's P2 count is still 0.
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   the legacy pair equals the table pair on every row of public.partnership_private_reliability.
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.partnership_private_reliability') IS NULL THEN
    RAISE EXCEPTION '108 down refuses: public.partnership_private_reliability does not exist, so there is nothing to restore from.'
      USING ERRCODE = 'LG108';
  END IF;
END
$guard$;

UPDATE public.partnerships p
   SET reliability_summary              = n.reliability_summary,
       reliability_summary_generated_at = n.reliability_summary_generated_at
  FROM public.partnership_private_reliability n
 WHERE n.partnership_id = p.id
   AND (p.reliability_summary IS DISTINCT FROM n.reliability_summary
        OR p.reliability_summary_generated_at IS DISTINCT FROM n.reliability_summary_generated_at);

DO $verify$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.partnership_private_reliability n
  LEFT JOIN public.partnerships p ON p.id = n.partnership_id
  WHERE p.reliability_summary IS DISTINCT FROM n.reliability_summary
     OR p.reliability_summary_generated_at IS DISTINCT FROM n.reliability_summary_generated_at;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '108 down: % row(s) did not restore. Nothing was committed.', v_bad USING ERRCODE = 'LG108';
  END IF;
END
$verify$;

COMMIT;
