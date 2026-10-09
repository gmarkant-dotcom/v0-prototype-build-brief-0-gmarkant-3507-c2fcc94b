-- =====================================================================
-- 110 DOWN: removes 110's guard from partner_rfp_responses and copies the table back into the
-- legacy columns.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: after this file A VENDOR CAN READ THE AGENCY'S SCORE AND AI ANALYSIS OF ITS
--       BID AGAIN, AND CAN SET composite_score AND ai_summary_* ON ITS OWN BID AGAIN. That is the state
--       before 110; that is what a rollback means. The table is kept, and the deployed code keeps reading it.
--   [ ] 109's table exists. Enforced below with LG110: without it there is nothing to copy back.
--
-- BEGIN is line 23 and COMMIT is line 67.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm the guard still exists (110's P3: one row).
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   110's P3                                                         -- zero rows
--   SELECT proname FROM pg_proc WHERE proname = 'partner_rfp_responses_private_columns_guard';  -- zero rows
--   109's V4 (mismatched)                                            -- 0
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.partner_rfp_response_private') IS NULL THEN
    RAISE EXCEPTION '110 down refuses: public.partner_rfp_response_private does not exist, so there is nothing to copy back.'
      USING ERRCODE = 'LG110';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS partner_rfp_responses_private_columns_guard ON public.partner_rfp_responses;
DROP FUNCTION IF EXISTS public.partner_rfp_responses_private_columns_guard();

UPDATE public.partner_rfp_responses r
   SET composite_score         = n.composite_score,
       ai_summary_short        = n.ai_summary_short,
       ai_summary_detailed     = n.ai_summary_detailed,
       ai_summary_generated_at = n.ai_summary_generated_at
  FROM public.partner_rfp_response_private n
 WHERE n.response_id = r.id
   AND (r.composite_score         IS DISTINCT FROM n.composite_score
        OR r.ai_summary_short        IS DISTINCT FROM n.ai_summary_short
        OR r.ai_summary_detailed     IS DISTINCT FROM n.ai_summary_detailed
        OR r.ai_summary_generated_at IS DISTINCT FROM n.ai_summary_generated_at);

DO $verify$
DECLARE
  v_missing bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.partner_rfp_response_private n
  LEFT JOIN public.partner_rfp_responses r ON r.id = n.response_id
  WHERE r.composite_score         IS DISTINCT FROM n.composite_score
     OR r.ai_summary_short        IS DISTINCT FROM n.ai_summary_short
     OR r.ai_summary_detailed     IS DISTINCT FROM n.ai_summary_detailed
     OR r.ai_summary_generated_at IS DISTINCT FROM n.ai_summary_generated_at;
  IF v_missing <> 0 THEN
    RAISE EXCEPTION '110 down: % row(s) did not copy back. Nothing was committed.', v_missing
      USING ERRCODE = 'LG110';
  END IF;
END
$verify$;

COMMIT;
