-- =====================================================================
-- 112 DOWN: removes 112's guard from delivery_reviews and copies the table back into the
-- legacy columns.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: after this file A VENDOR CAN READ THE AGENCY'S PRIVATE NOTES ON ITS
--       COMPLETED REVIEWS AGAIN. That is the state before 112; that is what a rollback means. The table is kept, and the deployed code keeps reading it.
--   [ ] 111's table exists. Enforced below with LG112: without it there is nothing to copy back.
--
-- BEGIN is line 22 and COMMIT is line 72.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm the guard still exists (112's P3: one row).
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   112's P3                                                         -- zero rows
--   SELECT proname FROM pg_proc WHERE proname = 'delivery_reviews_private_columns_guard';  -- zero rows
--   111's V4 (mismatched)                                            -- 0
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION '112 down refuses: public.delivery_review_private does not exist, so there is nothing to copy back.'
      USING ERRCODE = 'LG112';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS delivery_reviews_private_columns_guard ON public.delivery_reviews;
DROP FUNCTION IF EXISTS public.delivery_reviews_private_columns_guard();

UPDATE public.delivery_reviews d
   SET on_time_notes       = n.on_time_notes,
       on_budget_notes     = n.on_budget_notes,
       client_feedback     = n.client_feedback,
       ai_delta_summary    = n.ai_delta_summary,
       would_work_again    = n.would_work_again,
       budget_variance_pct = n.budget_variance_pct
  FROM public.delivery_review_private n
 WHERE n.review_id = d.id
   AND (d.on_time_notes       IS DISTINCT FROM n.on_time_notes
        OR d.on_budget_notes     IS DISTINCT FROM n.on_budget_notes
        OR d.client_feedback     IS DISTINCT FROM n.client_feedback
        OR d.ai_delta_summary    IS DISTINCT FROM n.ai_delta_summary
        OR d.would_work_again    IS DISTINCT FROM n.would_work_again
        OR d.budget_variance_pct IS DISTINCT FROM n.budget_variance_pct);

DO $verify$
DECLARE
  v_missing bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.delivery_review_private n
  LEFT JOIN public.delivery_reviews d ON d.id = n.review_id
  WHERE d.on_time_notes       IS DISTINCT FROM n.on_time_notes
     OR d.on_budget_notes     IS DISTINCT FROM n.on_budget_notes
     OR d.client_feedback     IS DISTINCT FROM n.client_feedback
     OR d.ai_delta_summary    IS DISTINCT FROM n.ai_delta_summary
     OR d.would_work_again    IS DISTINCT FROM n.would_work_again
     OR d.budget_variance_pct IS DISTINCT FROM n.budget_variance_pct;
  IF v_missing <> 0 THEN
    RAISE EXCEPTION '112 down: % row(s) did not copy back. Nothing was committed.', v_missing
      USING ERRCODE = 'LG112';
  END IF;
END
$verify$;

COMMIT;
