-- =====================================================================
-- 110: NULL partner_rfp_responses.composite_score AND ai_summary_short / _detailed / _generated_at,
--      AND REFUSE ANY LATER WRITE THAT SETS THEM. THIS IS THE FILE THAT CLOSES THE LEAK AND THE
--      VENDOR WRITE PATH.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. DO NOT APPLY WITHOUT A GREEN PRE-APPLY RUN OF
-- supabase/migrations/110_preapply_test.sql AND GREG'S SAY-SO.
-- DEPENDS ON 109: APPLY 109 FIRST, WATCH IT ON PRODUCTION, THEN THIS.
--
--   1. A drift pre-flight (LG110), the form 108 uses, NOT 106's strict equality.
--   2. UPDATE public.partner_rfp_responses SET the four columns = NULL WHERE any is not null.
--   3. CREATE public.partner_rfp_responses_private_columns_guard() + a BEFORE INSERT OR UPDATE trigger on
--      partner_rfp_responses that RAISES (LG110) when a write leaves any of the four non-null.
--
-- THE COLUMNS ARE NOT DROPPED. A drop is irreversible; nulling is reversible from 109's table (the down
-- file copies it back). The drop is owed later, with the removal of the code's legacy fallback.
--
-- >>> UNTIL THIS FILE RUNS, A VENDOR CAN READ THE AGENCY'S SCORE AND AI ANALYSIS OF ITS BID THROUGH <<<
-- >>> POSTGREST, AND CAN WRITE ITS OWN composite_score AND ai_summary_* ("Partners update own RFP <<<
-- >>> responses" has no column limit). The deployed code ignores the legacy columns once 109 exists. <<<
--
-- THE FULL FILENAME IS 110_partner_rfp_response_private_null.sql. Its rollback sibling is
-- 110_partner_rfp_response_private_null_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- STOP-GATE.
-- =====================================================================
--
--   [ ] 109 IS APPLIED AND VERIFIED (109's V1 to V7 returned their expected values).
--   [ ] THE CODE THAT READS THE TABLE HAS BEEN LIVE, and on production the agency has opened
--       /agency/bids and seen scores and summaries.
--   [ ] The pre-flight below is clean (P1 = 0 unaccounted). Enforced inside the transaction with LG110.
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO APPLY 110.".
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P2 shows the old count, P3 zero rows).
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run, then run P2 and P3.
--
-- =====================================================================
-- DRIFT. WHAT THE PRE-FLIGHT REFUSES. 108's RULE, EXTENDED TO A COLUMN WITH NO TIMESTAMP.
-- =====================================================================
--
-- 106 refused on ANY difference between the legacy value and the table row; the first agency edit after
-- 105 made it refuse over a difference that was the system working (docs/107-reliability-split-report.md).
-- This file asks 108's narrower question: is there a legacy value the table does NOT account for? It asks
-- it per group, because the two groups carry different evidence of order:
--
--   THE SUMMARY GROUP (ai_summary_short, ai_summary_detailed, ai_summary_generated_at), exactly 108's rule.
--   Accounted for when the legacy group is all null, OR a table row exists AND EITHER the three are
--   identical, OR both stamps are non-null and the table's ai_summary_generated_at is strictly later
--   (a summary regenerated after the backfill).
--
--   composite_score, which has no timestamp of its own. Accounted for when the legacy value is null, OR a
--   table row exists AND EITHER the values are identical, OR the table row was changed after it was
--   created (updated_at > created_at). 109's guard owns both timestamps, so no caller can fake that; it
--   is true exactly when the app re-scored the bid after the row was written.
--
-- Anything else is UNACCOUNTED: a legacy value with no table row, a legacy summary newer than (or
-- unorderable against) the table's, or a legacy score that differs from a table row nobody has touched.
-- After 109 the deployed code never writes the legacy columns, so an unaccounted value was written by
-- something else, and on this table that something can be THE VENDOR (until this file runs). Do not copy
-- it into the table without reading it.
-- TO RESOLVE an unaccounted row: read it (P1b). If it is a legitimate agency value the table never got,
-- copy it into partner_rfp_response_private by hand. Otherwise set the legacy value NULL for that row.
-- Then re-run P1.
--
-- =====================================================================
-- WHY THE GUARD HAS NO EXEMPTION
-- =====================================================================
--
-- 093's guard on partnerships (partnerships_guard_identity_columns) exempts the lead agency, the service
-- role and migrations, because those are legitimate writers of the columns it guards. These four columns
-- have NO legitimate writer once 109 is live: the agency writes the table, the service role writes the
-- table, and the vendor never had a right to write them. So this guard refuses EVERY caller that leaves a
-- value in them, the service role included. A whole-row read-modify-write passes, because after the
-- UPDATE below every value it would carry is null. Same form as 093 otherwise: plpgsql, NOT SECURITY
-- DEFINER (it reads only NEW), search_path pinned, EXECUTE revoked, and it RAISES rather than silently
-- nulling (a silent revert reports success, and this project has lost real behaviour to that).
-- Neither 106 nor 108 added such a guard to partnerships; that gap is reported, not fixed, here.
--
-- =====================================================================
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY.
-- =====================================================================
--
-- P1. UNACCOUNTED LEGACY VALUES. EXPECTED: 0.
--
--   SELECT count(*) AS unaccounted FROM public.partner_rfp_responses r
--   LEFT JOIN public.partner_rfp_response_private n ON n.response_id = r.id
--   WHERE (r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
--          OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL)
--     AND NOT (n.response_id IS NOT NULL
--              AND (r.composite_score IS NULL
--                   OR n.composite_score IS NOT DISTINCT FROM r.composite_score
--                   OR n.updated_at > n.created_at)
--              AND ((r.ai_summary_short IS NULL AND r.ai_summary_detailed IS NULL AND r.ai_summary_generated_at IS NULL)
--                   OR (n.ai_summary_short        IS NOT DISTINCT FROM r.ai_summary_short
--                       AND n.ai_summary_detailed     IS NOT DISTINCT FROM r.ai_summary_detailed
--                       AND n.ai_summary_generated_at IS NOT DISTINCT FROM r.ai_summary_generated_at)
--                   OR (r.ai_summary_generated_at IS NOT NULL
--                       AND n.ai_summary_generated_at IS NOT NULL
--                       AND n.ai_summary_generated_at > r.ai_summary_generated_at)));
--
-- P1b. THE SAME ROWS, TO READ. Replace "SELECT count(*) AS unaccounted" in P1 with
--   SELECT r.id, r.lead_org_id, r.vendor_org_id, r.composite_score, n.composite_score AS table_score,
--          r.ai_summary_generated_at, n.ai_summary_generated_at AS table_stamp, n.created_at, n.updated_at
--
-- P2. HOW MANY ROWS THIS WILL EMPTY. WRITE IT DOWN.
--
--   SELECT count(*) AS with_value FROM public.partner_rfp_responses
--   WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
--      OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL;
--
-- P3. THE GUARD DOES NOT EXIST YET. EXPECTED: zero rows.
--
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.partner_rfp_responses'::regclass
--     AND tgname = 'partner_rfp_responses_private_columns_guard';
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. THE COLUMNS ARE EMPTY, STILL PRESENT. Re-run P2. EXPECTED: 0. And:
--   SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
--     AND table_name = 'partner_rfp_responses'
--     AND column_name IN ('composite_score','ai_summary_short','ai_summary_detailed','ai_summary_generated_at');
--   EXPECTED: 4.
--
-- V2. THE TABLE IS INTACT. SELECT count(*) FROM public.partner_rfp_response_private;
--   EXPECTED: not less than before this file ran.
--
-- V3. THE GUARD. Re-run P3. EXPECTED: one row. And:
--   SELECT tgenabled, (tgtype & 2) = 2 AS before_event, (tgtype & 4) = 4 AS on_insert, (tgtype & 16) = 16 AS on_update
--   FROM pg_trigger WHERE tgname = 'partner_rfp_responses_private_columns_guard';
--   EXPECTED: 'O', true, true, true.
--   SELECT has_function_privilege('authenticated', 'public.partner_rfp_responses_private_columns_guard()', 'EXECUTE');
--   EXPECTED: false.
--
-- V4. NO POLICY OR GRANT ON partner_rfp_responses MOVED. Compare 109's P4.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 143 and COMMIT is at line 246.

BEGIN;

DO $preflight$
DECLARE
  v_unaccounted bigint;
BEGIN
  IF to_regclass('public.partner_rfp_response_private') IS NULL THEN
    RAISE EXCEPTION '110 refuses to apply: public.partner_rfp_response_private does not exist. Apply 109 first.'
      USING ERRCODE = 'LG110';
  END IF;

  SELECT count(*) INTO v_unaccounted
  FROM public.partner_rfp_responses r
  LEFT JOIN public.partner_rfp_response_private n ON n.response_id = r.id
  WHERE (r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
         OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL)
    AND NOT (n.response_id IS NOT NULL
             AND (r.composite_score IS NULL
                  OR n.composite_score IS NOT DISTINCT FROM r.composite_score
                  OR n.updated_at > n.created_at)
             AND ((r.ai_summary_short IS NULL AND r.ai_summary_detailed IS NULL AND r.ai_summary_generated_at IS NULL)
                  OR (n.ai_summary_short        IS NOT DISTINCT FROM r.ai_summary_short
                      AND n.ai_summary_detailed     IS NOT DISTINCT FROM r.ai_summary_detailed
                      AND n.ai_summary_generated_at IS NOT DISTINCT FROM r.ai_summary_generated_at)
                  OR (r.ai_summary_generated_at IS NOT NULL
                      AND n.ai_summary_generated_at IS NOT NULL
                      AND n.ai_summary_generated_at > r.ai_summary_generated_at)));

  IF v_unaccounted <> 0 THEN
    RAISE EXCEPTION '110 refuses to apply: % response(s) hold a legacy score or summary that partner_rfp_response_private does not account for. Nulling would destroy it, and it may have been written by a vendor. See the DRIFT section of this file (P1b lists them).', v_unaccounted
      USING ERRCODE = 'LG110';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partner_rfp_responses'::regclass
              AND tgname = 'partner_rfp_responses_private_columns_guard') THEN
    RAISE EXCEPTION '110 refuses to apply: the guard trigger already exists. Read the schema before going further.'
      USING ERRCODE = 'LG110';
  END IF;
