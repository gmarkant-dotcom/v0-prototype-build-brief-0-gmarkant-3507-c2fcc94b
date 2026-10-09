-- =====================================================================
-- 112: NULL THE SIX AGENCY-ONLY COLUMNS ON delivery_reviews (on_time_notes, on_budget_notes,
--      client_feedback, ai_delta_summary, would_work_again, budget_variance_pct), AND REFUSE ANY LATER
--      WRITE THAT SETS THEM. THIS IS THE FILE THAT CLOSES THE LEAK.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. DO NOT APPLY WITHOUT A GREEN PRE-APPLY RUN OF
-- supabase/migrations/112_preapply_test.sql AND GREG'S SAY-SO.
-- DEPENDS ON 111: APPLY 111 FIRST, WATCH IT ON PRODUCTION, THEN THIS. INDEPENDENT OF 109 AND 110.
--
--   1. A drift pre-flight (LG112), 108's form, extended to columns with no timestamp (see DRIFT).
--   2. UPDATE public.delivery_reviews SET the six = NULL WHERE any is not null.
--   3. CREATE public.delivery_reviews_private_columns_guard() + a BEFORE INSERT OR UPDATE trigger on
--      delivery_reviews that RAISES (LG112) when a write leaves any of the six non-null.
--
-- THE COLUMNS ARE NOT DROPPED. delivery_reviews has no other trigger, and updated_at is not touched by
-- this file (the vendor dashboard and the agency dashboard order and date by it).
--
-- >>> UNTIL THIS FILE RUNS, A VENDOR CAN READ THE AGENCY'S NOTES, CLIENT FEEDBACK, AI DELTA SUMMARY, <<<
-- >>> WOULD-WORK-AGAIN AND BUDGET VARIANCE ON EVERY COMPLETED REVIEW OF ITS WORK, THROUGH POSTGREST. <<<
--
-- THE FULL FILENAME IS 112_delivery_review_private_null.sql. Its rollback sibling is
-- 112_delivery_review_private_null_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- STOP-GATE.
-- =====================================================================
--   [ ] 111 IS APPLIED AND VERIFIED (111's V1 to V7).
--   [ ] THE CODE THAT READS THE TABLE HAS BEEN LIVE, and on production the agency has opened and saved a
--       delivery review and seen its notes come back.
--   [ ] P1 = 0. Enforced inside the transaction with LG112.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 112.".
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P2 shows the old count, P3 zero rows).
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run, then run P2 and P3.
--
-- =====================================================================
-- DRIFT. WHAT THE PRE-FLIGHT REFUSES.
-- =====================================================================
-- None of the six has a timestamp of its own, so 108's "the table's stamp is later" test has nothing to
-- compare. The equivalent evidence is 111's guard-owned pair: a table row whose updated_at is later than
-- its created_at was changed by the app after it was written, which is what an agency edit after the
-- backfill looks like. A legacy group is ACCOUNTED FOR when a table row exists AND EITHER all six are
-- identical OR the row has been changed since it was created. Anything else is UNACCOUNTED: legacy values
-- with no table row, or legacy values differing from a row nobody has touched. After 111 the deployed code
-- never writes the legacy columns, so an unaccounted value was written by something else, possibly the
-- vendor (see 111's header on the forged-row hole). Read it (P1b) before deciding.
-- TO RESOLVE: copy a legitimate value into delivery_review_private by hand, or set the legacy six NULL
-- for that row. Then re-run P1.
--
-- =====================================================================
-- WHY THE GUARD HAS NO EXEMPTION: as 110. No caller has a legitimate reason to write these six once 111 is
-- live. 093's form otherwise: plpgsql, not SECURITY DEFINER, search_path pinned, EXECUTE revoked, RAISE.
-- =====================================================================
--
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY.
--
-- P1. UNACCOUNTED LEGACY VALUES. EXPECTED: 0.
--
--   SELECT count(*) AS unaccounted FROM public.delivery_reviews d
--   LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
--   WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
--          OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
--     AND NOT (n.review_id IS NOT NULL
--              AND ((n.on_time_notes       IS NOT DISTINCT FROM d.on_time_notes
--                    AND n.on_budget_notes     IS NOT DISTINCT FROM d.on_budget_notes
--                    AND n.client_feedback     IS NOT DISTINCT FROM d.client_feedback
--                    AND n.ai_delta_summary    IS NOT DISTINCT FROM d.ai_delta_summary
--                    AND n.would_work_again    IS NOT DISTINCT FROM d.would_work_again
--                    AND n.budget_variance_pct IS NOT DISTINCT FROM d.budget_variance_pct)
--                   OR n.updated_at > n.created_at));
--
-- P1b. THE SAME ROWS, TO READ: replace "SELECT count(*) AS unaccounted" in P1 with
--   SELECT d.id, d.org_id, d.partnership_id, d.status, n.review_id IS NOT NULL AS has_row, n.created_at, n.updated_at
--
-- P2. SELECT count(*) AS with_value FROM public.delivery_reviews
--     WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
--        OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
--   WRITE IT DOWN.
--
-- P3. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.delivery_reviews'::regclass
--       AND tgname = 'delivery_reviews_private_columns_guard';
--   EXPECTED: zero rows.
--
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
--
-- V1. Re-run P2. EXPECTED: 0. The six columns still exist (information_schema count 6).
-- V2. SELECT count(*) FROM public.delivery_review_private;   EXPECTED: not less than before.
-- V3. Re-run P3. EXPECTED: one row, tgenabled 'O', BEFORE, INSERT and UPDATE. And
--     has_function_privilege('authenticated', 'public.delivery_reviews_private_columns_guard()', 'EXECUTE') = false.
-- V4. Re-run 111's P4. EXPECTED: unchanged.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 96 and COMMIT is at line 202.

BEGIN;

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.delivery_review_private') IS NULL THEN
    RAISE EXCEPTION '112 refuses to apply: public.delivery_review_private does not exist. Apply 111 first.'
      USING ERRCODE = 'LG112';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.delivery_reviews d
  LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
  WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
         OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
    AND NOT (n.review_id IS NOT NULL
             AND ((n.on_time_notes       IS NOT DISTINCT FROM d.on_time_notes
                   AND n.on_budget_notes     IS NOT DISTINCT FROM d.on_budget_notes
                   AND n.client_feedback     IS NOT DISTINCT FROM d.client_feedback
                   AND n.ai_delta_summary    IS NOT DISTINCT FROM d.ai_delta_summary
                   AND n.would_work_again    IS NOT DISTINCT FROM d.would_work_again
                   AND n.budget_variance_pct IS NOT DISTINCT FROM d.budget_variance_pct)
                  OR n.updated_at > n.created_at));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '112 refuses to apply: % delivery review(s) hold legacy private values that delivery_review_private does not account for. Nulling would destroy them. See the DRIFT section of this file (P1b lists them).', v_unaccounted
      USING ERRCODE = 'LG112';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.delivery_reviews'::regclass
              AND tgname = 'delivery_reviews_private_columns_guard') THEN
    RAISE EXCEPTION '112 refuses to apply: the guard trigger already exists. Read the schema before going further.'
      USING ERRCODE = 'LG112';
  END IF;
