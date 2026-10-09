-- =====================================================================
-- 109: PARTNER RFP RESPONSE PRIVATE. THE LEAD AGENCY'S SCORE AND AI SUMMARIES OF A BID,
--      IN A TABLE NO VENDOR CAN READ OR WRITE.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. DO NOT APPLY WITHOUT A GREEN PRE-APPLY RUN OF
-- supabase/migrations/109_preapply_test.sql AND GREG'S SAY-SO.
--
-- >>> THE LEAK IS NOT CLOSED BY THIS FILE. <<<
-- >>> AFTER 109 AND BEFORE 110 A VENDOR CAN STILL READ, AND STILL SET, partner_rfp_responses.composite_score <<<
-- >>> AND ai_summary_* ON ITS OWN BID THROUGH POSTGREST. 109 ADDS THE SAFE PLACE; 110 EMPTIES AND GUARDS THE UNSAFE ONE. <<<
--
--   CREATE TABLE public.partner_rfp_response_private   (one row per response; the four columns below)
--   CREATE public.partner_rfp_response_private_guard() -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE 3 POLICIES (SELECT, INSERT, UPDATE), all authenticated, all keyed on lead_org_id.
--   NO VENDOR POLICY. NO DELETE POLICY. NO DELETE GRANT.
--   REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT, UPDATE to authenticated; ALL to service_role.
--   BACKFILL the table from the four legacy columns (a copy; they are NOT touched).
--   NOTIFY pgrst 'reload schema'.
--
-- THE FULL FILENAME IS 109_partner_rfp_response_private.sql. Its rollback sibling is
-- 109_partner_rfp_response_private_down.sql. Its successor is 110_partner_rfp_response_private_null.sql.
-- DO NOT GLOB.
--
-- =====================================================================
-- THE COLUMNS, AND WHY THEY ARE AGENCY-ONLY (docs/109-112-split-report.md, Phase 0)
-- =====================================================================
--
--   composite_score          numeric(4,1)  written by the agency's ai-score and evaluation routes;
--                                          rendered only in agency components. The composite_score a
--                                          vendor DOES see (app/partner/projects, the vendor dashboard) is
--                                          delivery_reviews.composite_score, a different table, untouched.
--   ai_summary_short         text          the agency's AI procurement analysis of the bid. Rendered only
--   ai_summary_detailed      text          in app/agency/bids, components/bid-compare-view.tsx and
--   ai_summary_generated_at  timestamptz   components/bid-detail-sheet.tsx. Never rendered to a vendor or guest.
--
-- THE MECHANISM FAILURE IS THE SAME AS 105 AND 107: agency and vendor are both `authenticated`, which
-- holds Supabase's default table-wide privilege on partner_rfp_responses; "Partners select own RFP
-- responses" and "Partners read response status and feedback" admit the WHOLE row
-- (vendor_org_id IN current_user_org_ids()). Postgres has no per-column row level security, so a column
-- REVOKE is a no-op. AND THIS TABLE IS WORSE THAN partnerships: "Partners update own RFP responses"
-- (079:1414-1416) has NO column limit and partner_rfp_responses has NO guard trigger, so a vendor can
-- also SET its own composite_score and AI summary today. 110 closes that.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] THE CODE IS MERGED, PUSHED AND DEPLOYED FIRST. lib/server/rfp-response-private.ts reads and
--       writes this table and falls back to the legacy columns while it does not exist. The vendor bid
--       save route writes the AI summary with the service role (a vendor session cannot write this table).
--       Code first is harmless. Migration first is not: old code writes the summary under the vendor's
--       session, which this table refuses, and reads the legacy columns, which 110 empties.
--   [ ] 079 is applied (current_user_org_ids(), organizations, partner_rfp_responses.lead_org_id NOT NULL).
--   [ ] The table does not exist (P2 returns zero rows). Enforced below with LG109.
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO APPLY 109.". Any INCONCLUSIVE
--       is work to do. A NO SUBJECT is NOT a pass.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run it, then run P2. EXPECTED: zero rows.
-- Change it back. A dry run that was not proved to roll back is a real apply.
--
-- =====================================================================
-- THE DESIGN
-- =====================================================================
--
--   response_id   PK, REFERENCES partner_rfp_responses(id) ON DELETE CASCADE. One-to-one with the bid;
--                 deleting a bid deletes its private row.
--   lead_org_id   NOT NULL, REFERENCES organizations(id). The agency key, taken from the parent's own
--                 agency policy ("Agencies select RFP responses they own": lead_org_id IN
--                 current_user_org_ids()). Denormalised so each policy is one indexable predicate.
--                 THE GUARD TRIGGER SETS IT FROM THE PARENT ROW ON INSERT, whatever the caller sent, and
--                 pins it and response_id on UPDATE, for every caller including the service role.
--   created_at / updated_at  OWNED BY THE GUARD, not the caller: created_at = now() on insert and
--                 frozen after; updated_at = created_at on insert and clock_timestamp() on every update.
--                 110's drift guard relies on this: updated_at > created_at means "the app changed this
--                 row after it was created", which is how a re-score after the backfill is recognised.
--
-- THE GUARD IS NOT SECURITY DEFINER. It reads the parent under the CALLER's row level security: an agency
-- member sees only bids its organizations lead, a vendor sees its own bid (and then fails the INSERT
-- policy, because the lead organization the guard writes is not the vendor's), and the service role sees
-- every row. EXECUTE is revoked from PUBLIC, anon and authenticated all the same, and search_path is pinned.
--
-- EQUAL OR NARROWER, FOR EVERY ROLE. This file creates a new object and copies data into it. It changes
-- no privilege, policy or trigger on any existing table (the pre-apply test fingerprints the
-- partner_rfp_responses policies and its relacl before and after). The vendor GAINS nothing.
--
-- =====================================================================
-- ORDER
-- =====================================================================
--   1. Merge, push, confirm the deploy (the code is harmless before this file).
--   2. Pre-apply test: supabase/migrations/109_preapply_test.sql. READ THE ERROR IT RAISES.
--   3. Dry run (COMMIT -> ROLLBACK), prove it rolled back with P2.
--   4. Real apply. Verify V1 to V7.
--   5. On production, as the agency: open /agency/bids, score a bid, regenerate a summary.
--   6. THEN 110, to close the leak and the vendor write path.
--
-- =====================================================================
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- P1. THE COLUMNS EXIST AND HOLD DATA TO COPY.
--
--   SELECT count(*) FILTER (WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
--                            OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL) AS to_copy,
--          count(*) FILTER (WHERE composite_score IS NOT NULL)  AS with_score,
--          count(*) FILTER (WHERE ai_summary_short IS NOT NULL) AS with_short,
--          count(*) AS total
--   FROM public.partner_rfp_responses;
--
--   OWNER-VERIFIED 2026-10-09: with_score = 2, with_short = 15. WRITE DOWN to_copy. V4 must equal it.
--
-- P2. THE TABLE DOES NOT EXIST.
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partner_rfp_response_private';
--
--   EXPECTED: zero rows. If one exists, STOP.
--
-- P3. THE HELPERS THE POLICY AND THE TRIGGER DEPEND ON.
--
--   SELECT to_regprocedure('public.current_user_org_ids()') IS NOT NULL AS h1,
--          to_regclass('public.organizations') IS NOT NULL AS h2;
--
--   EXPECTED: true, true.
--
-- P4. THE POLICY FINGERPRINT AND ACL OF partner_rfp_responses, TO SHOW NOTHING MOVED.
--
--   SELECT count(*) AS n_policies,
--          md5(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' ||
--                         coalesce(with_check, ''), E'\n' ORDER BY policyname)) AS fingerprint
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_rfp_responses';
--   SELECT relacl::text FROM pg_class WHERE oid = 'public.partner_rfp_responses'::regclass;
--
--   WRITE DOWN ALL THREE.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. ROW LEVEL SECURITY IS ON.
--
--   SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partner_rfp_response_private';
--
--   EXPECTED: one row, relrowsecurity = true.
--
-- V2. THREE POLICIES, ALL authenticated, NO DELETE, NO VENDOR REFERENCE.
--
--   SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'partner_rfp_response_private' ORDER BY cmd, policyname;
--
--   EXPECTED: 3 rows (INSERT, SELECT, UPDATE), roles = {authenticated}, no qual or with_check
--   containing vendor_org_id.
--
-- V3. anon AND PUBLIC HAVE NOTHING; authenticated HAS ONLY SELECT, INSERT, UPDATE.
--
--   SELECT p.priv,
--          has_table_privilege('anon', 'public.partner_rfp_response_private', p.priv)          AS anon,
--          has_table_privilege('authenticated', 'public.partner_rfp_response_private', p.priv) AS authenticated
--   FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv);
--
--   EXPECTED: anon false on all seven; authenticated true for SELECT, INSERT, UPDATE and false for
--   DELETE, TRUNCATE, REFERENCES, TRIGGER.
--
-- V4. THE BACKFILL IS COMPLETE AND IDENTICAL.
--
--   SELECT (SELECT count(*) FROM public.partner_rfp_response_private) AS in_table,
--          (SELECT count(*) FROM public.partner_rfp_responses r
--             LEFT JOIN public.partner_rfp_response_private n ON n.response_id = r.id
--           WHERE (r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
--                  OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL)
--             AND (n.response_id IS NULL
--                  OR n.composite_score         IS DISTINCT FROM r.composite_score
--                  OR n.ai_summary_short        IS DISTINCT FROM r.ai_summary_short
--                  OR n.ai_summary_detailed     IS DISTINCT FROM r.ai_summary_detailed
--                  OR n.ai_summary_generated_at IS DISTINCT FROM r.ai_summary_generated_at)) AS mismatched;
--
--   EXPECTED: in_table = P1's to_copy, mismatched = 0, immediately after the commit. LATER, mismatched
--   may rise above 0 and that is fine: the app writes only the table now. 110's drift guard says which
--   differences it accepts.
--
-- V5. THE TRIGGER.
--
--   SELECT tgname, tgenabled, (tgtype & 2) = 2 AS before_event, (tgtype & 4) = 4 AS on_insert,
--          (tgtype & 16) = 16 AS on_update FROM pg_trigger
--   WHERE tgrelid = 'public.partner_rfp_response_private'::regclass AND NOT tgisinternal;
--
--   EXPECTED: one row, tgenabled = 'O', all three booleans true.
--
--   SELECT has_function_privilege('anon', 'public.partner_rfp_response_private_guard()', 'EXECUTE') AS f1,
--          has_function_privilege('authenticated', 'public.partner_rfp_response_private_guard()', 'EXECUTE') AS f2;
--
--   EXPECTED: false, false.
--
-- V6. NOTHING ON partner_rfp_responses MOVED. Re-run P4. EXPECTED: all three values equal P4's.
--
-- V7. THE CASCADE.
--
--   SELECT confdeltype FROM pg_constraint
--   WHERE conrelid = 'public.partner_rfp_response_private'::regclass AND contype = 'f'
--     AND confrelid = 'public.partner_rfp_responses'::regclass;
--
--   EXPECTED: one row, 'c'.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 209 and COMMIT is at line 391.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_orphans bigint;
BEGIN
  IF to_regclass('public.partner_rfp_responses') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '109 refuses to apply: public.partner_rfp_responses or public.organizations does not exist.'
      USING ERRCODE = 'LG109';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '109 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG109';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'partner_rfp_responses'
         AND column_name IN ('lead_org_id', 'composite_score', 'ai_summary_short',
                             'ai_summary_detailed', 'ai_summary_generated_at')) <> 5 THEN
    RAISE EXCEPTION '109 refuses to apply: partner_rfp_responses is missing lead_org_id or one of the four columns to copy.'
      USING ERRCODE = 'LG109';
  END IF;

  IF to_regclass('public.partner_rfp_response_private') IS NOT NULL THEN
    RAISE EXCEPTION '109 refuses to apply: public.partner_rfp_response_private already exists. Read the schema before going further.'
      USING ERRCODE = 'LG109';
  END IF;

  SELECT count(*) INTO v_orphans FROM public.partner_rfp_responses
   WHERE lead_org_id IS NULL
     AND (composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
          OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL);
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION '109 refuses to apply: % response(s) hold a value to copy but have no lead_org_id, so no agency could own the copy.', v_orphans
      USING ERRCODE = 'LG109';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. THE TABLE.
