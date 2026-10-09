-- =====================================================================
-- 111 DOWN: removes public.delivery_review_private and restores the legacy columns.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] 112 IS NOT APPLIED, OR 112_delivery_review_private_null_down.sql HAS ALREADY RUN. 112's guard
--       refuses any write that sets the legacy columns, so this file's copy-back cannot run under it.
--       Enforced below with LG111.
--   [ ] YOU HAVE READ THIS: THIS FILE COPIES THE TABLE BACK INTO the six legacy columns on delivery_reviews BEFORE IT
--       DROPS THE TABLE, so no note is lost, including ones written after 111. THE COST: the legacy columns are populated again, so A VENDOR CAN READ THE AGENCY'S
--       PRIVATE NOTES ON ITS COMPLETED REVIEWS AGAIN. That is today's state; that is what a
--       rollback means.
--   [ ] The deployed code falls back to the legacy columns when the table is absent, so rolling the table
--       back under live code is safe. Roll back in the order: this file, then the code.
--
-- BEGIN is line 29 and COMMIT is line 88.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm the table still exists
-- (111's P2 query should return ONE row).
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'delivery_review_private';          -- zero rows
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'delivery_review_private_guard';      -- zero rows
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION '111 down refuses: public.delivery_review_private does not exist (already rolled back?).'
      USING ERRCODE = 'LG111';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.delivery_reviews'::regclass
              AND tgname = 'delivery_reviews_private_columns_guard') THEN
    RAISE EXCEPTION '111 down refuses: 112''s guard is still on delivery_reviews. Run 112_delivery_review_private_null_down.sql first.'
      USING ERRCODE = 'LG111';
  END IF;
END
$guard$;

-- Copy back every table row whose legacy copy differs or was nulled by 112.
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
    RAISE EXCEPTION '111 down: % row(s) did not copy back into delivery_reviews. Nothing was dropped.', v_missing
      USING ERRCODE = 'LG111';
  END IF;
END
$verify$;

DROP TABLE public.delivery_review_private;
DROP FUNCTION public.delivery_review_private_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