END
$preflight$;

UPDATE public.delivery_reviews
   SET on_time_notes       = NULL,
       on_budget_notes     = NULL,
       client_feedback     = NULL,
       ai_delta_summary    = NULL,
       would_work_again    = NULL,
       budget_variance_pct = NULL
 WHERE on_time_notes IS NOT NULL
    OR on_budget_notes IS NOT NULL
    OR client_feedback IS NOT NULL
    OR ai_delta_summary IS NOT NULL
    OR would_work_again IS NOT NULL
    OR budget_variance_pct IS NOT NULL;

CREATE FUNCTION public.delivery_reviews_private_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.on_time_notes       IS NOT NULL THEN v_set := array_append(v_set, 'on_time_notes'); END IF;
  IF NEW.on_budget_notes     IS NOT NULL THEN v_set := array_append(v_set, 'on_budget_notes'); END IF;
  IF NEW.client_feedback     IS NOT NULL THEN v_set := array_append(v_set, 'client_feedback'); END IF;
  IF NEW.ai_delta_summary    IS NOT NULL THEN v_set := array_append(v_set, 'ai_delta_summary'); END IF;
  IF NEW.would_work_again    IS NOT NULL THEN v_set := array_append(v_set, 'would_work_again'); END IF;
  IF NEW.budget_variance_pct IS NOT NULL THEN v_set := array_append(v_set, 'budget_variance_pct'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a delivery review.'
    USING ERRCODE = 'LG112',
          DETAIL  = format(
            'delivery_reviews.%s must stay null. Since migration 112 the lead agency''s private review fields live in delivery_review_private, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', delivery_reviews.')
          );
END;
$$;

COMMENT ON FUNCTION public.delivery_reviews_private_columns_guard() IS
  'Migration 112. BEFORE INSERT OR UPDATE guard on public.delivery_reviews: on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again and budget_variance_pct must stay NULL, for EVERY caller, because their only home is delivery_review_private (111). Refuses with LG112; never silently nulls.';

CREATE TRIGGER delivery_reviews_private_columns_guard
  BEFORE INSERT OR UPDATE ON public.delivery_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.delivery_reviews_private_columns_guard();

REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delivery_reviews_private_columns_guard() FROM authenticated;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.delivery_reviews
   WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
      OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '112: % review(s) still hold a legacy value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG112';
  END IF;
END
$verify$;

COMMIT;