-- ---------------------------------------------------------------------
CREATE TABLE public.partner_rfp_response_private (
  response_id             uuid         PRIMARY KEY REFERENCES public.partner_rfp_responses (id) ON DELETE CASCADE,
  lead_org_id             uuid         NOT NULL    REFERENCES public.organizations (id),
  composite_score         numeric(4,1),
  ai_summary_short        text,
  ai_summary_detailed     text,
  ai_summary_generated_at timestamptz,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX partner_rfp_response_private_lead_org_id_idx
  ON public.partner_rfp_response_private (lead_org_id);

COMMENT ON TABLE public.partner_rfp_response_private IS
  'Migration 109. The lead agency''s composite score and AI procurement summaries of a bid. Agency-only: there is NO vendor policy. Replaces partner_rfp_responses.composite_score and ai_summary_short / _detailed / _generated_at, which the vendor can read and (before 110) write through its whole-row policies.';

-- ---------------------------------------------------------------------
-- 2. THE GUARD. Sets lead_org_id from the parent; pins both keys; owns the timestamps.
--    It runs for every caller, the service role included.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partner_rfp_response_private_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.response_id IS DISTINCT FROM OLD.response_id
       OR NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
      RAISE EXCEPTION 'partner_rfp_response_private.response_id and lead_org_id cannot be changed'
        USING ERRCODE = 'LG109';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  -- INSERT. Read under the CALLER's row level security. The caller's lead_org_id is ignored:
  -- the agency key always comes from the parent row.
  SELECT r.lead_org_id INTO v_lead FROM public.partner_rfp_responses r WHERE r.id = NEW.response_id;

  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'partner_rfp_response_private: response_id must be an existing response the caller can see'
      USING ERRCODE = 'LG109';
  END IF;

  NEW.lead_org_id := v_lead;
  NEW.created_at  := now();
  NEW.updated_at  := NEW.created_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_rfp_response_private_guard
  BEFORE INSERT OR UPDATE ON public.partner_rfp_response_private
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_rfp_response_private_guard();

REVOKE EXECUTE ON FUNCTION public.partner_rfp_response_private_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_response_private_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_rfp_response_private_guard() FROM authenticated;

-- ---------------------------------------------------------------------
-- 3. PRIVILEGES. anon gets nothing, by name. authenticated gets SELECT, INSERT, UPDATE only.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.partner_rfp_response_private FROM PUBLIC;
REVOKE ALL ON TABLE public.partner_rfp_response_private FROM anon;
REVOKE ALL ON TABLE public.partner_rfp_response_private FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.partner_rfp_response_private TO authenticated;
GRANT ALL ON TABLE public.partner_rfp_response_private TO service_role;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY. THREE POLICIES. NONE IS FOR A VENDOR. NO DELETE POLICY.
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_rfp_response_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_rfp_response_private_org_select"
  ON public.partner_rfp_response_private AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partner_rfp_response_private_org_insert"
  ON public.partner_rfp_response_private AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partner_rfp_response_private_org_update"
  ON public.partner_rfp_response_private AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

-- ---------------------------------------------------------------------
-- 5. BACKFILL. A COPY of every response holding any of the four. The legacy columns are NOT touched.
-- ---------------------------------------------------------------------
INSERT INTO public.partner_rfp_response_private
  (response_id, lead_org_id, composite_score, ai_summary_short, ai_summary_detailed, ai_summary_generated_at)
SELECT r.id, r.lead_org_id, r.composite_score, r.ai_summary_short, r.ai_summary_detailed, r.ai_summary_generated_at
FROM public.partner_rfp_responses r
WHERE r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
   OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL
ON CONFLICT (response_id) DO NOTHING;

DO $backfill_check$
DECLARE
  v_src      bigint;
  v_dst      bigint;
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_src FROM public.partner_rfp_responses
   WHERE composite_score IS NOT NULL OR ai_summary_short IS NOT NULL
      OR ai_summary_detailed IS NOT NULL OR ai_summary_generated_at IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.partner_rfp_response_private;
  SELECT count(*) INTO v_mismatch
  FROM public.partner_rfp_responses r
  LEFT JOIN public.partner_rfp_response_private n ON n.response_id = r.id
  WHERE (r.composite_score IS NOT NULL OR r.ai_summary_short IS NOT NULL
         OR r.ai_summary_detailed IS NOT NULL OR r.ai_summary_generated_at IS NOT NULL)
    AND (n.response_id IS NULL
         OR n.lead_org_id             IS DISTINCT FROM r.lead_org_id
         OR n.composite_score         IS DISTINCT FROM r.composite_score
         OR n.ai_summary_short        IS DISTINCT FROM r.ai_summary_short
         OR n.ai_summary_detailed     IS DISTINCT FROM r.ai_summary_detailed
         OR n.ai_summary_generated_at IS DISTINCT FROM r.ai_summary_generated_at);

  IF v_mismatch <> 0 OR v_dst <> v_src THEN
    RAISE EXCEPTION '109 backfill is not an exact copy: % response(s) with a value, % row(s) in the new table, % mismatched. Nothing was committed.',
      v_src, v_dst, v_mismatch
      USING ERRCODE = 'LG109';
  END IF;
END
$backfill_check$;

-- PostgREST must see the table at commit, or the code keeps falling back to the legacy columns.
NOTIFY pgrst, 'reload schema';

COMMIT;