END
$preflight$;

UPDATE public.partner_rfp_responses
   SET composite_score         = NULL,
       ai_summary_short        = NULL,
       ai_summary_detailed     = NULL,
       ai_summary_generated_at = NULL
 WHERE composite_score IS NOT NULL
    OR ai_summary_short IS NOT NULL
    OR ai_summary_detailed IS NOT NULL
    OR ai_summary_generated_at IS NOT NULL;

CREATE FUNCTION public.partner_rfp_responses_private_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.composite_score         IS NOT NULL THEN v_set := array_append(v_set, 'composite_score'); END IF;
  IF NEW.ai_summary_short        IS NOT NULL THEN v_set := array_append(v_set, 'ai_summary_short'); END IF;
  IF NEW.ai_summary_detailed     IS NOT NULL THEN v_set := array_append(v_set, 'ai_summary_detailed'); END IF;
  IF NEW.ai_summary_generated_at IS NOT NULL THEN v_set := array_append(v_set, 'ai_summary_generated_at'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a bid.'
    USING ERRCODE = 'LG110',
          DETAIL  = format(
            'partner_rfp_responses.%s must stay null. Since migration 110 the lead agency''s score and AI summaries live in partner_rfp_response_private, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', partner_rfp_responses.')
          );
END;
$$;

COMMENT ON FUNCTION public.partner_rfp_responses_private_columns_guard() IS
  'Migration 110. BEFORE INSERT OR UPDATE guard on public.partner_rfp_responses: composite_score, ai_summary_short, ai_summary_detailed and ai_summary_generated_at must stay NULL, for EVERY caller, because their only home is partner_rfp_response_private (109). Refuses with LG110; never silently nulls. Closes the vendor write path through "Partners update own RFP responses" and "Partners insert RFP responses for their inbox", which have no column limit.';

CREATE TRIGGER partner_rfp_responses_private_columns_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_responses_private_columns_guard();

REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_private_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_private_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_responses_private_columns_guard() FROM authenticated;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.partner_rfp_responses
   WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
      OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '110: % response(s) still hold a legacy value after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG110';
  END IF;
END
$verify$;

COMMIT;
