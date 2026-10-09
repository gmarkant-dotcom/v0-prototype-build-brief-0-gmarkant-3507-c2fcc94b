-- =====================================================================
-- 109 DOWN: removes public.partner_rfp_response_private and restores the legacy columns.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] 110 IS NOT APPLIED, OR 110_partner_rfp_response_private_null_down.sql HAS ALREADY RUN. 110's guard
--       refuses any write that sets the legacy columns, so this file's copy-back cannot run under it.
--       Enforced below with LG109.
--   [ ] YOU HAVE READ THIS: THIS FILE COPIES THE TABLE BACK INTO partner_rfp_responses.composite_score AND
--       ai_summary_* BEFORE IT DROPS THE TABLE, so no score or summary is lost, including ones written
--       after 109. THE COST: the legacy columns are populated again, so A VENDOR CAN READ THE AGENCY'S
--       SCORE AND AI ANALYSIS OF ITS BID AGAIN, AND SET THEM. That is today's state; that is what a
--       rollback means.
--   [ ] The deployed code falls back to the legacy columns when the table is absent, so rolling the table
--       back under live code is safe. Roll back in the order: this file, then the code.
--
-- BEGIN is line 30 and COMMIT is line 83.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm the table still exists
-- (109's P2 query should return ONE row).
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partner_rfp_response_private';          -- zero rows
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'partner_rfp_response_private_guard';      -- zero rows
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.partner_rfp_response_private') IS NULL THEN
    RAISE EXCEPTION '109 down refuses: public.partner_rfp_response_private does not exist (already rolled back?).'
      USING ERRCODE = 'LG109';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partner_rfp_responses'::regclass
              AND tgname = 'partner_rfp_responses_private_columns_guard') THEN
    RAISE EXCEPTION '109 down refuses: 110''s guard is still on partner_rfp_responses. Run 110_partner_rfp_response_private_null_down.sql first.'
      USING ERRCODE = 'LG109';
  END IF;
END
$guard$;

-- Copy back every table row whose legacy copy differs or was nulled by 110.
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
    RAISE EXCEPTION '109 down: % row(s) did not copy back into partner_rfp_responses. Nothing was dropped.', v_missing
      USING ERRCODE = 'LG109';
  END IF;
END
$verify$;

DROP TABLE public.partner_rfp_response_private;
DROP FUNCTION public.partner_rfp_response_private_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
